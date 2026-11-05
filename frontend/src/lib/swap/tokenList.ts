/**
 * Dynamic ICRC-1/2 discovery from ICPSwap TokenList + HTTP token metadata.
 * Merges with Canopy seed ledgers; caches for offline/fast boots.
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import {
  IC_HOST,
  ICPSWAP_TOKEN_LIST,
  SEED_ICRC1_LEDGERS,
  allowLedgerSpend,
  tokenLogoCandidates,
  type SeedLedger,
} from "../constants";
import { fetchIcpSwapTokenInfos } from "./icpswap";
import { resolveTokenLogos } from "../tokens/logos";

const CACHE_KEY = "canopy.tokenlist.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const tokenListIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Media = I.Record({ mediaType: I.Text, link: I.Text });
  const Config = I.Record({ name: I.Text, value: I.Text });
  const TokenMetadata = I.Record({
    canisterId: I.Text,
    configs: I.Vec(Config),
    decimals: I.Nat,
    fee: I.Nat,
    introduction: I.Text,
    mediaLinks: I.Vec(Media),
    name: I.Text,
    rank: I.Nat32,
    standard: I.Text,
    symbol: I.Text,
    totalSupply: I.Nat,
  });
  return I.Service({
    getList: I.Func(
      [],
      [I.Variant({ ok: I.Vec(TokenMetadata), err: I.Text })],
      ["query"],
    ),
  });
};

type TokenMetaRow = {
  canisterId: string;
  decimals: bigint;
  fee: bigint;
  name: string;
  symbol: string;
  standard: string;
  mediaLinks: Array<{ mediaType: string; link: string }>;
};

function standardsFrom(standard: string): Array<"icrc1" | "icrc2"> {
  const s = standard.toUpperCase();
  if (s.includes("ICRC2") || s === "ICP") return ["icrc1", "icrc2"];
  if (s.includes("ICRC1")) return ["icrc1"];
  return ["icrc1", "icrc2"];
}

function logoFromMedia(row: TokenMetaRow): string | undefined {
  const img = row.mediaLinks.find(
    (m) =>
      /logo|image|icon/i.test(m.mediaType) ||
      /\.(png|jpg|svg|webp)/i.test(m.link),
  );
  return img?.link?.startsWith("http") ? img.link : undefined;
}

function toSeed(row: TokenMetaRow): SeedLedger {
  const id = row.canisterId.trim().toLowerCase();
  const logo = logoFromMedia(row);
  return {
    id,
    symbol: row.symbol || "TOKEN",
    name: row.name || row.symbol || id.slice(0, 12),
    decimals: Number(row.decimals),
    logoUrl: logo ?? tokenLogoCandidates(id)[0]!,
    standards: standardsFrom(row.standard),
  };
}

function readCache(): SeedLedger[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; ledgers: SeedLedger[] };
    if (!parsed?.ledgers?.length) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.ledgers;
  } catch {
    return null;
  }
}

function writeCache(ledgers: SeedLedger[]): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ at: Date.now(), ledgers }),
    );
  } catch {
    /* quota */
  }
}

function mergeLedgers(parts: SeedLedger[][]): SeedLedger[] {
  const map = new Map<string, SeedLedger>();
  for (const list of parts) {
    for (const s of list) {
      const id = s.id.toLowerCase();
      const prev = map.get(id);
      if (!prev) {
        map.set(id, { ...s, id });
        continue;
      }
      map.set(id, {
        ...prev,
        ...s,
        id,
        logoUrl: prev.logoUrl || s.logoUrl,
        standards: [...new Set([...prev.standards, ...s.standards])],
      });
    }
  }
  return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function fetchTokenListCanister(): Promise<SeedLedger[]> {
  const agent = await HttpAgent.create({ host: IC_HOST });
  const actor = Actor.createActor(tokenListIdl, {
    agent,
    canisterId: ICPSWAP_TOKEN_LIST,
  }) as {
    getList: () => Promise<{ ok: TokenMetaRow[] } | { err: string }>;
  };
  const r = await actor.getList();
  if ("err" in r) throw new Error(r.err);
  return r.ok
    .filter((row) => {
      const st = row.standard.toUpperCase();
      return (
        st.includes("ICRC") ||
        st === "ICP" ||
        st.includes("ICRC1") ||
        st.includes("ICRC2")
      );
    })
    .map(toSeed);
}

async function fetchFromHttpApi(): Promise<SeedLedger[]> {
  const infos = await fetchIcpSwapTokenInfos();
  return infos.map((t) => {
    const id = t.tokenLedgerId.toLowerCase();
    return {
      id,
      symbol: t.tokenSymbol || "TOKEN",
      name: t.tokenSymbol || id.slice(0, 12),
      decimals: 8,
      logoUrl: tokenLogoCandidates(id)[0]!,
      standards: ["icrc1", "icrc2"] as Array<"icrc1" | "icrc2">,
    };
  });
}

/** Seed + ICPSwap TokenList + HTTP API, cached. */
export async function discoverIcrcLedgers(opts?: {
  force?: boolean;
}): Promise<SeedLedger[]> {
  let discovered: SeedLedger[] = [];
  if (!opts?.force) {
    const cached = readCache();
    if (cached?.length) discovered = cached;
  }
  if (!discovered.length || opts?.force) {
    try {
      discovered = await fetchTokenListCanister();
    } catch {
      try {
        discovered = await fetchFromHttpApi();
      } catch {
        discovered = [];
      }
    }
    if (discovered.length) writeCache(discovered);
  }
  const merged = mergeLedgers([SEED_ICRC1_LEDGERS, discovered]);
  try {
    const { LOGO_CATALOG } = await import("../tokens/logoCatalog.generated");
    for (const s of merged) {
      const baked = LOGO_CATALOG[s.id];
      if (baked) s.logoUrl = baked;
    }
    const logos = await resolveTokenLogos(
      merged.map((s) => s.id),
      { force: opts?.force },
    );
    for (const s of merged) {
      if (logos[s.id]) s.logoUrl = logos[s.id]!;
      allowLedgerSpend(s.id);
    }
  } catch {
    for (const s of merged) allowLedgerSpend(s.id);
  }
  return merged;
}

export function listCachedOrSeedLedgers(): SeedLedger[] {
  return mergeLedgers([SEED_ICRC1_LEDGERS, readCache() ?? []]);
}
