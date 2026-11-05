import { Actor, HttpAgent, type Identity } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";
import { IC_HOST, ICP_LEDGER, assertSpendTarget } from "./constants";
import {
  accountIdHexToBytes,
  isAccountIdHex,
  isValidAccountIdChecksum,
  normalizeAccountIdHex,
} from "./destinations";

/** Mainnet IC HTTP gateways — try next on transient transport failures only. */
const IC_TRANSFER_HOSTS = [IC_HOST, "https://ic0.app"] as const;

/** Classic ICP ledger fee (e8s). Locked to match NNS / ledger candid. */
export const ICP_LEDGER_FEE_E8S = 10_000n;

/**
 * Classic ICP ledger Account ID sends.
 * - `send_dfx` — TextAccountIdentifier (same path as Bazaar EXT escrow pays)
 * - `transfer` — 32-byte blob AccountIdentifier (fallback; returns Err variants)
 * Tokens.e8s MUST be Nat64.
 */
const icpLegacyAccountIdIdl: IDL.InterfaceFactory = ({ IDL: idl }) => {
  const Tokens = idl.Record({ e8s: idl.Nat64 });
  const TimeStamp = idl.Record({ timestamp_nanos: idl.Nat64 });
  return idl.Service({
    send_dfx: idl.Func(
      [
        idl.Record({
          to: idl.Text,
          fee: Tokens,
          memo: idl.Nat64,
          from_subaccount: idl.Opt(idl.Vec(idl.Nat8)),
          created_at_time: idl.Opt(TimeStamp),
          amount: Tokens,
        }),
      ],
      [idl.Nat64],
      [],
    ),
    transfer: idl.Func(
      [
        idl.Record({
          to: idl.Vec(idl.Nat8),
          fee: Tokens,
          memo: idl.Nat64,
          from_subaccount: idl.Opt(idl.Vec(idl.Nat8)),
          created_at_time: idl.Opt(TimeStamp),
          amount: Tokens,
        }),
      ],
      [
        idl.Variant({
          Ok: idl.Nat64,
          Err: idl.Variant({
            BadFee: idl.Record({ expected_fee: Tokens }),
            InsufficientFunds: idl.Record({ balance: Tokens }),
            TxTooOld: idl.Record({ allowed_window_nanos: idl.Nat64 }),
            TxCreatedInFuture: idl.Null,
            TxDuplicate: idl.Record({ duplicate_of: idl.Nat64 }),
          }),
        }),
      ],
      [],
    ),
  });
};

export const icrc1Idl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Acc = I.Record({
    owner: I.Principal,
    subaccount: I.Opt(I.Vec(I.Nat8)),
  });
  return I.Service({
    icrc1_name: I.Func([], [I.Text], ["query"]),
    icrc1_symbol: I.Func([], [I.Text], ["query"]),
    icrc1_decimals: I.Func([], [I.Nat8], ["query"]),
    icrc1_fee: I.Func([], [I.Nat], ["query"]),
    icrc1_balance_of: I.Func([Acc], [I.Nat], ["query"]),
    icrc1_transfer: I.Func(
      [
        I.Record({
          to: Acc,
          fee: I.Opt(I.Nat),
          memo: I.Opt(I.Vec(I.Nat8)),
          from_subaccount: I.Opt(I.Vec(I.Nat8)),
          created_at_time: I.Opt(I.Nat64),
          amount: I.Nat,
        }),
      ],
      [
        I.Variant({
          Ok: I.Nat,
          Err: I.Variant({
            BadFee: I.Record({ expected_fee: I.Nat }),
            InsufficientFunds: I.Record({ balance: I.Nat }),
            TooOld: I.Null,
            CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
            Duplicate: I.Record({ duplicate_of: I.Nat }),
            TemporarilyUnavailable: I.Null,
            GenericError: I.Record({
              error_code: I.Nat,
              message: I.Text,
            }),
          }),
        }),
      ],
      [],
    ),
    icrc2_approve: I.Func(
      [
        I.Record({
          from_subaccount: I.Opt(I.Vec(I.Nat8)),
          spender: Acc,
          amount: I.Nat,
          expected_allowance: I.Opt(I.Nat),
          expires_at: I.Opt(I.Nat64),
          fee: I.Opt(I.Nat),
          memo: I.Opt(I.Vec(I.Nat8)),
          created_at_time: I.Opt(I.Nat64),
        }),
      ],
      [
        I.Variant({
          Ok: I.Nat,
          Err: I.Variant({
            BadFee: I.Record({ expected_fee: I.Nat }),
            InsufficientFunds: I.Record({ balance: I.Nat }),
            AllowanceChanged: I.Record({ current_allowance: I.Nat }),
            Expired: I.Record({ ledger_time: I.Nat64 }),
            TooOld: I.Null,
            CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
            Duplicate: I.Record({ duplicate_of: I.Nat }),
            TemporarilyUnavailable: I.Null,
            GenericError: I.Record({
              error_code: I.Nat,
              message: I.Text,
            }),
          }),
        }),
      ],
      [],
    ),
    icrc2_allowance: I.Func(
      [I.Record({ account: Acc, spender: Acc })],
      [
        I.Record({
          allowance: I.Nat,
          expires_at: I.Opt(I.Nat64),
        }),
      ],
      ["query"],
    ),
  });
};

