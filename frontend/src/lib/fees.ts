import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import {
  BAZAAR_TREASURY,
  CANOPY_FEES_CANISTER,
  IC_HOST,
  assertTreasury,
} from "./constants";

/** Micro-fees (bps) — stack on venue/ledger fees; collected to treasury. */
export const MICRO_FT_SEND_BPS = 15n; // 0.15%
export const MICRO_SWAP_BPS = 20n; // 0.20%
export const MICRO_CYCLE_BPS = 25n; // 0.25%
export const MICRO_NFT_SEND_E8S = 10_000n; // 0.0001 ICP flat

const feesIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const FeeKind = I.Variant({
    swap: I.Null,
    nftSend: I.Null,
    cycleTopUp: I.Null,
    ftSend: I.Null,
  });
  const FeeConfig = I.Record({
    swapFeeBps: I.Nat,
    nftSendFeeE8s: I.Nat,
    cycleMarginBps: I.Nat,
    treasury: I.Principal,
    maxSwapNotionalE8s: I.Nat,
    maxCycleTopUpE8s: I.Nat,
  });
  return I.Service({
    getConfig: I.Func([], [FeeConfig], ["query"]),
    getFtSendFeeBps: I.Func([], [I.Nat], ["query"]),
    quoteSwapFee: I.Func(
      [I.Nat],
      [
        I.Variant({
          ok: I.Record({ feeE8s: I.Nat, treasury: I.Principal }),
          err: I.Text,
        }),
      ],
      ["query"],
    ),
    quoteFtSendFee: I.Func(
      [I.Nat],
      [
        I.Variant({
          ok: I.Record({
            feeAmount: I.Nat,
            bps: I.Nat,
            treasury: I.Principal,
          }),
          err: I.Text,
        }),
      ],
      ["query"],
    ),
    quoteNftSendFee: I.Func(
      [],
      [I.Record({ feeE8s: I.Nat, treasury: I.Principal })],
      ["query"],
    ),
    quoteNftSendBulkFee: I.Func(
      [I.Nat],
      [
        I.Variant({
          ok: I.Record({
            unitFeeE8s: I.Nat,
            count: I.Nat,
            subtotalE8s: I.Nat,
            discountBps: I.Nat,
            discountE8s: I.Nat,
            feeE8s: I.Nat,
            treasury: I.Principal,
          }),
          err: I.Text,
        }),
      ],
      ["query"],
    ),
    quoteCycleMargin: I.Func(
      [I.Nat],
      [
        I.Variant({
          ok: I.Record({ marginE8s: I.Nat, treasury: I.Principal }),
          err: I.Text,
        }),
      ],
      ["query"],
    ),
    recordFeePayment: I.Func(
      [FeeKind, I.Nat, I.Text, I.Opt(I.Nat)],
      [I.Variant({ ok: I.Nat, err: I.Text })],
      [],
    ),
    recordPairLpCredit: I.Func(
      [I.Text, I.Text, I.Text, I.Nat],
      [I.Variant({ ok: I.Null, err: I.Text })],
      [],
    ),
    listPairLpCredits: I.Func(
      [I.Nat],
      [
        I.Vec(
          I.Record({
            tokenIn: I.Text,
            tokenOut: I.Text,
            feeLedger: I.Text,
            amount: I.Nat,
            updatedAt: I.Int,
          }),
        ),
      ],
      ["query"],
    ),
    consumePairLpCredit: I.Func(
      [I.Text, I.Text, I.Text, I.Nat],
      [I.Variant({ ok: I.Null, err: I.Text })],
      [],
    ),
  });
};

type FeesActor = {
  getConfig: () => Promise<{
    swapFeeBps: bigint;
    nftSendFeeE8s: bigint;
    cycleMarginBps: bigint;
    treasury: Principal;
    maxSwapNotionalE8s: bigint;
    maxCycleTopUpE8s: bigint;
  }>;
  getFtSendFeeBps: () => Promise<bigint>;
  quoteSwapFee: (n: bigint) => Promise<
    { ok: { feeE8s: bigint; treasury: Principal } } | { err: string }
  >;
  quoteFtSendFee: (n: bigint) => Promise<
    | {
        ok: { feeAmount: bigint; bps: bigint; treasury: Principal };
      }
    | { err: string }
  >;
  quoteNftSendFee: () => Promise<{ feeE8s: bigint; treasury: Principal }>;
  quoteNftSendBulkFee: (count: bigint) => Promise<
    | {
        ok: {
          unitFeeE8s: bigint;
          count: bigint;
          subtotalE8s: bigint;
          discountBps: bigint;
          discountE8s: bigint;
          feeE8s: bigint;
          treasury: Principal;
        };
      }
    | { err: string }
  >;
  quoteCycleMargin: (n: bigint) => Promise<
    { ok: { marginE8s: bigint; treasury: Principal } } | { err: string }
  >;
  recordFeePayment: (
    kind:
      | { swap: null }
      | { nftSend: null }
      | { cycleTopUp: null }
      | { ftSend: null },
    amount: bigint,
    memo: string,
    block: [] | [bigint],
  ) => Promise<{ ok: bigint } | { err: string }>;
  recordPairLpCredit: (
    tokenIn: string,
    tokenOut: string,
    feeLedger: string,
    amount: bigint,
  ) => Promise<{ ok: null } | { err: string }>;
  listPairLpCredits: (limit: bigint) => Promise<
    Array<{
      tokenIn: string;
      tokenOut: string;
      feeLedger: string;
      amount: bigint;
      updatedAt: bigint;
    }>
  >;
  consumePairLpCredit: (
    tokenIn: string,
    tokenOut: string,
    feeLedger: string,
    amount: bigint,
  ) => Promise<{ ok: null } | { err: string }>;
};

