import type { Identity } from "@dfinity/agent";
import { Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { encodeExtTokenIdentifier } from "@t3kno/ic-nft-aggregator";
import {
  ICP_LEDGER,
  allowLedgerSpend,
  assertSpendTarget,
  assertTreasury,
} from "./constants";
import {
  assertFtSendWithinBalance,
  createAgent,
  isDelegationOrSignatureError,
  transferIcpToAccountId,
  transferIcrc1,
} from "./ledger";
import { parseDestination } from "./destinations";
import {
  quoteCycleMarginE8s,
  quoteFtSendFee,
  quoteNftSendFeeE8s,
  quoteSwapFeeAmount,
  recordFeeReceipt,
  recordPairLpCredit,
} from "./fees";

/** Holdings store decimal EXT indexes; transfer needs the encoded tid. */
export async function resolveExtTokenIdentifier(
  canisterId: string,
  tokenId: string,
): Promise<string> {
  const raw = tokenId.trim();
  if (!raw) throw new Error("Missing EXT token id");
  // Already an encoded TokenIdentifier (Principal-shaped).
  if (raw.includes("-") && raw.length > 20) return raw;
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index > 0xffff_ffff) {
    throw new Error(`Invalid EXT token index: ${tokenId}`);
  }
  return encodeExtTokenIdentifier(canisterId, index);
}

/** Shared NFT destination risk copy (Plug / Stoic / other wallets). */
export const NFT_FOREIGN_WALLET_RISKS = [
  "Send only to a principal you control and can open in Canopy or another wallet that indexes this collection.",
  "Plug, Stoic, and some third-party wallets may not load this NFT — it can look missing and be hard to retrieve even though ownership moved on-chain.",
  "Fee is paid first; if the NFT transfer fails afterward, the fee is not refunded.",
] as const;

export const NFT_FOREIGN_WALLET_ACK =
  "I understand sending to Plug or other wallets may hide this NFT or make it hard to recover.";


export type SendPreview = {
  kind: "ft" | "nft" | "swapFee";
  amountLabel: string;
  feeAmount: bigint;
  feeLedgerId: string;
  feeBps: bigint;
  treasury: string;
  destination: string;
  detail: string;
};

export async function previewFtSend(opts: {
  ledgerId: string;
  to: string;
  amount: bigint;
  symbol: string;
}): Promise<SendPreview> {
  const fee = await quoteFtSendFee(opts.amount);
  return {
    kind: "ft",
    amountLabel: `${opts.amount.toString()} base · ${opts.symbol}`,
    feeAmount: fee.feeAmount,
    feeLedgerId: opts.ledgerId,
    feeBps: fee.bps,
    treasury: fee.treasury,
    destination: opts.to,
    detail: `Send ${opts.symbol} + ${fee.bps.toString()} bps Canopy fee in ${opts.symbol}`,
  };
}

/**
 * Pay micro % fee in the same ICRC-1/2 token, then send net amount to destination.
 * Fee stacks on ledger transfer fee; both legs are user-signed.
 *
 * Destinations (locked):
 * - Principal → ICRC-1 `icrc1_transfer`
 * - ICP Account ID → `send_dfx` (Bazaar twin) with transfer fallback
 *   via `transferIcpToAccountId` (CRC validated; dashes/spaces stripped)
 */