type IcrcLedger = {
  icrc1_name: () => Promise<string>;
  icrc1_symbol: () => Promise<string>;
  icrc1_decimals: () => Promise<number>;
  icrc1_fee: () => Promise<bigint>;
  icrc1_balance_of: (a: {
    owner: Principal;
    subaccount: [] | [Uint8Array];
  }) => Promise<bigint>;
  icrc1_transfer: (args: {
    to: { owner: Principal; subaccount: [] | [Uint8Array] };
    fee: [] | [bigint];
    memo: [] | [Uint8Array];
    from_subaccount: [] | [Uint8Array];
    created_at_time: [] | [bigint];
    amount: bigint;
  }) => Promise<{ Ok: bigint } | { Err: unknown }>;
  icrc2_approve: (args: {
    from_subaccount: [] | [Uint8Array];
    spender: { owner: Principal; subaccount: [] | [Uint8Array] };
    amount: bigint;
    expected_allowance: [] | [bigint];
    expires_at: [] | [bigint];
    fee: [] | [bigint];
    memo: [] | [Uint8Array];
    created_at_time: [] | [bigint];
  }) => Promise<{ Ok: bigint } | { Err: unknown }>;
  icrc2_allowance: (args: {
    account: { owner: Principal; subaccount: [] | [Uint8Array] };
    spender: { owner: Principal; subaccount: [] | [Uint8Array] };
  }) => Promise<{ allowance: bigint; expires_at: [] | [bigint] }>;
};

export async function createAgent(
  identity?: Identity | null,
  host: string = IC_HOST,
): Promise<HttpAgent> {
  return HttpAgent.create({
    host,
    identity: identity ?? undefined,
  });
}

function isTransientTransportError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|timeout|502|503|504|gateway|HTTP\s*5\d\d|FetchError|ECONNRESET|ETIMEDOUT/i.test(
    msg,
  );
}

export function isDelegationOrSignatureError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid signature|invalid basic signature|delegation|expired|not authenticated|anonymous|401|403/i.test(
    msg,
  );
}

/**
 * Run an authenticated ledger call with IC host fallback on transient transport errors.
 * Does not retry signature/delegation failures (caller should re-auth).
 */
export async function withTransferHosts<T>(
  identity: Identity,
  fn: (agent: HttpAgent) => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < IC_TRANSFER_HOSTS.length; i++) {
    const host = IC_TRANSFER_HOSTS[i]!;
    try {
      const agent = await createAgent(identity, host);
      return await fn(agent);
    } catch (e) {
      last = e;
      if (isDelegationOrSignatureError(e)) throw e;
      if (!isTransientTransportError(e) || i === IC_TRANSFER_HOSTS.length - 1) {
        throw e;
      }
    }
  }
  throw last;
}

/** Reused anonymous agent for balance probes (avoids per-ledger HttpAgent create). */
let queryAgentPromise: Promise<HttpAgent> | null = null;

export function getAnonymousQueryAgent(): Promise<HttpAgent> {
  if (!queryAgentPromise) {
    queryAgentPromise = createAgent(null).catch((err) => {
      queryAgentPromise = null;
      throw err;
    });
  }
  return queryAgentPromise;
}

export function ledgerActor(agent: HttpAgent, canisterId: string): IcrcLedger {
  return Actor.createActor(icrc1Idl, { agent, canisterId }) as IcrcLedger;
}