function feesCanisterId(): string {
  const id = CANOPY_FEES_CANISTER?.trim() || "";
  if (!id) throw new Error("Canopy fees canister not configured");
  return id;
}

export function feeFromBps(amount: bigint, bps: bigint): bigint {
  if (amount <= 0n || bps <= 0n) return 0n;
  return (amount * bps) / 10_000n;
}

export async function getFeesActor(
  identity?: import("@dfinity/agent").Identity | null,
): Promise<FeesActor> {
  const agent = await HttpAgent.create({
    host: IC_HOST,
    identity: identity ?? undefined,
  });
  return Actor.createActor(feesIdl, {
    agent,
    canisterId: feesCanisterId(),
  }) as FeesActor;
}

export async function quoteFtSendFee(amount: bigint): Promise<{
  feeAmount: bigint;
  bps: bigint;
  treasury: string;
}> {
  try {
    const actor = await getFeesActor(null);
    const r = await actor.quoteFtSendFee(amount);
    if ("err" in r) throw new Error(r.err);
    return {
      feeAmount: r.ok.feeAmount,
      bps: r.ok.bps,
      treasury: pinnedTreasury(r.ok.treasury.toText()),
    };
  } catch {
    return {
      feeAmount: feeFromBps(amount, MICRO_FT_SEND_BPS),
      bps: MICRO_FT_SEND_BPS,
      treasury: BAZAAR_TREASURY,
    };
  }
}

function pinnedTreasury(fromChain: string): string {
  try {
    assertTreasury(fromChain);
    return fromChain;
  } catch {
    return BAZAAR_TREASURY;
  }
}

/** Swap micro-fee in token-in base units (stacks on venue fees). */
export async function quoteSwapFeeAmount(notional: bigint): Promise<{
  feeAmount: bigint;
  bps: bigint;
  treasury: string;
}> {
  try {
    const actor = await getFeesActor(null);
    const cfg = await actor.getConfig();
    // Prefer micro rates until mainnet config is lowered from legacy high bps
    const bps =
      cfg.swapFeeBps > 0n && cfg.swapFeeBps <= 50n
        ? cfg.swapFeeBps
        : MICRO_SWAP_BPS;
    const r = await actor.quoteSwapFee(notional);
    const treasury = pinnedTreasury(
      "ok" in r ? r.ok.treasury.toText() : BAZAAR_TREASURY,
    );
    return {
      feeAmount: feeFromBps(notional, bps),
      bps,
      treasury,
    };
  } catch {
    return {
      feeAmount: feeFromBps(notional, MICRO_SWAP_BPS),
      bps: MICRO_SWAP_BPS,
      treasury: BAZAAR_TREASURY,
    };
  }
}

/** @deprecated use quoteSwapFeeAmount */
export async function quoteSwapFeeE8s(notionalE8s: bigint): Promise<{
  feeE8s: bigint;
  treasury: string;
}> {
  const q = await quoteSwapFeeAmount(notionalE8s);
  return { feeE8s: q.feeAmount, treasury: q.treasury };
}

export async function quoteNftSendFeeE8s(): Promise<{
  feeE8s: bigint;
  treasury: string;
}> {
  try {
    const actor = await getFeesActor(null);
    const r = await actor.quoteNftSendFee();
    return { feeE8s: r.feeE8s, treasury: pinnedTreasury(r.treasury.toText()) };
  } catch {
    return { feeE8s: MICRO_NFT_SEND_E8S, treasury: BAZAAR_TREASURY };
  }
}

/** Client-side mirror of Motoko `nftBulkDiscountBps` — used when canister lacks bulk quote. */
export function nftBulkDiscountBps(count: number): number {
  if (count >= 50) return 2500;
  if (count >= 25) return 2000;
  if (count >= 10) return 1500;
  if (count >= 5) return 1000;
  if (count >= 2) return 500;
  return 0;
}

export const MAX_NFT_BULK_SEND = 200;
/** Soft UI cap so II approvals stay manageable. */
export const NFT_BULK_SEND_UI_CAP = 500;

export type NftBulkFeeQuote = {
  unitFeeE8s: bigint;
  count: number;
  subtotalE8s: bigint;
  discountBps: number;
  discountE8s: bigint;
  feeE8s: bigint;
  treasury: string;
  /** True when quote came from fees canister. */
  onChain: boolean;
};