export async function executeFtSend(opts: {
  identity: Identity;
  ledgerId: string;
  to: string;
  amount: bigint;
  payFee: boolean;
}): Promise<{ block: bigint; feeBlock?: bigint; feeAmount: bigint }> {
  // ICP (and seed ledgers) stay on the static allowlist; belt-and-suspenders for session.
  allowLedgerSpend(opts.ledgerId);
  assertSpendTarget(opts.ledgerId);
  if (opts.amount <= 0n) {
    throw new Error("Transfer amount must be greater than zero");
  }
  const dest = parseDestination(opts.to);
  if (!dest.ok) throw new Error(dest.error);
  if (dest.kind === "accountId" && opts.ledgerId !== ICP_LEDGER) {
    throw new Error(
      "Account ID destinations are only supported for ICP. Use a principal for other tokens.",
    );
  }

  // Refuse before the fee leg when the default subaccount cannot cover
  // gross amount + two ledger fees. A short balance used to pay the micro-fee
  // and then fail the recipient transfer.
  await assertFtSendWithinBalance({
    owner: opts.identity.getPrincipal(),
    ledgerId: opts.ledgerId,
    grossAmount: opts.amount,
  });

  let feeBlock: bigint | undefined;
  let feeAmount = 0n;
  if (opts.payFee) {
    const fee = await quoteFtSendFee(opts.amount);
    feeAmount = fee.feeAmount;
    if (feeAmount > 0n) {
      if (feeAmount >= opts.amount) {
        throw new Error("Amount too small to cover Canopy micro-fee");
      }
      assertTreasury(fee.treasury);
      try {
        feeBlock = await transferIcrc1({
          identity: opts.identity,
          ledgerId: opts.ledgerId,
          to: fee.treasury,
          amount: feeAmount,
        });
      } catch (e) {
        if (isDelegationOrSignatureError(e)) {
          throw new Error(
            "Internet Identity session expired before the fee payment. Sign in again, then retry the send.",
          );
        }
        throw e;
      }
      await recordFeeReceipt(
        opts.identity,
        "ftSend",
        feeAmount,
        `ftSend:${opts.ledgerId}`,
        feeBlock,
      );
    }
  }
  const net = opts.amount - feeAmount;
  if (net <= 0n) {
    throw new Error("Amount too small after Canopy micro-fee");
  }

  try {
    if (dest.kind === "accountId") {
      // Permanent Account ID path — send_dfx primary (Bazaar-proven) + transfer fallback.
      const block = await transferIcpToAccountId({
        identity: opts.identity,
        toAccountIdHex: dest.value,
        amountE8s: net,
      });
      return { block, feeBlock, feeAmount };
    }
    const block = await transferIcrc1({
      identity: opts.identity,
      ledgerId: opts.ledgerId,
      to: dest.value,
      amount: net,
    });
    return { block, feeBlock, feeAmount };
  } catch (e) {
    if (isDelegationOrSignatureError(e)) {
      const feeNote =
        feeBlock != null
          ? " The Canopy micro-fee may already have been paid — do not raise the amount and retry blindly; check your balance first."
          : "";
      throw new Error(
        `Internet Identity session expired during the send.${feeNote} Sign in again, then retry.`,
      );
    }
    throw e;
  }
}

const icrc7TransferIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Account = I.Record({
    owner: I.Principal,
    subaccount: I.Opt(I.Vec(I.Nat8)),
  });
  return I.Service({
    icrc7_transfer: I.Func(
      [
        I.Vec(
          I.Record({
            to: Account,
            token_id: I.Nat,
            memo: I.Opt(I.Vec(I.Nat8)),
            from_subaccount: I.Opt(I.Vec(I.Nat8)),
            created_at_time: I.Opt(I.Nat64),
          }),
        ),
      ],
      [
        I.Vec(
          I.Opt(
            I.Variant({
              Ok: I.Nat,
              Err: I.Variant({
                GenericError: I.Record({
                  error_code: I.Nat,
                  message: I.Text,
                }),
                Duplicate: I.Record({ duplicate_of: I.Nat }),
                NonExistingTokenId: I.Null,
                Unauthorized: I.Null,
                CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
                TooOld: I.Null,
              }),
            }),
          ),
        ),
      ],
      [],
    ),
  });
};

export async function executeIcrc7Send(opts: {
  identity: Identity;
  ledgerId: string;
  tokenId: bigint;
  to: string;
  payFee: boolean;
}): Promise<{ ok: boolean; feeBlock?: bigint; detail: string }> {
  // User-confirmed NFT send (SpendReview) — allow the collection for this session.
  allowLedgerSpend(opts.ledgerId);
  assertSpendTarget(opts.ledgerId);
  let feeBlock: bigint | undefined;
  if (opts.payFee) {
    const fee = await quoteNftSendFeeE8s();
    if (fee.feeE8s > 0n) {
      assertTreasury(fee.treasury);
      feeBlock = await transferIcrc1({
        identity: opts.identity,
        ledgerId: ICP_LEDGER,
        to: fee.treasury,
        amount: fee.feeE8s,
      });
      await recordFeeReceipt(
        opts.identity,
        "nftSend",
        fee.feeE8s,
        `nftSend:${opts.ledgerId}:${opts.tokenId}`,
        feeBlock,
      );
    }
  }
  const agent = await createAgent(opts.identity);
  const actor = Actor.createActor(icrc7TransferIdl, {
    agent,
    canisterId: opts.ledgerId,
  }) as {
    icrc7_transfer: (
      args: Array<{
        to: { owner: Principal; subaccount: [] };
        token_id: bigint;
        memo: [];
        from_subaccount: [];
        created_at_time: [];
      }>,
    ) => Promise<Array<[] | [{ Ok: bigint } | { Err: unknown }]>>;
  };
  const rows = await actor.icrc7_transfer([
    {
      to: { owner: Principal.fromText(opts.to), subaccount: [] },
      token_id: opts.tokenId,
      memo: [],
      from_subaccount: [],
      created_at_time: [],
    },
  ]);
  const row = rows[0];
  if (!row || row.length === 0) {
    return { ok: false, feeBlock, detail: "Empty transfer result" };
  }
  const res = row[0]!;
  if ("Err" in res) {
    return {
      ok: false,
      feeBlock,
      detail: `ICRC-7 transfer error: ${JSON.stringify(res.Err)}`,
    };
  }
  return { ok: true, feeBlock, detail: `Transferred token ${opts.tokenId}` };
}

