import { LOGO_CATALOG } from "./tokens/logoCatalog.generated";

export const IC_HOST = "https://icp0.io";

export const ICP_LEDGER = "ryjl3-tyaaa-aaaaa-aaaba-cai";
export const CMC = "rkp4c-7iaaa-aaaaa-aaaca-cai";
export const CYCLES_LEDGER = "um5iw-rqaaa-aaaaq-qaaba-cai";

export const BAZAAR_TREASURY = "j7j3j-2iaaa-aaaau-agwla-cai";
export const BAZAAR_SHARED_LEDGER = "ivgzt-yyaaa-aaaau-agwma-cai";
export const BAZAAR_ASSETS = "n42s3-syaaa-aaaau-agwqa-cai";
export const BAZAAR_REGISTRY = "jyi55-xqaaa-aaaau-agwlq-cai";
export const BAZAAR_MARKETPLACE = "i3eu3-diaaa-aaaau-agwna-cai";
export const BAZAAR_MARKET_URL = "https://iabi6-zqaaa-aaaau-agwpq-cai.icp0.io";
/** IC NFT Migrator — client-signed mass mover (EXT / ICRC-7 / DIP721 / ordinals). */
export const NFT_MIGRATOR_URL = "https://cy2qi-siaaa-aaaau-ag32a-cai.icp0.io";

export const ICPSWAP_FACTORY = "4mmnk-kiaaa-aaaag-qbllq-cai";
export const ICPSWAP_TOKEN_LIST = "k37c6-riaaa-aaaag-qcyza-cai";
export const ICPSWAP_CALCULATOR = "phr2m-oyaaa-aaaag-qjuoq-cai";
export const ICPSWAP_API = "https://api.icpswap.com";

export const KONG_SWAP_URL = "https://www.kongswap.io";
export const ICLIGHTHOUSE_URL = "https://iclight.io";

/** Match Bonsai OS Hub / Spot / Registry — id.ai (same II canister as identity.ic0.app). */
export const II_URL = "https://id.ai";
export const DERIVATION_ORIGIN =
  "https://u2jsa-baaaa-aaaau-aghea-cai.icp0.io";

export const CANOPY_FEES_CANISTER =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_CANOPY_FEES_CANISTER ?? "7o5gc-syaaa-aaaau-ag6cq-cai";

export const CANOPY_FRONTEND_CANISTER = "7h6n6-eqaaa-aaaau-ag6da-cai";
export const CANOPY_ORIGIN = `https://${CANOPY_FRONTEND_CANISTER}.icp0.io`;

export type SeedLedger = {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  standards: Array<"icrc1" | "icrc2">;
};