function localNftBulkFeeQuote(count: number, unitFeeE8s: bigint): NftBulkFeeQuote {
  const n = Math.max(0, Math.min(MAX_NFT_BULK_SEND, Math.floor(count)));
  const subtotalE8s = unitFeeE8s * BigInt(n);
  const discountBps = nftBulkDiscountBps(n);
  const discountE8s = (subtotalE8s * BigInt(discountBps)) / 10_000n;
  return {
    unitFeeE8s,
    count: n,
    subtotalE8s,
    discountBps,
    discountE8s,
    feeE8s: subtotalE8s - discountE8s,
    treasury: BAZAAR_TREASURY,
    onChain: false,
  };
}

/**
 * Stacked per-NFT micro-fees with bulk discount.
 * Prefer on-chain `quoteNftSendBulkFee`; fall back to local tier table.
 */
export async function quoteNftSendBulkFee(
  count: number,
): Promise<NftBulkFeeQuote> {
  const n = Math.max(0, Math.min(MAX_NFT_BULK_SEND, Math.floor(count)));
  if (n === 0) {
    return localNftBulkFeeQuote(0, MICRO_NFT_SEND_E8S);
  }
  try {
    const actor = await getFeesActor(null);
    const r = await actor.quoteNftSendBulkFee(BigInt(n));
    if ("err" in r) throw new Error(r.err);
    return {
      unitFeeE8s: r.ok.unitFeeE8s,
      count: Number(r.ok.count),
      subtotalE8s: r.ok.subtotalE8s,
      discountBps: Number(r.ok.discountBps),
      discountE8s: r.ok.discountE8s,
      feeE8s: r.ok.feeE8s,
      treasury: pinnedTreasury(r.ok.treasury.toText()),
      onChain: true,
    };
  } catch {
    try {
      const unit = await quoteNftSendFeeE8s();
      const q = localNftBulkFeeQuote(n, unit.feeE8s);
      return { ...q, treasury: unit.treasury };
    } catch {
      return localNftBulkFeeQuote(n, MICRO_NFT_SEND_E8S);
    }
  }
}

export async function quoteCycleMarginE8s(icpE8s: bigint): Promise<{
  marginE8s: bigint;
  bps: bigint;
  treasury: string;
}> {
  try {
    const actor = await getFeesActor(null);
    const cfg = await actor.getConfig();
    const r = await actor.quoteCycleMargin(icpE8s);
    if ("err" in r) throw new Error(r.err);
    // Cap to micro until mainnet config is lowered
    const margin =
      cfg.cycleMarginBps > 50n
        ? feeFromBps(icpE8s, MICRO_CYCLE_BPS)
        : r.ok.marginE8s;
    return {
      marginE8s: margin,
      bps: cfg.cycleMarginBps > 50n ? MICRO_CYCLE_BPS : cfg.cycleMarginBps,
      treasury: pinnedTreasury(r.ok.treasury.toText()),
    };
  } catch {
    return {
      marginE8s: feeFromBps(icpE8s, MICRO_CYCLE_BPS),
      bps: MICRO_CYCLE_BPS,
      treasury: BAZAAR_TREASURY,
    };
  }
}

export async function recordFeeReceipt(
  identity: import("@dfinity/agent").Identity,
  kind: "swap" | "nftSend" | "cycleTopUp" | "ftSend",
  amount: bigint,
  memo: string,
  block?: bigint,
): Promise<void> {
  try {
    const actor = await getFeesActor(identity);
    const k =
      kind === "swap"
        ? ({ swap: null } as const)
        : kind === "nftSend"
          ? ({ nftSend: null } as const)
          : kind === "cycleTopUp"
            ? ({ cycleTopUp: null } as const)
            : ({ ftSend: null } as const);
    await actor.recordFeePayment(
      k,
      amount,
      memo.slice(0, 200),
      block != null ? [block] : [],
    );
  } catch {
    /* receipt is best-effort */
  }
}

export async function recordPairLpCredit(
  identity: import("@dfinity/agent").Identity,
  tokenIn: string,
  tokenOut: string,
  feeLedger: string,
  amount: bigint,
): Promise<void> {
  try {
    const actor = await getFeesActor(identity);
    await actor.recordPairLpCredit(tokenIn, tokenOut, feeLedger, amount);
  } catch {
    /* best-effort until canister upgraded */
  }
}

export type PairLpCredit = {
  tokenIn: string;
  tokenOut: string;
  feeLedger: string;
  amount: bigint;
  updatedAt: bigint;
};

export async function listPairLpCredits(
  limit = 50,
): Promise<PairLpCredit[]> {
  try {
    const actor = await getFeesActor(null);
    return await actor.listPairLpCredits(BigInt(limit));
  } catch {
    return [];
  }
}

export async function consumePairLpCredit(
  identity: import("@dfinity/agent").Identity,
  tokenIn: string,
  tokenOut: string,
  feeLedger: string,
  amount: bigint,
): Promise<void> {
  const actor = await getFeesActor(identity);
  const r = await actor.consumePairLpCredit(
    tokenIn,
    tokenOut,
    feeLedger,
    amount,
  );
  if ("err" in r) throw new Error(r.err);
}
