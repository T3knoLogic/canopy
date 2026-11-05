/**
 * Multi-boundary ICPSwap factory reads — require pool id consensus before approve/deposit.
 * Query responses are single-replica; agreeing hosts reduce spoof risk.
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import {
  ICP_LEDGER,
  ICPSWAP_API,
  ICPSWAP_FACTORY,
  registerPoolAllow,
} from "../constants";

export type SwapQuote = {
  venue: "icpswap" | "kong" | "iclighthouse";
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutEstimated: bigint;
  poolCanisterId?: string;
  routeLabel: string;
  deepLink?: string;
};

/** Distinct IC HTTP gateways — same subnet query via independent boundaries. */
const IC_QUERY_HOSTS = [
  "https://icp-api.io",
  "https://icp0.io",
  "https://ic0.app",
] as const;

const factoryIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Token = I.Record({ address: I.Text, standard: I.Text });
  const Err = I.Variant({
    CommonError: I.Null,
    InsufficientFunds: I.Null,
    InternalError: I.Text,
    UnsupportedToken: I.Text,
  });
  /** Factory PoolData — includes tickSpacing (not present on pool metadata()). */
  const PoolData = I.Record({
    fee: I.Nat,
    key: I.Text,
    tickSpacing: I.Int,
    token0: Token,
    token1: Token,
    canisterId: I.Principal,
  });
  return I.Service({
    getPool: I.Func(
      [I.Record({ token0: Token, token1: Token, fee: I.Nat })],
      [I.Variant({ ok: PoolData, err: Err })],
      ["query"],
    ),
  });
};

type FactoryOk = {
  canisterId: Principal;
  fee: bigint;
  key: string;
  tickSpacing: bigint;
  token0: { address: string; standard: string };
  token1: { address: string; standard: string };
};

type Factory = {
  getPool: (args: {
    token0: { address: string; standard: string };
    token1: { address: string; standard: string };
    fee: bigint;
  }) => Promise<{ ok: FactoryOk } | { err: string }>;
};

function tokenStandard(address: string): string {
  if (address === ICP_LEDGER) return "ICP";
  return "ICRC2";
}

export type IcpSwapPoolData = {
  canisterId: string;
  fee: bigint;
  token0: { address: string; standard: string };
  token1: { address: string; standard: string };
  tickSpacing: bigint;
};

function poolFingerprint(p: IcpSwapPoolData): string {
  return [
    p.canisterId.toLowerCase(),
    p.token0.address.toLowerCase(),
    p.token1.address.toLowerCase(),
    p.fee.toString(),
  ].join("|");
}

/** Session-scoped last good pool fingerprints (pairKey → fp). */
const sessionPoolFingerprints = new Map<string, string>();

