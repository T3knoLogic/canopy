/**
 * Seed ICPSwap LP from accumulated Canopy pair fee credits.
 *
 * Credits are accounting on canopy_fees; tokens live with whoever received
 * swap fees (treasury / ops II). This path deposits fee tokens into the pair
 * pool, swaps ~half for the other side, mints a full-range position, then
 * consumes the credit on the fees canister (owner).
 */
import type { Identity } from "@dfinity/agent";
import { Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { registerPoolAllow } from "../constants";
import {
  approveIcrc2,
  createAgent,
  fetchIcrc1Balance,
  fetchIcrc1Meta,
} from "../ledger";
import {
  consumePairLpCredit,
  listPairLpCredits,
  type PairLpCredit,
} from "../fees";
import {
  getIcpSwapPoolData,
  quoteIcpSwapPool,
  type IcpSwapPoolData,
} from "../swap/icpswap";

const poolLpIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Err = I.Variant({
    CommonError: I.Null,
    InsufficientFunds: I.Null,
    InternalError: I.Text,
    UnsupportedToken: I.Text,
  });
  const Result = I.Variant({ ok: I.Nat, err: Err });
  const Token = I.Record({ address: I.Text, standard: I.Text });
  const PoolMetadata = I.Record({
    fee: I.Nat,
    key: I.Text,
    sqrtPriceX96: I.Nat,
    tick: I.Int,
    liquidity: I.Nat,
    maxLiquidityPerTick: I.Nat,
    nextPositionId: I.Nat,
    token0: Token,
    token1: Token,
  });
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
    mint: I.Func(
      [
        I.Record({
          token0: I.Text,
          token1: I.Text,
          fee: I.Nat,
          tickLower: I.Int,
          tickUpper: I.Int,
          amount0Desired: I.Text,
          amount1Desired: I.Text,
        }),
      ],
      [Result],
      [],
    ),
    increaseLiquidity: I.Func(
      [
        I.Record({
          positionId: I.Nat,
          amount0Desired: I.Text,
          amount1Desired: I.Text,
        }),
      ],
      [Result],
      [],
    ),
    getUserPositionIdsByPrincipal: I.Func(
      [I.Principal],
      [I.Variant({ ok: I.Vec(I.Nat), err: Err })],
      ["query"],
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
    metadata: I.Func(
      [],
      [I.Variant({ ok: PoolMetadata, err: Err })],
      ["query"],
    ),
    withdraw: I.Func(
      [I.Record({ fee: I.Nat, token: I.Text, amount: I.Nat })],
      [Result],
      [],
    ),
  });
};

type PoolLp = {
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
  mint: (a: {
    token0: string;
    token1: string;
    fee: bigint;
    tickLower: bigint;
    tickUpper: bigint;
    amount0Desired: string;
    amount1Desired: string;
  }) => Promise<{ ok: bigint } | { err: unknown }>;
  increaseLiquidity: (a: {
    positionId: bigint;
    amount0Desired: string;
    amount1Desired: string;
  }) => Promise<{ ok: bigint } | { err: unknown }>;
  getUserPositionIdsByPrincipal: (
    p: Principal,
  ) => Promise<{ ok: bigint[] } | { err: unknown }>;
  getUserUnusedBalance: (
    p: Principal,
  ) => Promise<
    { ok: { balance0: bigint; balance1: bigint } } | { err: unknown }
  >;
  metadata: () => Promise<
    | {
        ok: {
          fee: bigint;
          token0: { address: string };
          token1: { address: string };
        };
      }
    | { err: unknown }
  >;
  withdraw: (a: {
    fee: bigint;
    token: string;
    amount: bigint;
  }) => Promise<{ ok: bigint } | { err: unknown }>;
};

function unwrapOk<T>(r: { ok: T } | { err: unknown }, label: string): T {
  if ("err" in r) throw new Error(`${label}: ${JSON.stringify(r.err)}`);
  return r.ok;
}

/** Full-range ticks for fee=3000 (tickSpacing 60). */
const FULL_TICK_LOWER = -887220n;
const FULL_TICK_UPPER = 887220n;

export type LpSeedPlan = {
  credit: PairLpCredit;
  pool: IcpSwapPoolData;
  feeLedger: string;
  otherLedger: string;
  amount: bigint;
  halfSwap: bigint;
};

export async function buildLpSeedPlan(
  credit: PairLpCredit,
): Promise<LpSeedPlan | null> {
  if (credit.amount <= 0n) return null;
  const pool = await getIcpSwapPoolData(credit.tokenIn, credit.tokenOut);
  if (!pool) return null;
  const feeLedger = credit.feeLedger.toLowerCase();
  const t0 = pool.token0.address.toLowerCase();
  const t1 = pool.token1.address.toLowerCase();
  if (feeLedger !== t0 && feeLedger !== t1) return null;
  const otherLedger = feeLedger === t0 ? t1 : t0;
  const halfSwap = credit.amount / 2n;
  if (halfSwap <= 0n) return null;
  return {
    credit,
    pool,
    feeLedger,
    otherLedger,
    amount: credit.amount,
    halfSwap,
  };
}

