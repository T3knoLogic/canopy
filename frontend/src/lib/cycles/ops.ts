/**
 * Canopy cycles ops — in-house CMC mint / canister top-up / cycles-ledger
 * withdraw & transfer. Canopy micro-fee in ICP stacks on CMC and credits
 * the ICP↔cycles LP bucket (same pattern as swaps).
 */
import type { Identity } from "@dfinity/agent";
import { Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import {
  CMC,
  CYCLES_LEDGER,
  ICP_LEDGER,
  assertSpendTarget,
  assertTreasury,
  registerPoolAllow,
} from "../constants";
import {
  quoteCycleMarginE8s,
  recordFeeReceipt,
  recordPairLpCredit,
} from "../fees";
import {
  createAgent,
  fetchIcrc1Balance,
  ledgerActor,
  transferIcrc1,
} from "../ledger";

export const TOP_UP_CANISTER_MEMO = 0x50555054n; // TPUP
export const MINT_CYCLES_MEMO = 0x544e494dn; // MINT
export const ICP_TRANSFER_FEE_E8S = 10_000n;

const FALLBACK_CYCLES_PER_ICP = 3_000_000_000_000n;

/** 32-byte CMC / ledger subaccount from a principal (NNS convention). */
export function principalToSubaccount(p: Principal): Uint8Array {
  const bytes = p.toUint8Array();
  const out = new Uint8Array(32);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}

function memoBytes(memo: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let n = memo;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

export type CycleOpQuote = {
  icpE8s: bigint;
  marginE8s: bigint;
  netIcpE8s: bigint;
  treasury: string;
  estimatedCycles: bigint;
  cyclesPerIcp: bigint;
  bps: bigint;
};

const cmcIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const NotifyError = I.Variant({
    Refunded: I.Record({ reason: I.Text, block_index: I.Opt(I.Nat64) }),
    InvalidTransaction: I.Text,
    Other: I.Record({ error_message: I.Text, error_code: I.Nat64 }),
    Processing: I.Null,
    TransactionTooOld: I.Nat64,
  });
  return I.Service({
    get_icp_xdr_conversion_rate: I.Func(
      [],
      [
        I.Record({
          data: I.Record({
            xdr_permyriad_per_icp: I.Nat64,
            timestamp_seconds: I.Nat64,
          }),
          hash_tree: I.Vec(I.Nat8),
          certificate: I.Vec(I.Nat8),
        }),
      ],
      ["query"],
    ),
    notify_top_up: I.Func(
      [
        I.Record({
          block_index: I.Nat64,
          canister_id: I.Principal,
        }),
      ],
      [I.Variant({ Ok: I.Nat, Err: NotifyError })],
      [],
    ),
    notify_mint_cycles: I.Func(
      [
        I.Record({
          block_index: I.Nat64,
          to_subaccount: I.Opt(I.Vec(I.Nat8)),
          deposit_memo: I.Opt(I.Vec(I.Nat8)),
        }),
      ],
      [
        I.Variant({
          Ok: I.Record({
            minted: I.Nat,
            balance: I.Nat,
            block_index: I.Nat,
          }),
          Err: NotifyError,
        }),
      ],
      [],
    ),
  });
};

type CmcActor = {
  get_icp_xdr_conversion_rate: () => Promise<{
    data: { xdr_permyriad_per_icp: bigint };
  }>;
  notify_top_up: (a: {
    block_index: bigint;
    canister_id: Principal;
  }) => Promise<{ Ok: bigint } | { Err: unknown }>;
  notify_mint_cycles: (a: {
    block_index: bigint;
    to_subaccount: [] | [Uint8Array];
    deposit_memo: [] | [Uint8Array];
  }) => Promise<
    | { Ok: { minted: bigint; balance: bigint; block_index: bigint } }
    | { Err: unknown }
  >;
};

async function cmcActor(identity: Identity | null): Promise<CmcActor> {
  const agent = await createAgent(identity);
  return Actor.createActor(cmcIdl, {
    agent,
    canisterId: CMC,
  }) as CmcActor;
}

export async function fetchCyclesPerIcp(
  identity?: Identity | null,
): Promise<bigint> {
  try {
    const cmc = await cmcActor(identity ?? null);
    const r = await cmc.get_icp_xdr_conversion_rate();
    const permyriad = r.data.xdr_permyriad_per_icp;
    const cycles = (permyriad * 1_000_000_000_000n) / 10_000n;
    return cycles > 0n ? cycles : FALLBACK_CYCLES_PER_ICP;
  } catch {
    return FALLBACK_CYCLES_PER_ICP;
  }
}

export async function quoteCycleOp(icpE8s: bigint): Promise<CycleOpQuote> {
  const { marginE8s, treasury, bps } = await quoteCycleMarginE8s(icpE8s);
  const cyclesPerIcp = await fetchCyclesPerIcp(null);
  const netIcpE8s = icpE8s > marginE8s ? icpE8s - marginE8s : 0n;
  const estimatedCycles = (netIcpE8s * cyclesPerIcp) / 100_000_000n;
  return {
    icpE8s,
    marginE8s,
    netIcpE8s,
    treasury,
    estimatedCycles,
    cyclesPerIcp,
    bps,
  };
}

export async function payCycleMicroFee(
  identity: Identity,
  icpE8sGross: bigint,
): Promise<{
  marginE8s: bigint;
  treasury: string;
  netIcpE8s: bigint;
  bps: bigint;
}> {
  const q = await quoteCycleOp(icpE8sGross);
  if (q.marginE8s > 0n) {
    assertSpendTarget(ICP_LEDGER);
    assertTreasury(q.treasury);
    const block = await transferIcrc1({
      identity,
      ledgerId: ICP_LEDGER,
      to: q.treasury,
      amount: q.marginE8s,
    });
    await recordFeeReceipt(
      identity,
      "cycleTopUp",
      q.marginE8s,
      "cycleOp:icp→cycles",
      block,
    );
    await recordPairLpCredit(
      identity,
      ICP_LEDGER,
      CYCLES_LEDGER,
      ICP_LEDGER,
      q.marginE8s,
    );
  }
  return {
    marginE8s: q.marginE8s,
    treasury: q.treasury,
    netIcpE8s: q.netIcpE8s,
    bps: q.bps,
  };
}

async function transferIcpToCmc(opts: {
  identity: Identity;
  amountE8s: bigint;
  memo: bigint;
  toSubaccount?: Uint8Array;
}): Promise<bigint> {
  assertSpendTarget(ICP_LEDGER);
  registerPoolAllow(CMC);
  const agent = await createAgent(opts.identity);
  const ledger = ledgerActor(agent, ICP_LEDGER);
  const fee = await ledger.icrc1_fee();
  const result = await ledger.icrc1_transfer({
    to: {
      owner: Principal.fromText(CMC),
      subaccount: opts.toSubaccount ? [opts.toSubaccount] : [],
    },
    fee: [fee],
    memo: [memoBytes(opts.memo)],
    from_subaccount: [],
    created_at_time: [],
    amount: opts.amountE8s,
  });
  if ("Err" in result) {
    throw new Error(`ICP→CMC transfer failed: ${JSON.stringify(result.Err)}`);
  }
  return result.Ok;
}

export async function topUpCanisterInHouse(opts: {
  identity: Identity;
  canisterId: string;
  icpE8s: bigint;
}): Promise<{ cycles: bigint; feeE8s: bigint; block: bigint }> {
  const canister = Principal.fromText(opts.canisterId.trim());
  const fee = await payCycleMicroFee(opts.identity, opts.icpE8s);
  if (fee.netIcpE8s <= ICP_TRANSFER_FEE_E8S) {
    throw new Error("Amount too small after Canopy fee + ledger fee");
  }
  const block = await transferIcpToCmc({
    identity: opts.identity,
    amountE8s: fee.netIcpE8s,
    memo: TOP_UP_CANISTER_MEMO,
    toSubaccount: principalToSubaccount(canister),
  });
  const cmc = await cmcActor(opts.identity);
  const notified = await cmc.notify_top_up({
    block_index: block,
    canister_id: canister,
  });
  if ("Err" in notified) {
    throw new Error(`notify_top_up: ${JSON.stringify(notified.Err)}`);
  }
  return {
    cycles: notified.Ok,
    feeE8s: fee.marginE8s,
    block,
  };
}

export async function mintCyclesToWallet(opts: {
  identity: Identity;
  icpE8s: bigint;
}): Promise<{ cycles: bigint; feeE8s: bigint; block: bigint }> {
  const fee = await payCycleMicroFee(opts.identity, opts.icpE8s);
  if (fee.netIcpE8s <= ICP_TRANSFER_FEE_E8S) {
    throw new Error("Amount too small after Canopy fee + ledger fee");
  }
  const block = await transferIcpToCmc({
    identity: opts.identity,
    amountE8s: fee.netIcpE8s,
    memo: MINT_CYCLES_MEMO,
  });
  const cmc = await cmcActor(opts.identity);
  const minted = await cmc.notify_mint_cycles({
    block_index: block,
    to_subaccount: [],
    deposit_memo: [],
  });
  if ("Err" in minted) {
    throw new Error(`notify_mint_cycles: ${JSON.stringify(minted.Err)}`);
  }
  return {
    cycles: minted.Ok.minted,
    feeE8s: fee.marginE8s,
    block,
  };
}

const cyclesLedgerIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Account = I.Record({
    owner: I.Principal,
    subaccount: I.Opt(I.Vec(I.Nat8)),
  });
  const WithdrawError = I.Variant({
    GenericError: I.Record({ message: I.Text, error_code: I.Nat }),
    TemporarilyUnavailable: I.Null,
    FailedToWithdraw: I.Record({
      fee_block: I.Opt(I.Nat),
      rejection_code: I.Variant({
        NoError: I.Null,
        CanisterError: I.Null,
        SysTransient: I.Null,
        DestinationInvalid: I.Null,
        Unknown: I.Null,
        SysFatal: I.Null,
        CanisterReject: I.Null,
      }),
      rejection_reason: I.Text,
    }),
    Duplicate: I.Record({ duplicate_of: I.Nat }),
    BadFee: I.Record({ expected_fee: I.Nat }),
    InvalidReceiver: I.Record({ receiver: I.Principal }),
    CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
    TooOld: I.Null,
    InsufficientFunds: I.Record({ balance: I.Nat }),
  });
  return I.Service({
    icrc1_balance_of: I.Func([Account], [I.Nat], ["query"]),
    icrc1_fee: I.Func([], [I.Nat], ["query"]),
    icrc1_transfer: I.Func(
      [
        I.Record({
          from_subaccount: I.Opt(I.Vec(I.Nat8)),
          to: Account,
          amount: I.Nat,
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
            BadBurn: I.Record({ min_burn_amount: I.Nat }),
            InsufficientFunds: I.Record({ balance: I.Nat }),
            TooOld: I.Null,
            CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
            Duplicate: I.Record({ duplicate_of: I.Nat }),
            TemporarilyUnavailable: I.Null,
            GenericError: I.Record({ message: I.Text, error_code: I.Nat }),
          }),
        }),
      ],
      [],
    ),
    withdraw: I.Func(
      [
        I.Record({
          amount: I.Nat,
          from_subaccount: I.Opt(I.Vec(I.Nat8)),
          to: I.Principal,
          created_at_time: I.Opt(I.Nat64),
        }),
      ],
      [I.Variant({ Ok: I.Nat, Err: WithdrawError })],
      [],
    ),
    create_canister: I.Func(
      [
        I.Record({
          from_subaccount: I.Opt(I.Vec(I.Nat8)),
          created_at_time: I.Opt(I.Nat64),
          amount: I.Nat,
          creation_args: I.Opt(I.Reserved),
        }),
      ],
      [
        I.Variant({
          Ok: I.Record({ block_id: I.Nat, canister_id: I.Principal }),
          Err: I.Variant({
            InsufficientFunds: I.Record({ balance: I.Nat }),
            TooOld: I.Null,
            CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
            TemporarilyUnavailable: I.Null,
            Duplicate: I.Record({
              duplicate_of: I.Nat,
              canister_id: I.Opt(I.Principal),
            }),
            FailedToCreate: I.Record({
              fee_block: I.Opt(I.Nat),
              refund_block: I.Opt(I.Nat),
              error: I.Text,
            }),
            GenericError: I.Record({ message: I.Text, error_code: I.Nat }),
          }),
        }),
      ],
      [],
    ),
  });
};