function pairKey(a: string, b: string, fee: bigint): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}|${y}|${fee}`;
}

export function getSessionPoolFingerprint(
  tokenA: string,
  tokenB: string,
  fee: bigint = 3000n,
): string | undefined {
  return sessionPoolFingerprints.get(pairKey(tokenA, tokenB, fee));
}

const poolMetaIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Token = I.Record({ address: I.Text, standard: I.Text });
  const Err = I.Variant({
    CommonError: I.Null,
    InsufficientFunds: I.Null,
    InternalError: I.Text,
    UnsupportedToken: I.Text,
  });
  /**
   * Live SwapPool.metadata() PoolMetadata — no tickSpacing (factory-only).
   * @see ICPSwap Types.PoolMetadata
   */
  const PoolMetadata = I.Record({
    fee: I.Nat,
    key: I.Text,
    tick: I.Int,
    liquidity: I.Nat,
    sqrtPriceX96: I.Nat,
    maxLiquidityPerTick: I.Nat,
    nextPositionId: I.Nat,
    token0: Token,
    token1: Token,
  });
  return I.Service({
    metadata: I.Func(
      [],
      [I.Variant({ ok: PoolMetadata, err: Err })],
      ["query"],
    ),
  });
};

async function verifyPoolMetadataOnHosts(
  pool: IcpSwapPoolData,
): Promise<void> {
  const checks = await Promise.all(
    IC_QUERY_HOSTS.slice(0, 2).map(async (host) => {
      const agent = await HttpAgent.create({ host });
      const actor = Actor.createActor(poolMetaIdl, {
        agent,
        canisterId: pool.canisterId,
      }) as {
        metadata: () => Promise<
          | {
              ok: {
                fee: bigint;
                token0: { address: string; standard: string };
                token1: { address: string; standard: string };
              };
            }
          | { err: string }
        >;
      };
      const r = await actor.metadata();
      if (!("ok" in r)) return null;
      return {
        token0: r.ok.token0.address.toLowerCase(),
        token1: r.ok.token1.address.toLowerCase(),
        fee: r.ok.fee.toString(),
      };
    }),
  );
  const ok = checks.filter(Boolean);
  if (ok.length < 2) {
    throw new Error(
      "Could not verify pool metadata on two IC gateways — refusing approve",
    );
  }
  const expect0 = pool.token0.address.toLowerCase();
  const expect1 = pool.token1.address.toLowerCase();
  for (const m of ok) {
    if (!m) continue;
    const match =
      (m.token0 === expect0 && m.token1 === expect1) ||
      (m.token0 === expect1 && m.token1 === expect0);
    if (!match || m.fee !== pool.fee.toString()) {
      throw new Error(
        "Pool metadata does not match factory result — refusing swap (possible spoof)",
      );
    }
  }
}

function toPoolData(ok: FactoryOk): IcpSwapPoolData {
  return {
    canisterId: ok.canisterId.toText(),
    fee: ok.fee,
    token0: ok.token0,
    token1: ok.token1,
    tickSpacing: ok.tickSpacing,
  };
}

async function getPoolFromHost(
  host: string,
  tokenA: string,
  tokenB: string,
  fee: bigint,
): Promise<IcpSwapPoolData | null> {
  const agent = await HttpAgent.create({ host });
  const factory = Actor.createActor(factoryIdl, {
    agent,
    canisterId: ICPSWAP_FACTORY,
  }) as Factory;
  const tryOrder = async (a: string, b: string) => {
    const r = await factory.getPool({
      token0: { address: a, standard: tokenStandard(a) },
      token1: { address: b, standard: tokenStandard(b) },
      fee,
    });
    if ("ok" in r) return toPoolData(r.ok);
    return null;
  };
  return (await tryOrder(tokenA, tokenB)) ?? (await tryOrder(tokenB, tokenA));
}

/** Resolve ICPSwap pool for a pair — try common fee tiers (0.05% / 0.3% / 1%). */
export async function getIcpSwapPoolData(
  tokenA: string,
  tokenB: string,
  fee: bigint = 3000n,
): Promise<IcpSwapPoolData | null> {
  const tiers =
    fee === 3000n ? ([3000n, 500n, 10000n, 100n] as const) : ([fee] as const);
  let lastErr: unknown;
  for (const tier of tiers) {
    try {
      const data = await getIcpSwapPoolDataForFee(tokenA, tokenB, tier);
      if (data) return data;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * Resolve pool via ≥2 agreeing IC gateways for a single fee tier.
 * Refuses if hosts disagree on pool id / tokens.
 */
async function getIcpSwapPoolDataForFee(
  tokenA: string,
  tokenB: string,
  fee: bigint,
): Promise<IcpSwapPoolData | null> {
  const results = await Promise.all(
    IC_QUERY_HOSTS.map((host) =>
      getPoolFromHost(host, tokenA, tokenB, fee).catch(() => null),
    ),
  );
  const ok = results.filter((r): r is IcpSwapPoolData => r != null);
  if (ok.length === 0) return null;

  const tallies = new Map<string, { count: number; sample: IcpSwapPoolData }>();
  for (const p of ok) {
    const fp = poolFingerprint(p);
    const prev = tallies.get(fp);
    if (prev) prev.count += 1;
    else tallies.set(fp, { count: 1, sample: p });
  }

  let best: { count: number; sample: IcpSwapPoolData } | null = null;
  for (const v of tallies.values()) {
    if (!best || v.count > best.count) best = v;
  }
  if (!best) return null;

  // Require agreement from at least 2 boundaries when ≥2 answered; if only 1 host answered, refuse for spend path safety
  const answered = ok.length;
  if (answered >= 2 && best.count < 2) {
    throw new Error(
      "ICPSwap pool mismatch across IC gateways — refusing swap (possible query spoof)",
    );
  }
  if (answered === 1) {
    throw new Error(
      "Only one IC gateway returned a pool — need multi-boundary consensus before approve",
    );
  }

  await verifyPoolMetadataOnHosts(best.sample);

  const key = pairKey(tokenA, tokenB, fee);
  const fp = poolFingerprint(best.sample);
  const prev = sessionPoolFingerprints.get(key);
  if (prev && prev !== fp) {
    throw new Error(
      "Pool identity changed mid-session — refusing swap. Refresh and retry.",
    );
  }
  sessionPoolFingerprints.set(key, fp);

  registerPoolAllow(best.sample.canisterId);
  return best.sample;
}

/** Resolve ICPSwap pool for a pair (common 3000 fee tier first). */
export async function resolveIcpSwapPool(
  tokenA: string,
  tokenB: string,
  fee: bigint = 3000n,
): Promise<string | null> {
  const data = await getIcpSwapPoolData(tokenA, tokenB, fee);
  return data?.canisterId ?? null;
}

export type IcpSwapTokenInfo = {
  tokenLedgerId: string;
  tokenSymbol: string;
  price: string;
  priceChange24H?: string;
  tokenName?: string;
};

export async function fetchIcpSwapTokenInfos(): Promise<IcpSwapTokenInfo[]> {
  try {
    const res = await fetch(`${ICPSWAP_API}/info/token/all`);
    if (!res.ok) return [];
    const raw = (await res.json()) as
      | IcpSwapTokenInfo[]
      | { data?: IcpSwapTokenInfo[] };
    const data = Array.isArray(raw) ? raw : raw.data;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Rough quote using ICPSwap public prices (USD). Not a pool quote —
 * UI shows estimated out; live swap still requires pool deposit+swap flow.
 */
export async function quoteIcpSwapViaApi(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  decimalsIn: number,
  decimalsOut: number,
): Promise<SwapQuote | null> {
  const infos = await fetchIcpSwapTokenInfos();
  const a = infos.find((t) => t.tokenLedgerId === tokenIn);
  const b = infos.find((t) => t.tokenLedgerId === tokenOut);
  if (!a || !b) return null;
  const priceIn = Number(a.price);
  const priceOut = Number(b.price);
  if (!(priceIn > 0) || !(priceOut > 0)) return null;
  const humanIn = Number(amountIn) / 10 ** decimalsIn;
  const usd = humanIn * priceIn;
  const humanOut = usd / priceOut;
  let amountOut = BigInt(Math.floor(humanOut * 10 ** decimalsOut));
  let pool: string | undefined;
  try {
    const data = await getIcpSwapPoolData(tokenIn, tokenOut);
    if (data) {
      pool = data.canisterId;
      const zfo =
        data.token0.address.toLowerCase() === tokenIn.toLowerCase();
      const live = await quoteIcpSwapPool(pool, amountIn, zfo);
      if (live != null && live > 0n) amountOut = live;
    }
  } catch {
    /* keep API estimate; spend path still requires consensus */
  }
  return {
    venue: "icpswap",
    tokenIn,
    tokenOut,
    amountIn,
    amountOutEstimated: amountOut,
    poolCanisterId: pool,
    routeLabel: `ICPSwap · ${a.tokenSymbol}→${b.tokenSymbol}`,
  };
}

const poolQuoteIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Err = I.Variant({
    CommonError: I.Null,
    InsufficientFunds: I.Null,
    InternalError: I.Text,
    UnsupportedToken: I.Text,
  });
  return I.Service({
    quote: I.Func(
      [
        I.Record({
          amountIn: I.Text,
          amountOutMinimum: I.Text,
          zeroForOne: I.Bool,
        }),
      ],
      [I.Variant({ ok: I.Nat, err: Err })],
      ["query"],
    ),
  });
};

export async function quoteIcpSwapPool(
  poolId: string,
  amountIn: bigint,
  zeroForOne: boolean,
): Promise<bigint | null> {
  try {
    // Quote via primary + secondary host; prefer agreeing amounts
    const quotes = await Promise.all(
      IC_QUERY_HOSTS.slice(0, 2).map(async (host) => {
        const agent = await HttpAgent.create({ host });
        const pool = Actor.createActor(poolQuoteIdl, {
          agent,
          canisterId: poolId,
        }) as {
          quote: (a: {
            amountIn: string;
            amountOutMinimum: string;
            zeroForOne: boolean;
          }) => Promise<{ ok: bigint } | { err: string }>;
        };
        const r = await pool.quote({
          amountIn: amountIn.toString(),
          amountOutMinimum: "0",
          zeroForOne,
        });
        return "ok" in r ? r.ok : null;
      }),
    );
    const ok = quotes.filter((q): q is bigint => q != null);
    if (ok.length === 0) return null;
    if (ok.length >= 2 && ok[0] !== ok[1]) {
      // Prefer the lower out (safer for minOut calc downstream)
      return ok[0]! < ok[1]! ? ok[0]! : ok[1]!;
    }
    return ok[0]!;
  } catch {
    return null;
  }
}