/**
 * EXT fungible/NFT transfer (legacy). Token id is the EXT token identifier string.
 * Fee in ICP first (same as ICRC-7 path).
 */
export async function executeExtSend(opts: {
  identity: Identity;
  canisterId: string;
  tokenIdentifier: string;
  to: string;
  amount?: bigint;
  payFee: boolean;
}): Promise<{ ok: boolean; feeBlock?: bigint; detail: string }> {
  // User-confirmed NFT send (SpendReview) — allow EXT partner cans not on the
  // static seed list (GNight, Pokedbots, RW, etc.). Do not gate transfers on a
  // hardcoded EXT catalog; any collection the user holds must be sendable.
  allowLedgerSpend(opts.canisterId);
  assertSpendTarget(opts.canisterId);
  let feeBlock: bigint | undefined;
  if (opts.payFee) {
    const fee = await quoteNftSendFeeE8s();
    if (fee.feeE8s > 0n) {
      assertTreasury(fee.treasury);
      feeBlock = await transferIcrc1({
        identity: opts.identity,
        ledgerId: ICP_LEDGER,
        to: fee.treasury,
        amount: fee.feeE8s,
      });
      await recordFeeReceipt(
        opts.identity,
        "nftSend",
        fee.feeE8s,
        `extSend:${opts.canisterId}:${opts.tokenIdentifier}`,
        feeBlock,
      );
    }
  }

  const extIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
    const User = I.Variant({
      principal: I.Principal,
      address: I.Text,
    });
    const TransferRequest = I.Record({
      to: User,
      token: I.Text,
      notify: I.Bool,
      from: User,
      memo: I.Vec(I.Nat8),
      subaccount: I.Opt(I.Vec(I.Nat8)),
      amount: I.Nat,
    });
    const TransferResponse = I.Variant({
      ok: I.Nat,
      err: I.Variant({
        CannotNotify: I.Text,
        InsufficientBalance: I.Null,
        InvalidToken: I.Text,
        Rejected: I.Null,
        Unauthorized: I.Text,
        Other: I.Text,
      }),
    });
    return I.Service({
      transfer: I.Func([TransferRequest], [TransferResponse], []),
    });
  };

  const agent = await createAgent(opts.identity);
  const me = opts.identity.getPrincipal();
  const actor = Actor.createActor(extIdl, {
    agent,
    canisterId: opts.canisterId,
  }) as {
    transfer: (r: {
      to: { principal: Principal } | { address: string };
      token: string;
      notify: boolean;
      from: { principal: Principal };
      memo: Uint8Array;
      subaccount: [];
      amount: bigint;
    }) => Promise<{ ok: bigint } | { err: unknown }>;
  };

  const token = await resolveExtTokenIdentifier(
    opts.canisterId,
    opts.tokenIdentifier,
  );

  let toUser: { principal: Principal } | { address: string };
  try {
    toUser = { principal: Principal.fromText(opts.to) };
  } catch {
    toUser = { address: opts.to };
  }

  const result = await actor.transfer({
    to: toUser,
    token,
    notify: false,
    from: { principal: me },
    memo: new Uint8Array(),
    subaccount: [],
    amount: opts.amount ?? 1n,
  });
  if ("err" in result) {
    return {
      ok: false,
      feeBlock,
      detail: `EXT transfer error: ${JSON.stringify(result.err)}`,
    };
  }
  return {
    ok: true,
    feeBlock,
    detail: `EXT transferred ${token}`,
  };
}

export type BulkNftSendItem = {
  key: string;
  name: string;
  contractId: string;
  tokenId: string;
  standard: "icrc7" | "ext";
};

export type BulkNftSendProgress = {
  index: number;
  total: number;
  item: BulkNftSendItem;
  phase: "fee" | "transfer" | "done" | "item-ok" | "item-err";
  detail?: string;
};

export type BulkNftSendResult = {
  feeBlock?: bigint;
  feeE8s: bigint;
  discountBps: number;
  ok: Array<{ key: string; detail: string }>;
  failed: Array<{ key: string; detail: string }>;
};

/**
 * Pay stacked NFT micro-fees once (with bulk discount), then transfer each NFT.
 * Individual transfer failures do not refund the fee.
 */
