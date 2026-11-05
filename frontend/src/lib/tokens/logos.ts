/**
 * Resolve ICRC token logos from on-chain metadata + SNS aggregator.
 * (ICPSwap CDN paths currently return HTML; do not rely on them.)
 */
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { IC_HOST, ICP_LEDGER } from "../constants";
import { LOGO_CATALOG } from "./logoCatalog.generated";

const LOGO_CACHE_KEY = "canopy.token.logos.v6";
const SNS_CACHE_KEY = "canopy.sns.logo.map.v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Skip persisting huge data: URLs — they blow localStorage quota. */
const MAX_CACHE_VALUE_CHARS = 4_000;

/** Official ICP infinity token mark (user-supplied brand asset). */
export const ICP_LOGO_URL =
  LOGO_CATALOG[ICP_LEDGER] ?? "/brand/tokens/icp-official.png";
/** @deprecated use ICP_LOGO_URL */
export const ICP_LOGO_DATA_URL = ICP_LOGO_URL;

let sharedAgentPromise: Promise<HttpAgent> | null = null;

function getSharedAgent(): Promise<HttpAgent> {
  if (!sharedAgentPromise) {
    sharedAgentPromise = HttpAgent.create({ host: IC_HOST });
  }
  return sharedAgentPromise;
}

const metaIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Value = I.Variant({
    Text: I.Text,
    Nat: I.Nat,
    Int: I.Int,
    Blob: I.Vec(I.Nat8),
  });
  return I.Service({
    icrc1_metadata: I.Func([], [I.Vec(I.Tuple(I.Text, Value))], ["query"]),
    icrc1_supported_standards: I.Func(
      [],
      [I.Vec(I.Record({ name: I.Text, url: I.Text }))],
      ["query"],
    ),
  });
};

type MetaActor = {
  icrc1_metadata: () => Promise<
    Array<[string, { Text?: string; Nat?: bigint; Int?: bigint; Blob?: number[] }]>
  >;
  icrc1_supported_standards: () => Promise<Array<{ name: string; url: string }>>;
};

type LogoCache = { at: number; map: Record<string, string> };

function readMap(key: string): LogoCache | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LogoCache;
    if (!parsed?.map || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMap(key: string, map: Record<string, string>): void {
  try {
    const slim: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      if (!v) continue;
      if (v.startsWith("data:") && v.length > MAX_CACHE_VALUE_CHARS) continue;
      if (v.length > MAX_CACHE_VALUE_CHARS) continue;
      slim[k] = v;
    }
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), map: slim }));
  } catch {
    /* quota */
  }
}

export function snsRootLogoUrl(rootCanisterId: string): string {
  return `https://3r4gx-wqaaa-aaaaq-aaaia-cai.raw.icp0.io/v1/sns/root/${rootCanisterId}/logo.png`;
}

