/**
 * In-wallet ICPSwap V3 path: ICRC-2 approve → depositFrom → swap → withdraw.
 * Canopy micro-fee is paid separately (stacks on venue fees) before calling this.
 */
import type { Identity } from "@dfinity/agent";
import { Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { assertSpendTarget, registerPoolAllow } from "../constants";
import {
  approveIcrc2,
  createAgent,
  fetchIcrc1Meta,
  ledgerActor,
} from "../ledger";
import {
  getIcpSwapPoolData,
  quoteIcpSwapPool,
  type IcpSwapPoolData,
} from "./icpswap";

const poolTradeIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Err = I.Variant({
    CommonError: I.Null,
    InsufficientFunds: I.Null,
    InternalError: I.Text,
    UnsupportedToken: I.Text,
  });
  const Result = I.Variant({ ok: I.Nat, err: Err });
  return I.Service({
    depositFrom: I.Func(
      [I.Record({ fee: I.Nat, token: I.Text, amount: I.Nat })],
      [Result],
      [],
    ),
    swap: I.Func(
      [
        I.Record({
          amountIn: I.Text,
          zeroForOne: I.Bool,
          amountOutMinimum: I.Text,
        }),
      ],
      [Result],
      [],
    ),
    withdraw: I.Func(
      [I.Record({ fee: I.Nat, token: I.Text, amount: I.Nat })],
      [Result],
      [],
    ),
    getUserUnusedBalance: I.Func(
      [I.Principal],
      [
        I.Variant({
          ok: I.Record({ balance0: I.Nat, balance1: I.Nat }),
          err: Err,
        }),
      ],
      ["query"],
    ),
  });
};

type PoolTrade = {
  depositFrom: (a: {
    fee: bigint;
    token: string;
    amount: bigint;
  }) => Promise<{ ok: bigint } | { err: unknown }>;
  swap: (a: {
    amountIn: string;
    zeroForOne: boolean;
    amountOutMinimum: string;
  }) => Promise<{ ok: bigint } | { err: unknown }>;
  withdraw: (a: {
    fee: bigint;
    token: string;
    amount: bigint;
  }) => Promise<{ ok: bigint } | { err: unknown }>;
  getUserUnusedBalance: (
    p: Principal,
  ) => Promise<
    { ok: { balance0: bigint; balance1: bigint } } | { err: unknown }
  >;
};

function unwrapOk<T>(r: { ok: T } | { err: unknown }, label: string): T {
  if ("err" in r) throw new Error(`${label}: ${JSON.stringify(r.err)}`);
  return r.ok;
}

export type ExecuteIcpSwapResult = {
  poolId: string;
  amountIn: bigint;
  amountOut: bigint;
  zeroForOne: boolean;
};

export async function executeIcpSwapIcrc2(opts: {
  identity: Identity;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  /** Slippage tolerance in bps (default 100 = 1%). */
  slippageBps?: bigint;
  pool?: IcpSwapPoolData | null;
}): Promise<ExecuteIcpSwapResult> {
  assertSpendTarget(opts.tokenIn);
  const slippageBps = opts.slippageBps ?? 100n;
  const pool =
    opts.pool ??
    (await getIcpSwapPoolData(opts.tokenIn, opts.tokenOut));
  if (!pool) throw new Error("No ICPSwap pool for this pair (fee tier 3000)");
  registerPoolAllow(pool.canisterId);

  const zeroForOne = pool.token0.address.toLowerCase() === opts.tokenIn.toLowerCase();
  if (
    !zeroForOne &&
    pool.token1.address.toLowerCase() !== opts.tokenIn.toLowerCase()
  ) {
    throw new Error("tokenIn is not in resolved pool");
  }
  const outOk =
    (zeroForOne &&
      pool.token1.address.toLowerCase() === opts.tokenOut.toLowerCase()) ||
    (!zeroForOne &&
      pool.token0.address.toLowerCase() === opts.tokenOut.toLowerCase());
  if (!outOk) {
    throw new Error("tokenOut is not in resolved pool — refusing swap");
  }

  let approved = false;
  try {
    const quoted = await quoteIcpSwapPool(pool.canisterId, opts.amountIn, zeroForOne);
    if (quoted == null || quoted <= 0n) {
      throw new Error("Pool quote failed — try a smaller amount or another pair");
    }
    const minOut = (quoted * (10_000n - slippageBps)) / 10_000n;

    const inMeta = await fetchIcrc1Meta(opts.tokenIn);
    const outMeta = await fetchIcrc1Meta(opts.tokenOut);

    await approveIcrc2({
      identity: opts.identity,
      ledgerId: opts.tokenIn,
      spender: pool.canisterId,
      amount: opts.amountIn,
    });
    approved = true;

    const agent = await createAgent(opts.identity);
    const trade = Actor.createActor(poolTradeIdl, {
      agent,
      canisterId: pool.canisterId,
    }) as PoolTrade;

    unwrapOk(
      await trade.depositFrom({
        token: opts.tokenIn,
        amount: opts.amountIn,
        fee: inMeta.fee,
      }),
      "depositFrom",
    );

    const amountOut = unwrapOk(
      await trade.swap({
        amountIn: opts.amountIn.toString(),
        zeroForOne,
        amountOutMinimum: minOut.toString(),
      }),
      "swap",
    );

    const me = opts.identity.getPrincipal();
    const unused = await trade.getUserUnusedBalance(me);
    let withdrawAmt = amountOut;
    if ("ok" in unused) {
      const bal = zeroForOne ? unused.ok.balance1 : unused.ok.balance0;
      if (bal > 0n) withdrawAmt = bal;
    }

    if (withdrawAmt > 0n) {
      unwrapOk(
        await trade.withdraw({
          token: opts.tokenOut,
          amount: withdrawAmt,
          fee: outMeta.fee,
        }),
        "withdraw",
      );
    }

    return {
      poolId: pool.canisterId,
      amountIn: opts.amountIn,
      amountOut: withdrawAmt,
      zeroForOne,
    };
  } finally {
    if (approved) {
      await revokePoolAllowance(
        opts.identity,
        opts.tokenIn,
        pool.canisterId,
      );
    }
  }
}

/** Best-effort revoke allowance after a failed mid-flow (expiry still backs us). */
export async function revokePoolAllowance(
  identity: Identity,
  ledgerId: string,
  poolId: string,
): Promise<void> {
  try {
    const agent = await createAgent(identity);
    const ledger = ledgerActor(agent, ledgerId);
    const fee = await ledger.icrc1_fee();
    await ledger.icrc2_approve({
      from_subaccount: [],
      spender: { owner: Principal.fromText(poolId), subaccount: [] },
      amount: 0n,
      expected_allowance: [],
      expires_at: [],
      fee: [fee],
      memo: [],
      created_at_time: [],
    });
  } catch {
    /* error-policy:J6 best-effort revoke */
  }
}
