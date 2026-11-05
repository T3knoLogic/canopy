/**
 * Smoke: decode ICPSwap pool metadata with corrected IDL (no tickSpacing).
 * Usage: node scripts/smoke-icpswap-metadata.mjs [poolCanisterId]
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";

const poolId = process.argv[2] || "xmiu5-jqaaa-aaaag-qbz7q-cai"; // ICP-ckBTC

const poolMetaIdl = ({ IDL: I }) => {
  const Token = I.Record({ address: I.Text, standard: I.Text });
  const Err = I.Variant({
    CommonError: I.Null,
    InsufficientFunds: I.Null,
    InternalError: I.Text,
    UnsupportedToken: I.Text,
  });
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
    metadata: I.Func([], [I.Variant({ ok: PoolMetadata, err: Err })], ["query"]),
  });
};

const agent = await HttpAgent.create({ host: "https://icp-api.io" });
const actor = Actor.createActor(poolMetaIdl, { agent, canisterId: poolId });
const r = await actor.metadata();
if (!("ok" in r)) {
  console.error("metadata err", r);
  process.exit(1);
}
console.log("ok", {
  pool: poolId,
  fee: r.ok.fee.toString(),
  tick: r.ok.tick.toString(),
  token0: r.ok.token0.address,
  token1: r.ok.token1.address,
});