export async function fetchIcrc1Balance(
  ledgerId: string,
  owner: string,
): Promise<bigint> {
  const agent = await getAnonymousQueryAgent();
  const ledger = ledgerActor(agent, ledgerId);
  return ledger.icrc1_balance_of({
    owner: Principal.fromText(owner),
    subaccount: [],
  });
}

/**
 * Balance probe for holdings. Pass knownDecimals to skip a live decimals query
 * (seeds / wallet registry already know scale). Send path still uses live fee/decimals.
 */
export async function fetchIcrc1BalanceWithDecimals(
  ledgerId: string,
  owner: string,
  opts?: { knownDecimals?: number },
): Promise<{ balance: bigint; decimals: number }> {
  const agent = await getAnonymousQueryAgent();
  const ledger = ledgerActor(agent, ledgerId);
  const ownerP = Principal.fromText(owner);
  const balanceP = ledger.icrc1_balance_of({ owner: ownerP, subaccount: [] });
  if (opts?.knownDecimals != null && Number.isFinite(opts.knownDecimals)) {
    return { balance: await balanceP, decimals: opts.knownDecimals };
  }
  const [balance, decimalsRaw] = await Promise.all([
    balanceP,
    ledger.icrc1_decimals().catch(() => 8),
  ]);
  return { balance, decimals: Number(decimalsRaw) };
}

export async function fetchIcpBalanceE8s(owner: string): Promise<bigint> {
  return fetchIcrc1Balance(ICP_LEDGER, owner);
}

export async function fetchIcrc1Meta(ledgerId: string): Promise<{
  symbol: string;
  name: string;
  decimals: number;
  fee: bigint;
}> {
  const agent = await createAgent(null);
  const ledger = ledgerActor(agent, ledgerId);
  const [symbol, name, decimals, fee] = await Promise.all([
    ledger.icrc1_symbol().catch(() => "TOKEN"),
    ledger.icrc1_name().catch(() => ledgerId.slice(0, 12)),
    ledger.icrc1_decimals().catch(() => 8),
    ledger.icrc1_fee().catch(() => 10_000n),
  ]);
  return { symbol, name, decimals: Number(decimals), fee };
}

function describeIcrc1TransferErr(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  }
  if ("InsufficientFunds" in err) {
    const balance = (err as { InsufficientFunds: { balance: bigint } })
      .InsufficientFunds.balance;
    return `Insufficient funds (balance ${balance.toString()} base units)`;
  }
  if ("BadFee" in err) {
    const expected = (err as { BadFee: { expected_fee: bigint } }).BadFee
      .expected_fee;
    return `Incorrect ledger fee (expected ${expected.toString()})`;
  }
  if ("Duplicate" in err) {
    const dup = (err as { Duplicate: { duplicate_of: bigint } }).Duplicate
      .duplicate_of;
    return `Duplicate transfer (block ${dup.toString()})`;
  }
  return JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

export async function transferIcrc1(opts: {
  identity: Identity;
  ledgerId: string;
  to: string;
  amount: bigint;
  memo?: Uint8Array;
}): Promise<bigint> {
  assertSpendTarget(opts.ledgerId);
  if (opts.amount <= 0n) {
    throw new Error("Transfer amount must be greater than zero");
  }
  const toOwner = Principal.fromText(opts.to);
  if (toOwner.isAnonymous()) {
    throw new Error("Anonymous principal is not a valid destination");
  }

  return withTransferHosts(opts.identity, async (agent) => {
    const ledger = ledgerActor(agent, opts.ledgerId);
    const fee = await ledger.icrc1_fee();
    const result = await ledger.icrc1_transfer({
      to: { owner: toOwner, subaccount: [] },
      fee: [fee],
      memo: opts.memo ? [opts.memo] : [],
      from_subaccount: [],
      created_at_time: [],
      amount: opts.amount,
    });
    if ("Err" in result) {
      throw new Error(`Transfer failed: ${describeIcrc1TransferErr(result.Err)}`);
    }
    return result.Ok;
  });
}