export async function listLpSeedPlans(limit = 50): Promise<LpSeedPlan[]> {
  const credits = await listPairLpCredits(limit);
  const plans: LpSeedPlan[] = [];
  for (const c of credits) {
    const p = await buildLpSeedPlan(c);
    if (p) plans.push(p);
  }
  return plans;
}

/**
 * Execute LP seed from caller's wallet (must hold `plan.amount` of feeLedger).
 * Then consume credit via fees canister (caller must be fees owner).
 */
export async function executeLpSeed(opts: {
  identity: Identity;
  plan: LpSeedPlan;
  consumeCredit?: boolean;
}): Promise<{ positionId: bigint; poolId: string; detail: string }> {
  const { plan, identity } = opts;
  const me = identity.getPrincipal();
  const bal = await fetchIcrc1Balance(plan.feeLedger, me.toText());
  if (bal < plan.amount) {
    throw new Error(
      `Need ${plan.amount.toString()} on ${plan.feeLedger} (have ${bal.toString()}). Fund ops/treasury II first.`,
    );
  }

  registerPoolAllow(plan.pool.canisterId);
  const feeMeta = await fetchIcrc1Meta(plan.feeLedger);
  const otherMeta = await fetchIcrc1Meta(plan.otherLedger);

  await approveIcrc2({
    identity,
    ledgerId: plan.feeLedger,
    spender: plan.pool.canisterId,
    amount: plan.amount,
  });

  const agent = await createAgent(identity);
  const pool = Actor.createActor(poolLpIdl, {
    agent,
    canisterId: plan.pool.canisterId,
  }) as PoolLp;

  unwrapOk(
    await pool.depositFrom({
      token: plan.feeLedger,
      amount: plan.amount,
      fee: feeMeta.fee,
    }),
    "depositFrom",
  );

  const zeroForOne =
    plan.pool.token0.address.toLowerCase() === plan.feeLedger;
  const quoted = await quoteIcpSwapPool(
    plan.pool.canisterId,
    plan.halfSwap,
    zeroForOne,
  );
  const minOut =
    quoted != null && quoted > 0n ? (quoted * 98n) / 100n : 0n;

  unwrapOk(
    await pool.swap({
      amountIn: plan.halfSwap.toString(),
      zeroForOne,
      amountOutMinimum: minOut.toString(),
    }),
    "rebalance-swap",
  );

  const unused = unwrapOk(await pool.getUserUnusedBalance(me), "unused");
  const amount0 = unused.balance0;
  const amount1 = unused.balance1;
  if (amount0 === 0n && amount1 === 0n) {
    throw new Error("No unused balance after rebalance — abort mint");
  }

  const positions = await pool.getUserPositionIdsByPrincipal(me);
  let positionId = 0n;
  if ("ok" in positions && positions.ok.length > 0) {
    positionId = unwrapOk(
      await pool.increaseLiquidity({
        positionId: positions.ok[0]!,
        amount0Desired: amount0.toString(),
        amount1Desired: amount1.toString(),
      }),
      "increaseLiquidity",
    );
  } else {
    const meta = unwrapOk(await pool.metadata(), "metadata");
    positionId = unwrapOk(
      await pool.mint({
        token0: meta.token0.address,
        token1: meta.token1.address,
        fee: meta.fee,
        tickLower: FULL_TICK_LOWER,
        tickUpper: FULL_TICK_UPPER,
        amount0Desired: amount0.toString(),
        amount1Desired: amount1.toString(),
      }),
      "mint",
    );
  }

  // Refund dust left unused
  const left = await pool.getUserUnusedBalance(me);
  if ("ok" in left) {
    if (left.ok.balance0 > feeMeta.fee) {
      try {
        await pool.withdraw({
          token: plan.pool.token0.address,
          amount: left.ok.balance0,
          fee: plan.pool.token0.address.toLowerCase() === plan.feeLedger
            ? feeMeta.fee
            : otherMeta.fee,
        });
      } catch {
        /* dust */
      }
    }
    if (left.ok.balance1 > otherMeta.fee) {
      try {
        await pool.withdraw({
          token: plan.pool.token1.address,
          amount: left.ok.balance1,
          fee: plan.pool.token1.address.toLowerCase() === plan.feeLedger
            ? feeMeta.fee
            : otherMeta.fee,
        });
      } catch {
        /* dust */
      }
    }
  }

  if (opts.consumeCredit !== false) {
    await consumePairLpCredit(
      identity,
      plan.credit.tokenIn,
      plan.credit.tokenOut,
      plan.credit.feeLedger,
      plan.credit.amount,
    );
  }

  return {
    positionId,
    poolId: plan.pool.canisterId,
    detail: `LP position ${positionId.toString()} on ${plan.pool.canisterId}`,
  };
}

export type { PairLpCredit };