/** Core ICRC-1 / ICRC-2 ledgers — fees collected in the token moved. */
export const SEED_ICRC1_LEDGERS: SeedLedger[] = [
  {
    id: ICP_LEDGER,
    symbol: "ICP",
    name: "Internet Computer",
    decimals: 8,
    logoUrl: "/brand/tokens/icp-official.png",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: "mxzaz-hqaaa-aaaar-qaada-cai",
    symbol: "ckBTC",
    name: "ckBTC",
    decimals: 8,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: "ss2fx-dyaaa-aaaar-qacoq-cai",
    symbol: "ckETH",
    name: "ckETH",
    decimals: 18,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: "xevnm-gaaaa-aaaar-qafnq-cai",
    symbol: "ckUSDC",
    name: "ckUSDC",
    decimals: 6,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: "cngnf-vqaaa-aaaar-qag4q-cai",
    symbol: "ckUSDT",
    name: "ckUSDT",
    decimals: 6,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: "g4tto-rqaaa-aaaar-qageq-cai",
    symbol: "ckLINK",
    name: "ckLINK",
    decimals: 18,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: "2ouva-viaaa-aaaaq-aaamq-cai",
    symbol: "CHAT",
    name: "OpenChat",
    decimals: 8,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: "zfcdd-tqaaa-aaaaq-aaaga-cai",
    symbol: "SNS1",
    name: "SNS-1",
    decimals: 8,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
  {
    id: CYCLES_LEDGER,
    symbol: "TCYCLES",
    name: "Cycles (ledger)",
    decimals: 12,
    logoUrl: "",
    standards: ["icrc1", "icrc2"],
  },
];

export const SPEND_ALLOWLIST = new Set([
  ICP_LEDGER,
  CMC,
  CYCLES_LEDGER,
  BAZAAR_TREASURY,
  BAZAAR_SHARED_LEDGER,
  ICPSWAP_FACTORY,
  ICPSWAP_TOKEN_LIST,
  ICPSWAP_CALCULATOR,
  "7o5gc-syaaa-aaaau-ag6cq-cai",
  ...SEED_ICRC1_LEDGERS.map((s) => s.id),
]);

/** Fee sinks that Canopy may pay micro-fees to (never trust query-only treasury blindly). */
export const TREASURY_ALLOWLIST = new Set([BAZAAR_TREASURY]);

export function assertSpendTarget(canisterId: string): void {
  const id = canisterId.trim().toLowerCase();
  if (SPEND_ALLOWLIST.has(id)) return;
  if ((globalThis as { __canopyPoolAllow?: Set<string> }).__canopyPoolAllow?.has(id)) {
    return;
  }
  if (CANOPY_FEES_CANISTER && id === CANOPY_FEES_CANISTER.toLowerCase()) return;
  throw new Error(`Canister ${canisterId} is not on the Canopy spend allowlist`);
}

export function assertTreasury(principalText: string): void {
  const id = principalText.trim().toLowerCase();
  if (TREASURY_ALLOWLIST.has(id)) return;
  throw new Error(`Treasury ${principalText} is not allowlisted — refusing fee payment`);
}

/**
 * Allow a DEX pool canister resolved from the ICPSwap factory.
 * Does NOT widen the static ledger allowlist (prevents auto-approving arbitrary canisters).
 */
export function registerPoolAllow(canisterId: string): void {
  const g = globalThis as { __canopyPoolAllow?: Set<string> };
  if (!g.__canopyPoolAllow) g.__canopyPoolAllow = new Set();
  g.__canopyPoolAllow.add(canisterId.trim().toLowerCase());
}

/**
 * Explicit session opt-in for FT send / approve and NFT transfer targets.
 * Call for TokenList ledgers, Manage-added cans, and every NFT collection
 * already in the wallet (ICRC-7 + EXT) so partner EXT sends are not blocked.
 */
export function allowLedgerSpend(canisterId: string): void {
  SPEND_ALLOWLIST.add(canisterId.trim().toLowerCase());
}

export function tokenLogoCandidates(ledgerId: string, fallback?: string): string[] {
  const id = ledgerId.trim().toLowerCase();
  const seed = SEED_ICRC1_LEDGERS.find((s) => s.id === id);
  const out: string[] = [];
  const push = (u?: string) => {
    if (!u) return;
    if (!out.includes(u)) out.push(u);
  };
  // Shipped TokenList logos (instant)
  push(LOGO_CATALOG[id]);
  if (
    fallback?.startsWith("data:") ||
    fallback?.startsWith("http") ||
    fallback?.startsWith("/")
  ) {
    push(fallback);
  }
  if (
    seed?.logoUrl?.startsWith("data:") ||
    seed?.logoUrl?.startsWith("http") ||
    seed?.logoUrl?.startsWith("/")
  ) {
    if (!seed.logoUrl.includes("app.icpswap.com/images/tokens")) push(seed.logoUrl);
  }
  try {
    const cached = localStorage.getItem("canopy.token.logos.v6");
    if (cached) {
      const parsed = JSON.parse(cached) as { map?: Record<string, string> };
      push(parsed.map?.[id]);
    }
    const sns = localStorage.getItem("canopy.sns.logo.map.v1");
    if (sns) {
      const parsed = JSON.parse(sns) as { map?: Record<string, string> };
      push(parsed.map?.[id]);
    }
  } catch {
    /* ignore */
  }
  if (id === ICP_LEDGER) {
    push("/brand/tokens/icp-official.png");
  }
  push(`/brand/token-logos/${id}.png`);
  push(`/brand/token-logos/${id}.svg`);
  push(`/brand/token-logos/${id}.jpg`);
  push(`https://${id}.raw.icp0.io/logo.png`);
  return out;
}