function describeLegacyTransferErr(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  }
  if ("InsufficientFunds" in err) {
    const bal = (err as { InsufficientFunds: { balance: { e8s: bigint } } })
      .InsufficientFunds.balance.e8s;
    return `Insufficient ICP (balance ${(Number(bal) / 1e8).toFixed(8)} ICP). Account ID sends need amount + 0.0001 ICP ledger fee after the Canopy micro-fee.`;
  }
  if ("BadFee" in err) {
    const expected = (err as { BadFee: { expected_fee: { e8s: bigint } } })
      .BadFee.expected_fee.e8s;
    return `Incorrect ledger fee (expected ${expected.toString()} e8s)`;
  }
  if ("TxDuplicate" in err) {
    const dup = (err as { TxDuplicate: { duplicate_of: bigint } }).TxDuplicate
      .duplicate_of;
    return `Duplicate transfer (block ${dup.toString()})`;
  }
  return JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function humanizeLegacyLedgerTrap(msg: string): string {
  if (/doesn't have enough funds|InsufficientFunds|insufficient funds/i.test(msg)) {
    return "Insufficient ICP for this Account ID send (need amount + 0.0001 ICP ledger fee after the Canopy micro-fee).";
  }
  if (/Checksum failed|Invalid account identifier/i.test(msg)) {
    return "Account ID checksum rejected by the ICP ledger — paste the full 64-character deposit address.";
  }
  if (/Invalid signature|invalid basic signature/i.test(msg)) {
    return "Internet Identity signature rejected — sign in again, then retry.";
  }
  return msg;
}

/**
 * Send ICP to a 64-char Account Identifier.
 * Primary: `send_dfx` (identical to Bazaar EXT escrow pays). Fallback: classic `transfer`.
 */
export async function transferIcpToAccountId(opts: {
  identity: Identity;
  toAccountIdHex: string;
  amountE8s: bigint;
  memo?: bigint;
}): Promise<bigint> {
  assertSpendTarget(ICP_LEDGER);
  if (opts.amountE8s <= 0n) {
    throw new Error("Transfer amount must be greater than zero");
  }
  if (!isAccountIdHex(opts.toAccountIdHex)) {
    throw new Error("Invalid ICP Account ID (expected 64 hex characters)");
  }
  const hex = normalizeAccountIdHex(opts.toAccountIdHex);
  if (!isValidAccountIdChecksum(hex)) {
    throw new Error(
      "Account ID checksum is invalid — paste the full 64-character deposit address",
    );
  }
  const toBytes = Array.from(accountIdHexToBytes(hex));
  const memo = opts.memo ?? 0n;

  return withTransferHosts(opts.identity, async (agent) => {
    const ledger = Actor.createActor(icpLegacyAccountIdIdl, {
      agent,
      canisterId: ICP_LEDGER,
    }) as {
      send_dfx: (arg: {
        to: string;
        fee: { e8s: bigint };
        memo: bigint;
        from_subaccount: [];
        created_at_time: [];
        amount: { e8s: bigint };
      }) => Promise<bigint>;
      transfer: (arg: {
        to: number[];
        fee: { e8s: bigint };
        memo: bigint;
        from_subaccount: [];
        created_at_time: [];
        amount: { e8s: bigint };
      }) => Promise<{ Ok: bigint } | { Err: unknown }>;
    };

    const argsBase = {
      fee: { e8s: ICP_LEDGER_FEE_E8S },
      memo,
      from_subaccount: [] as [],
      created_at_time: [] as [],
      amount: { e8s: opts.amountE8s },
    };

    // 1) Bazaar-proven path first
    try {
      const block = await ledger.send_dfx({ to: hex, ...argsBase });
      return BigInt(block);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If funds/checksum/signature — don't mask with a second attempt
      if (
        /enough funds|InsufficientFunds|Checksum failed|Invalid account identifier|Invalid signature|invalid basic signature/i.test(
          msg,
        )
      ) {
        throw new Error(
          `ICP Account ID transfer failed: ${humanizeLegacyLedgerTrap(msg)}`,
        );
      }
      // 2) Fallback classic transfer (Err variants)
      try {
        const result = await ledger.transfer({ to: toBytes, ...argsBase });
        if ("Err" in result) {
          throw new Error(
            `ICP Account ID transfer failed: ${describeLegacyTransferErr(result.Err)}`,
          );
        }
        return BigInt(result.Ok);
      } catch (e2) {
        if (
          e2 instanceof Error &&
          e2.message.startsWith("ICP Account ID transfer failed:")
        ) {
          throw e2;
        }
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(
          `ICP Account ID transfer failed: ${humanizeLegacyLedgerTrap(msg2)} (send_dfx: ${humanizeLegacyLedgerTrap(msg)})`,
        );
      }
    }
  });
}