/** Build ledgerId → logo URL from SNS aggregator pages (parallel fetch). */
export async function fetchSnsLogoMap(force = false): Promise<Record<string, string>> {
  if (!force) {
    const cached = readMap(SNS_CACHE_KEY);
    if (cached) return cached.map;
  }
  const map: Record<string, string> = {};
  const pages = await Promise.all(
    Array.from({ length: 8 }, async (_, page) => {
      const url = `https://3r4gx-wqaaa-aaaaq-aaaia-cai.raw.icp0.io/v1/sns/list/page/${page}/slow.json`;
      try {
        const res = await fetch(url);
        if (!res.ok) return [] as unknown[];
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    }),
  );

  for (const rows of pages) {
    for (const s of rows as Array<{
      canister_ids?: {
        ledger_canister_id?: string;
        root_canister_id?: string;
      };
      icrc1_metadata?: Array<[string, { Text?: string; text?: string }]>;
    }>) {
      const ledger = s.canister_ids?.ledger_canister_id?.toLowerCase();
      const root = s.canister_ids?.root_canister_id;
      if (!ledger) continue;
      const meta = (s.icrc1_metadata || []).find((m) => m[0] === "icrc1:logo");
      const text = meta?.[1]?.Text || meta?.[1]?.text;
      if (text?.startsWith("data:") || text?.startsWith("http")) {
        map[ledger] = text;
      } else if (root) {
        map[ledger] = snsRootLogoUrl(root);
      }
    }
  }
  writeMap(SNS_CACHE_KEY, map);
  return map;
}

export async function fetchIcrc1Logo(ledgerId: string): Promise<string | null> {
  const id = ledgerId.trim().toLowerCase();
  if (id === ICP_LEDGER) return ICP_LOGO_URL;
  try {
    const agent = await getSharedAgent();
    const actor = Actor.createActor(metaIdl, {
      agent,
      canisterId: id,
    }) as MetaActor;
    const meta = await actor.icrc1_metadata();
    const logo = meta.find((m) => m[0] === "icrc1:logo");
    const text = logo?.[1]?.Text;
    if (text && (text.startsWith("data:") || text.startsWith("http"))) {
      return text;
    }
  } catch {
    /* not an ICRC ledger or no logo */
  }
  return null;
}

export async function fetchSupportedStandards(
  ledgerId: string,
): Promise<string[]> {
  try {
    const agent = await getSharedAgent();
    const actor = Actor.createActor(metaIdl, {
      agent,
      canisterId: ledgerId.trim(),
    }) as MetaActor;
    const rows = await actor.icrc1_supported_standards();
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

/**
 * Resolve logos for many ledgers. Order: cache → SNS map → icrc1:logo → ICP default.
 * Calls `onPartial` as results arrive for progressive UI.
 */
export async function resolveTokenLogos(
  ledgerIds: string[],
  opts?: {
    force?: boolean;
    concurrency?: number;
    onPartial?: (map: Record<string, string>) => void;
  },
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const cached = opts?.force ? null : readMap(LOGO_CACHE_KEY);
  const need: string[] = [];
  for (const raw of ledgerIds) {
    const id = raw.trim().toLowerCase();
    if (!id) continue;
    const baked = LOGO_CATALOG[id];
    if (baked) {
      out[id] = baked;
      continue;
    }
    if (id === ICP_LEDGER) {
      out[id] = ICP_LOGO_URL;
      continue;
    }
    if (cached?.map[id]) {
      out[id] = cached.map[id]!;
      continue;
    }
    need.push(id);
  }

  if (Object.keys(out).length) opts?.onPartial?.({ ...out });

  let sns: Record<string, string> = {};
  try {
    sns = await fetchSnsLogoMap(opts?.force);
  } catch {
    sns = {};
  }

  const still: string[] = [];
  for (const id of need) {
    if (sns[id]) {
      out[id] = sns[id]!;
    } else {
      still.push(id);
    }
  }
  if (Object.keys(out).length) opts?.onPartial?.({ ...out });

  const concurrency = opts?.concurrency ?? 14;
  let i = 0;
  async function worker() {
    while (i < still.length) {
      const idx = i++;
      const id = still[idx]!;
      const logo = await fetchIcrc1Logo(id);
      if (logo) out[id] = logo;
      else if (sns[id]) out[id] = sns[id]!;
      if (logo || sns[id]) opts?.onPartial?.({ ...out });
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, still.length)) },
      () => worker(),
    ),
  );

  writeMap(LOGO_CACHE_KEY, { ...cached?.map, ...out });
  return out;
}

export function getCachedLogo(ledgerId: string): string | undefined {
  const id = ledgerId.trim().toLowerCase();
  if (LOGO_CATALOG[id]) return LOGO_CATALOG[id];
  if (id === ICP_LEDGER) return ICP_LOGO_URL;
  return readMap(LOGO_CACHE_KEY)?.map[id] ?? readMap(SNS_CACHE_KEY)?.map[id];
}

/** Instant path for known TokenList logos shipped with the app. */
export function catalogLogoUrl(ledgerId: string): string | undefined {
  return LOGO_CATALOG[ledgerId.trim().toLowerCase()];
}

/** Warm SNS + seed logos in the background (non-blocking). */
export function prefetchTokenLogos(ledgerIds: string[]): void {
  void resolveTokenLogos(ledgerIds).catch(() => {
    /* best-effort */
  });
}