type CyclesLedgerActor = {
  icrc1_fee: () => Promise<bigint>;
  icrc1_transfer: (a: {
    from_subaccount: [] | [Uint8Array];
    to: { owner: Principal; subaccount: [] | [Uint8Array] };
    amount: bigint;
    fee: [] | [bigint];
    memo: [] | [Uint8Array];
    created_at_time: [] | [bigint];
  }) => Promise<{ Ok: bigint } | { Err: unknown }>;
  withdraw: (a: {
    amount: bigint;
    from_subaccount: [] | [Uint8Array];
    to: Principal;
    created_at_time: [] | [bigint];
  }) => Promise<{ Ok: bigint } | { Err: unknown }>;
  create_canister: (a: {
    from_subaccount: [] | [Uint8Array];
    created_at_time: [] | [bigint];
    amount: bigint;
    creation_args: [];
  }) => Promise<
    | { Ok: { block_id: bigint; canister_id: Principal } }
    | { Err: unknown }
  >;
};

async function cyclesActor(identity: Identity | null): Promise<CyclesLedgerActor> {
  const agent = await createAgent(identity);
  return Actor.createActor(cyclesLedgerIdl, {
    agent,
    canisterId: CYCLES_LEDGER,
  }) as CyclesLedgerActor;
}

export async function fetchCyclesLedgerBalance(owner: string): Promise<bigint> {
  registerPoolAllow(CYCLES_LEDGER);
  return fetchIcrc1Balance(CYCLES_LEDGER, owner);
}

