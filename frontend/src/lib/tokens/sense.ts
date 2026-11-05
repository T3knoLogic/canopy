/**
 * Auto-sense ICRC-1 / ICRC-2 ledger canisters and hydrate metadata + logo.
 */
import { Principal } from "@dfinity/principal";
import { allowLedgerSpend, type SeedLedger } from "../constants";
import { fetchIcrc1Meta } from "../ledger";
import {
  fetchIcrc1Logo,
  fetchSupportedStandards,
  getCachedLogo,
  resolveTokenLogos,
} from "./logos";

export type SensedToken = SeedLedger & {
  source: "manual" | "seed" | "icpswap";
};

function isPrincipal(id: string): boolean {
  try {
    Principal.fromText(id.trim());
    return true;
  } catch {
    return false;
  }
}

export async function senseIcrcToken(canisterId: string): Promise<SensedToken> {
  const id = canisterId.trim().toLowerCase();
  if (!isPrincipal(id)) {
    throw new Error("Enter a valid canister principal");
  }

  let meta: Awaited<ReturnType<typeof fetchIcrc1Meta>>;
  try {
    meta = await fetchIcrc1Meta(id);
  } catch (e) {
    throw new Error(
      `Not an ICRC-1 ledger (or unreachable): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const standardsRaw = await fetchSupportedStandards(id);
  const has2 = standardsRaw.some((s) => /ICRC-2/i.test(s));
  const has1 =
    standardsRaw.some((s) => /ICRC-1/i.test(s)) || standardsRaw.length === 0;
  // If supported_standards fails but meta worked, assume ICRC-1; probe ICRC-2 via presence of approve is heavy — default both when empty.
  const standards: Array<"icrc1" | "icrc2"> =
    standardsRaw.length === 0
      ? ["icrc1", "icrc2"]
      : has2
        ? ["icrc1", "icrc2"]
        : has1
          ? ["icrc1"]
          : ["icrc1"];

  let logoUrl =
    getCachedLogo(id) ||
    (await fetchIcrc1Logo(id)) ||
    (await resolveTokenLogos([id]))[id] ||
    "";

  allowLedgerSpend(id);
  return {
    id,
    symbol: meta.symbol || "TOKEN",
    name: meta.name || id.slice(0, 12),
    decimals: meta.decimals,
    logoUrl,
    standards,
    source: "manual",
  };
}