/**
 * Approve spender (e.g. ICPSwap pool) to pull `amount` (+ fee buffer) via ICRC-2.
 * Amount should be the deposit amount; we approve amount + ledger fee.
 */
export async function approveIcrc2(opts: {
  identity: Identity;
  ledgerId: string;
  spender: string;
  amount: bigint;
  expiresInNs?: bigint;
}): Promise<bigint> {
  assertSpendTarget(opts.ledgerId);
  assertSpendTarget(opts.spender);
  const agent = await createAgent(opts.identity);
  const ledger = ledgerActor(agent, opts.ledgerId);
  const me = opts.identity.getPrincipal();
  const fee = await ledger.icrc1_fee();
  const spender = {
    owner: Principal.fromText(opts.spender),
    subaccount: [] as [] | [Uint8Array],
  };
  const allow = await ledger.icrc2_allowance({
    account: { owner: me, subaccount: [] },
    spender,
  });
  const approveAmount = opts.amount + fee;
  const expiresAt: [] | [bigint] = [
    BigInt(Date.now()) * 1_000_000n + (opts.expiresInNs ?? 600_000_000_000n),
  ];
  const result = await ledger.icrc2_approve({
    from_subaccount: [],
    spender,
    amount: approveAmount,
    expected_allowance: [allow.allowance],
    expires_at: expiresAt,
    fee: [fee],
    memo: [],
    created_at_time: [],
  });
  if ("Err" in result) {
    throw new Error(`icrc2_approve failed: ${JSON.stringify(result.Err)}`);
  }
  return result.Ok;
}

/**
 * Format ledger amount using full token decimals (micro units visible).
 * Always pads fractional digits so e.g. 1 e8 ICP shows as `0.00000001`.
 */
/** Parse a user-typed token amount. Rejects extra decimals and non-numeric input. */
export function parseTokenAmount(raw: string, decimals: number): bigint | null {
  const d = Math.max(0, Math.min(36, Math.floor(decimals)));
  const t = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  if (frac.length > d) return null;
  const fracPad = (frac + "0".repeat(d)).slice(0, d);
  try {
    return BigInt(whole || "0") * 10n ** BigInt(d) + BigInt(fracPad || "0");
  } catch {
    return null;
  }
}

/**
 * Positive proof the default subaccount can cover gross amount + two ledger fees
 * (Canopy fee leg + recipient leg). Query failure does not throw — callers must
 * not turn a flaky balance read into a send block.
 */
export async function assertFtSendWithinBalance(opts: {
  owner: Principal;
  ledgerId: string;
  grossAmount: bigint;
}): Promise<void> {
  try {
    const agent = await getAnonymousQueryAgent();
    const ledger = ledgerActor(agent, opts.ledgerId);
    const [balance, fee] = await Promise.all([
      ledger.icrc1_balance_of({ owner: opts.owner, subaccount: [] }),
      ledger.icrc1_fee(),
    ]);
    const need = opts.grossAmount + fee * 2n;
    if (balance < need) {
      throw new Error(
        `Not enough balance for this send. It needs the amount plus two ledger fees (${need.toString()} base units; balance ${balance.toString()}). Lower the amount or tap Max. Nothing was sent.`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Not enough balance")) throw e;
  }
}

export function formatToken(amount: bigint, decimals: number): string {
  const d = Math.max(0, Math.min(36, Math.floor(decimals)));
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  if (d === 0) return `${neg ? "-" : ""}${abs.toString()}`;
  const base = 10n ** BigInt(d);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(d, "0");
  const body = `${whole.toString()}.${fracStr}`;
  return neg ? `-${body}` : body;
}

/**
 * Max gross send amount that still leaves room for two ledger transfer fees
 * (fee leg + net leg). Canopy micro-fee is taken from the gross amount.
 */
export function maxSpendableFtAmount(
  balance: bigint,
  ledgerFee: bigint,
): bigint {
  const reserved = ledgerFee * 2n;
  if (balance <= reserved) return 0n;
  return balance - reserved;
}