export async function withdrawCyclesToCanister(opts: {
  identity: Identity;
  canisterId: string;
  amount: bigint;
}): Promise<bigint> {
  registerPoolAllow(CYCLES_LEDGER);
  assertSpendTarget(CYCLES_LEDGER);
  const actor = await cyclesActor(opts.identity);
  const r = await actor.withdraw({
    amount: opts.amount,
    from_subaccount: [],
    to: Principal.fromText(opts.canisterId.trim()),
    created_at_time: [],
  });
  if ("Err" in r) throw new Error(`withdraw: ${JSON.stringify(r.Err)}`);
  return r.Ok;
}

export async function sendCyclesLedger(opts: {
  identity: Identity;
  to: string;
  amount: bigint;
}): Promise<bigint> {
  registerPoolAllow(CYCLES_LEDGER);
  assertSpendTarget(CYCLES_LEDGER);
  const actor = await cyclesActor(opts.identity);
  const fee = await actor.icrc1_fee();
  const r = await actor.icrc1_transfer({
    from_subaccount: [],
    to: { owner: Principal.fromText(opts.to.trim()), subaccount: [] },
    amount: opts.amount,
    fee: [fee],
    memo: [],
    created_at_time: [],
  });
  if ("Err" in r) throw new Error(`cycles transfer: ${JSON.stringify(r.Err)}`);
  return r.Ok;
}

