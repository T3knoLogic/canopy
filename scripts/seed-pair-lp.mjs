#!/usr/bin/env node
/**
 * Ops: list Canopy pair LP credits and optionally print seed plans.
 * Live seed runs in the Canopy UI (II as fees owner + funded fee tokens).
 *
 *   node scripts/seed-pair-lp.mjs
 *   node scripts/seed-pair-lp.mjs --json
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";

const FEES =
  process.env.CANOPY_FEES_CANISTER || "7o5gc-syaaa-aaaau-ag6cq-cai";
const HOST = process.env.IC_HOST || "https://icp0.io";

const idl = ({ IDL: I }) =>
  I.Service({
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
    getConfig: I.Func(
      [],
      [
        I.Record({
          swapFeeBps: I.Nat,
          nftSendFeeE8s: I.Nat,
          cycleMarginBps: I.Nat,
          treasury: I.Principal,
          maxSwapNotionalE8s: I.Nat,
          maxCycleTopUpE8s: I.Nat,
        }),
      ],
      ["query"],
    ),
  });

const asJson = process.argv.includes("--json");

const agent = await HttpAgent.create({ host: HOST });
const actor = Actor.createActor(idl, { agent, canisterId: FEES });

const [credits, cfg] = await Promise.all([
  actor.listPairLpCredits(100n),
  actor.getConfig(),
]);

const rows = credits.map((c) => ({
  pair: `${c.tokenIn} → ${c.tokenOut}`,
  feeLedger: c.feeLedger,
  amount: c.amount.toString(),
  updatedAt: c.updatedAt.toString(),
}));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        feesCanister: FEES,
        treasury: cfg.treasury.toText(),
        swapFeeBps: cfg.swapFeeBps.toString(),
        credits: rows,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Canopy fees ${FEES}`);
  console.log(`Treasury ${cfg.treasury.toText()} · swap ${cfg.swapFeeBps} bps`);
  console.log(`Pair LP credits: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.pair}`);
    console.log(`    ledger ${r.feeLedger} · amount ${r.amount}`);
  }
  console.log(
    "\nSeed in Canopy UI (LP desk) while signed in as fees owner with fee tokens funded.",
  );
}