export async function executeBulkNftSend(opts: {
  identity: Identity;
  to: string;
  items: BulkNftSendItem[];
  onProgress?: (p: BulkNftSendProgress) => void;
}): Promise<BulkNftSendResult> {
  const { quoteNftSendBulkFee } = await import("./fees");
  const items = opts.items.filter(
    (n) => n.standard === "icrc7" || n.standard === "ext",
  );
  if (!items.length) {
    throw new Error("No transferable NFTs selected (ICRC-7 / EXT only)");
  }
  if (!opts.to.trim()) throw new Error("Destination required");

  const feeQ = await quoteNftSendBulkFee(items.length);
  let feeBlock: bigint | undefined;
  opts.onProgress?.({
    index: 0,
    total: items.length,
    item: items[0]!,
    phase: "fee",
    detail: `Paying bulk fee ${feeQ.feeE8s.toString()} e8s (${feeQ.discountBps / 100}% off)`,
  });

  if (feeQ.feeE8s > 0n) {
    assertTreasury(feeQ.treasury);
    feeBlock = await transferIcrc1({
      identity: opts.identity,
      ledgerId: ICP_LEDGER,
      to: feeQ.treasury,
      amount: feeQ.feeE8s,
    });
    await recordFeeReceipt(
      opts.identity,
      "nftSend",
      feeQ.feeE8s,
      `nftBulkSend:n=${items.length}:disc=${feeQ.discountBps}`,
      feeBlock,
    );
  }

  const ok: BulkNftSendResult["ok"] = [];
  const failed: BulkNftSendResult["failed"] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    opts.onProgress?.({
      index: i + 1,
      total: items.length,
      item,
      phase: "transfer",
      detail: `Sending ${item.name}…`,
    });
    try {
      const r =
        item.standard === "icrc7"
          ? await executeIcrc7Send({
              identity: opts.identity,
              ledgerId: item.contractId,
              tokenId: BigInt(item.tokenId),
              to: opts.to.trim(),
              payFee: false,
            })
          : await executeExtSend({
              identity: opts.identity,
              canisterId: item.contractId,
              tokenIdentifier: String(item.tokenId),
              to: opts.to.trim(),
              payFee: false,
            });
      if (r.ok) {
        ok.push({ key: item.key, detail: r.detail });
        opts.onProgress?.({
          index: i + 1,
          total: items.length,
          item,
          phase: "item-ok",
          detail: r.detail,
        });
      } else {
        failed.push({ key: item.key, detail: r.detail });
        opts.onProgress?.({
          index: i + 1,
          total: items.length,
          item,
          phase: "item-err",
          detail: r.detail,
        });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      failed.push({ key: item.key, detail });
      opts.onProgress?.({
        index: i + 1,
        total: items.length,
        item,
        phase: "item-err",
        detail,
      });
    }
  }

  opts.onProgress?.({
    index: items.length,
    total: items.length,
    item: items[items.length - 1]!,
    phase: "done",
    detail: `${ok.length} sent · ${failed.length} failed`,
  });

  return {
    feeBlock,
    feeE8s: feeQ.feeE8s,
    discountBps: feeQ.discountBps,
    ok,
    failed,
  };
}

/**
 * Canopy swap micro-fee in token-in (stacks on venue fees), credit pair LP bucket, open venue.
 */
export async function previewAndPaySwapFee(opts: {
  identity: Identity;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
}): Promise<{ feeAmount: bigint; feeBlock: bigint; treasury: string; bps: bigint }> {
  assertSpendTarget(opts.tokenIn);
  const q = await quoteSwapFeeAmount(opts.amountIn);
  if (q.feeAmount <= 0n) {
    return { feeAmount: 0n, feeBlock: 0n, treasury: q.treasury, bps: q.bps };
  }
  if (q.feeAmount >= opts.amountIn) {
    throw new Error("Swap amount too small for Canopy micro-fee");
  }
  assertTreasury(q.treasury);
  const feeBlock = await transferIcrc1({
    identity: opts.identity,
    ledgerId: opts.tokenIn,
    to: q.treasury,
    amount: q.feeAmount,
  });
  await recordFeeReceipt(
    opts.identity,
    "swap",
    q.feeAmount,
    `swap:${opts.tokenIn}->${opts.tokenOut}`,
    feeBlock,
  );
  await recordPairLpCredit(
    opts.identity,
    opts.tokenIn,
    opts.tokenOut,
    opts.tokenIn,
    q.feeAmount,
  );
  return {
    feeAmount: q.feeAmount,
    feeBlock,
    treasury: q.treasury,
    bps: q.bps,
  };
}

export { quoteCycleMarginE8s };