export async function createCanisterFromCycles(opts: {
  identity: Identity;
  amount: bigint;
}): Promise<{ canisterId: string; blockId: bigint }> {
  registerPoolAllow(CYCLES_LEDGER);
  assertSpendTarget(CYCLES_LEDGER);
  const actor = await cyclesActor(opts.identity);
  const r = await actor.create_canister({
    from_subaccount: [],
    created_at_time: [],
    amount: opts.amount,
    creation_args: [],
  });
  if ("Err" in r) throw new Error(`create_canister: ${JSON.stringify(r.Err)}`);
  return {
    canisterId: r.Ok.canister_id.toText(),
    blockId: r.Ok.block_id,
  };
}

export function formatCycles(n: bigint): string {
  const abs = n < 0n ? -n : n;
  if (abs >= 1_000_000_000_000n) {
    const t = Number(abs) / 1e12;
    return `${t.toFixed(t >= 10 ? 2 : 3)} T`;
  }
  if (abs >= 1_000_000_000n) {
    return `${(Number(abs) / 1e9).toFixed(2)} B`;
  }
  if (abs >= 1_000_000n) {
    return `${(Number(abs) / 1e6).toFixed(2)} M`;
  }
  return abs.toLocaleString();
}

export { CYCLES_LEDGER, CMC };

export async function quoteCycleTopUp(icpE8s: bigint) {
  return quoteCycleOp(icpE8s);
}

export async function payCycleMarginFee(
  identity: Identity,
  marginE8s: bigint,
  treasury: string,
): Promise<bigint> {
  if (marginE8s <= 0n) return 0n;
  return transferIcrc1({
    identity,
    ledgerId: ICP_LEDGER,
    to: treasury,
    amount: marginE8s,
  });
}

export function nnsCyclesDeepLink(canisterId: string): string {
  return `https://nns.ic0.app/?canister=${encodeURIComponent(canisterId)}`;
}
