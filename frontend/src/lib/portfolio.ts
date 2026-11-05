import {
  extractHitCanisters,
  fetchCanopyHoldings,
  rescanCanisterHoldings,
  type CanopyHoldingNft,
  type CanopyHoldingsPhase,
  type MediaKind,
} from "@t3kno/ic-nft-aggregator";
import { SEED_ICRC1_LEDGERS, allowLedgerSpend, type SeedLedger } from "./constants";
import { fetchIcrc1BalanceWithDecimals, formatToken } from "./ledger";
import { discoverIcrcLedgers, listCachedOrSeedLedgers } from "./swap/tokenList";
import { resolveTokenLogos } from "./tokens/logos";
import {
  loadHiddenSeedIds,
  loadWalletNfts,
  loadWalletTokens,
  manualVisibleLedgerIds,
  manualVisibleNftCanisters,
} from "./wallet/registry";

export type TokenHolding = {
  ledgerId: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  balanceDisplay: string;
  logoUrl: string;
  standards: Array<"icrc1" | "icrc2">;
};

export type TokenInboundEvent = {
  ledgerId: string;
  symbol: string;
  delta: bigint;
  deltaDisplay: string;
  balanceDisplay: string;
  isNew: boolean;
};

export type LoadTokenHoldingsOptions = {
  /** Prefer these ledgers first (held + seeds). */
  prioritizeLedgerIds?: string[];
  /**
   * Only probe seeds, known holdings, manual/extra ledgers.
   * Fast path for receive detection without scanning the whole TokenList.
   */
  knownOnly?: boolean;
  maxProbe?: number;
  /** Progressive UI — called after seed/priority wave, then after full probe. */
  onPartial?: (tokens: TokenHolding[]) => void;
};

/** Detect balance increases / newly nonzero ledgers between two holdings snapshots. */
export function diffTokenInbounds(
  prev: TokenHolding[],
  next: TokenHolding[],
): TokenInboundEvent[] {
  const prevMap = new Map(prev.map((t) => [t.ledgerId, t]));
  const events: TokenInboundEvent[] = [];
  for (const t of next) {
    const before = prevMap.get(t.ledgerId);
    if (!before) {
      if (t.balance > 0n) {
        events.push({
          ledgerId: t.ledgerId,
          symbol: t.symbol,
          delta: t.balance,
          deltaDisplay: t.balanceDisplay,
          balanceDisplay: t.balanceDisplay,
          isNew: true,
        });
      }
      continue;
    }
    if (t.balance > before.balance) {
      const delta = t.balance - before.balance;
      events.push({
        ledgerId: t.ledgerId,
        symbol: t.symbol,
        delta,
        deltaDisplay: formatToken(delta, t.decimals),
        balanceDisplay: t.balanceDisplay,
        isNew: false,
      });
    }
  }
  return events;
}

export function formatInboundStatus(events: TokenInboundEvent[]): string {
  if (!events.length) return "";
  const top = events.slice(0, 3);
  const parts = top.map((e) =>
    e.isNew
      ? `New ${e.symbol} ${e.deltaDisplay}`
      : `+${e.deltaDisplay} ${e.symbol}`,
  );
  const more = events.length > top.length ? ` · +${events.length - top.length} more` : "";
  return `Received ${parts.join(" · ")}${more}`;
}

/**
 * Merge a knownOnly / partial poll into the previous holdings list without
 * dropping unprobed ledgers.
 */
export function mergeTokenHoldingsPoll(
  prev: TokenHolding[],
  polled: TokenHolding[],
  probedLedgerIds: string[],
): TokenHolding[] {
  const probed = new Set(
    probedLedgerIds.map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
  const polledMap = new Map(polled.map((t) => [t.ledgerId, t]));
  const out: TokenHolding[] = [];
  const seen = new Set<string>();

  for (const t of prev) {
    if (probed.has(t.ledgerId)) {
      const n = polledMap.get(t.ledgerId);
      if (n) {
        out.push(n);
        seen.add(n.ledgerId);
      }
      /* zeroed holdings drop out of the list */
    } else {
      out.push(t);
      seen.add(t.ledgerId);
    }
  }
  for (const t of polled) {
    if (seen.has(t.ledgerId)) continue;
    out.push(t);
    seen.add(t.ledgerId);
  }
  out.sort((a, b) => {
    if (a.balance === 0n && b.balance !== 0n) return 1;
    if (b.balance === 0n && a.balance !== 0n) return -1;
    return a.symbol.localeCompare(b.symbol);
  });
  return out;
}

export type NftHolding = {
  contractId: string;
  tokenId: string;
  name: string;
  imageUrl: string | null;
  mediaUrl: string | null;
  mediaKind: MediaKind;
  posterUrl: string | null;
  collectionName: string | null;
  groupKey: string;
  standard: "icrc7" | "ext" | "index";
  bazaarCollectionId?: string | null;
  catalogSerial?: string | null;
  attributes?: Record<string, string>;
  description?: string | null;
  utilityNotes?: string | null;
};

export type NftInboundEvent = {
  contractId: string;
  tokenId: string;
  name: string;
  collectionName: string | null;
};

/** Newly appearing NFTs between two holdings snapshots (receive / mint). */
export function diffNftInbounds(
  prev: NftHolding[],
  next: NftHolding[],
  keyOf: (n: NftHolding) => string,
): NftInboundEvent[] {
  if (!prev.length) return [];
  const before = new Set(prev.map(keyOf));
  const events: NftInboundEvent[] = [];
  for (const n of next) {
    const k = keyOf(n);
    if (before.has(k)) continue;
    events.push({
      contractId: n.contractId,
      tokenId: n.tokenId,
      name: n.name,
      collectionName: n.collectionName,
    });
  }
  return events;
}

export function formatNftInboundStatus(events: NftInboundEvent[]): string {
  if (!events.length) return "";
  const top = events.slice(0, 3);
  const parts = top.map((e) =>
    e.collectionName ? `${e.name} (${e.collectionName})` : e.name,
  );
  const more =
    events.length > top.length ? ` · +${events.length - top.length} more` : "";
  return `Received ${parts.join(" · ")}${more}`;
}

const HITS_KEY = "canopy.holdings.hits.v1";
const TOKENS_SNAP_KEY = "canopy.holdings.tokens.v1";
const NFTS_SNAP_KEY = "canopy.holdings.nfts.v1";

function hitsStorageKey(owner: string): string {
  return `${HITS_KEY}:${owner}`;
}

function tokensSnapKey(owner: string): string {
  return `${TOKENS_SNAP_KEY}:${owner}`;
}

function nftsSnapKey(owner: string): string {
  return `${NFTS_SNAP_KEY}:${owner}`;
}

/** Display-only last snapshot — never used for send amounts or auth. */
export function loadTokenSnapshot(owner: string): TokenHolding[] | null {
  try {
    const raw = localStorage.getItem(tokensSnapKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: TokenHolding[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.ledgerId !== "string" || typeof r.balance !== "string") continue;
      let balance: bigint;
      try {
        balance = BigInt(r.balance);
      } catch {
        continue;
      }
      out.push({
        ledgerId: r.ledgerId,
        symbol: typeof r.symbol === "string" ? r.symbol : "TOKEN",
        name: typeof r.name === "string" ? r.name : r.ledgerId.slice(0, 12),
        decimals: typeof r.decimals === "number" ? r.decimals : 8,
        balance,
        balanceDisplay:
          typeof r.balanceDisplay === "string"
            ? r.balanceDisplay
            : formatToken(balance, typeof r.decimals === "number" ? r.decimals : 8),
        logoUrl: typeof r.logoUrl === "string" ? r.logoUrl : "",
        standards: Array.isArray(r.standards)
          ? (r.standards.filter(
              (s): s is "icrc1" | "icrc2" => s === "icrc1" || s === "icrc2",
            ) as Array<"icrc1" | "icrc2">)
          : ["icrc1"],
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export function saveTokenSnapshot(owner: string, tokens: TokenHolding[]): void {
  try {
    const payload = tokens.slice(0, 200).map((t) => ({
      ...t,
      balance: t.balance.toString(),
    }));
    localStorage.setItem(tokensSnapKey(owner), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** Display-only last NFT snapshot. */
export function loadNftSnapshot(owner: string): NftHolding[] | null {
  try {
    const raw = localStorage.getItem(nftsSnapKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out = parsed.filter(
      (n): n is NftHolding =>
        !!n &&
        typeof n === "object" &&
        typeof (n as NftHolding).contractId === "string" &&
        typeof (n as NftHolding).tokenId === "string",
    );
    // Snapshot paint skips toHolding — re-allow so EXT send works before live probe.
    for (const n of out) allowLedgerSpend(n.contractId);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export function saveNftSnapshot(owner: string, nfts: NftHolding[]): void {
  try {
    localStorage.setItem(
      nftsSnapKey(owner),
      JSON.stringify(nfts.slice(0, 2_000)),
    );
  } catch {
    /* quota / private mode */
  }
}

/**
 * Warm browser image cache for the first page of NFT art (lazy decode).
 * Safe to call repeatedly — browsers dedupe identical src.
 */
export function prefetchNftMedia(nfts: NftHolding[], limit = 48): void {
  if (typeof window === "undefined" || !nfts.length) return;
  const seen = new Set<string>();
  let n = 0;
  for (const nft of nfts) {
    if (n >= limit) break;
    const url = (nft.posterUrl || nft.imageUrl || nft.mediaUrl || "").trim();
    if (!url || seen.has(url)) continue;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/")) continue;
    seen.add(url);
    n++;
    try {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = url;
    } catch {
      /* ignore */
    }
  }
}

/** Schedule a low-priority task after tokens paint (idle → timeout fallback). */
export function afterUiIdle(fn: () => void, timeoutMs = 120): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) fn();
  };
  if (typeof window === "undefined") {
    return () => {
      cancelled = true;
    };
  }
  const w = window;
  const ric = (
    w as Window & {
      requestIdleCallback?: (
        cb: IdleRequestCallback,
        opts?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    const id = ric(run, { timeout: timeoutMs });
    return () => {
      cancelled = true;
      (
        w as Window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback?.(id);
    };
  }
  const t = w.setTimeout(run, Math.min(timeoutMs, 48));
  return () => {
    cancelled = true;
    w.clearTimeout(t);
  };
}

export function loadWarmCanisters(owner: string): string[] {
  try {
    const raw = localStorage.getItem(hitsStorageKey(owner));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, 200);
  } catch {
    return [];
  }
}

export function saveWarmCanisters(owner: string, nfts: NftHolding[]): void {
  try {
    const ids = extractHitCanisters(nfts);
    localStorage.setItem(hitsStorageKey(owner), JSON.stringify(ids.slice(0, 200)));
  } catch {
    /* quota / private mode */
  }
}

function envInt(name: string, fallback: number): number {
  try {
    const v = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[
      name
    ];
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function isEmbed(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "os";
}

export async function loadTokenHoldings(
  owner: string,
  extraLedgers: string[] = [],
  catalog?: SeedLedger[],
  options: LoadTokenHoldingsOptions = {},
): Promise<TokenHolding[]> {
  const seen = new Set<string>();
  const hidden = loadHiddenSeedIds();
  const walletTokens = loadWalletTokens();
  const walletById = new Map(walletTokens.map((t) => [t.id, t]));

  const specs = [...(catalog?.length ? catalog : listCachedOrSeedLedgers())];
  for (const wt of walletTokens) {
    if (!specs.some((s) => s.id === wt.id)) {
      specs.push({
        id: wt.id,
        symbol: wt.symbol,
        name: wt.name,
        decimals: wt.decimals,
        logoUrl: wt.logoUrl,
        standards: wt.standards,
      });
    }
  }
  for (const id of [...extraLedgers, ...manualVisibleLedgerIds()]) {
    const n = id.trim().toLowerCase();
    if (!n || specs.some((s) => s.id === n)) continue;
    specs.push({
      id: n,
      symbol: "TOKEN",
      name: n.slice(0, 12),
      decimals: 8,
      logoUrl: "",
      standards: ["icrc1", "icrc2"],
    });
  }

  // Logos off the critical path — resolve in parallel with balance probes.
  let logos: Record<string, string> = {};
  const logosPromise = resolveTokenLogos(specs.map((s) => s.id))
    .then((m) => {
      logos = m;
      return m;
    })
    .catch(() => ({} as Record<string, string>));

  const priority = new Set(
    [
      ...(options.prioritizeLedgerIds ?? []),
      ...SEED_ICRC1_LEDGERS.map((s) => s.id),
      ...walletTokens.filter((t) => t.visible).map((t) => t.id),
      ...manualVisibleLedgerIds(),
      ...extraLedgers,
    ]
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );

  let ordered = [...specs].sort((a, b) => {
    const ap = priority.has(a.id) ? 0 : 1;
    const bp = priority.has(b.id) ? 0 : 1;
    return ap - bp;
  });

  if (options.knownOnly) {
    ordered = ordered.filter(
      (s) =>
        priority.has(s.id) ||
        SEED_ICRC1_LEDGERS.some((seed) => seed.id === s.id),
    );
  }

  const MAX_PROBE = options.maxProbe ?? (options.knownOnly ? 48 : 160);
  const toProbe = ordered.slice(0, MAX_PROBE);

  const out: TokenHolding[] = [];
  const sortOut = () => {
    out.sort((a, b) => {
      if (a.balance === 0n && b.balance !== 0n) return 1;
      if (b.balance === 0n && a.balance !== 0n) return -1;
      return a.symbol.localeCompare(b.symbol);
    });
  };

  async function probeSlice(slice: SeedLedger[], concurrency: number) {
    let i = 0;
    async function worker() {
      while (i < slice.length) {
        const idx = i++;
        const spec = slice[idx]!;
        if (seen.has(spec.id)) continue;
        seen.add(spec.id);
        const wallet = walletById.get(spec.id);
        if (wallet && !wallet.visible) continue;
        const isSeed = SEED_ICRC1_LEDGERS.some((s) => s.id === spec.id);
        if (hidden.has(spec.id) && !wallet?.visible) continue;
        try {
          const knownDecimals =
            wallet?.decimals ??
            (Number.isFinite(spec.decimals) ? spec.decimals : undefined);
          const { balance, decimals: liveDecimals } =
            await fetchIcrc1BalanceWithDecimals(spec.id, owner, {
              knownDecimals:
                knownDecimals != null && knownDecimals > 0
                  ? knownDecimals
                  : undefined,
            });
          const alwaysShow = Boolean(wallet?.visible) || isSeed;
          if (balance === 0n && !alwaysShow) continue;
          allowLedgerSpend(spec.id);
          const decimals = liveDecimals || wallet?.decimals || spec.decimals || 8;
          out.push({
            ledgerId: spec.id,
            symbol: wallet?.symbol || spec.symbol,
            name: wallet?.name || spec.name,
            decimals,
            balance,
            balanceDisplay: formatToken(balance, decimals),
            logoUrl: logos[spec.id] || wallet?.logoUrl || spec.logoUrl,
            standards: wallet?.standards || spec.standards,
          });
        } catch {
          /* ledger unreachable */
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  // Wave 1: seeds + priority (fast first paint)
  const prioritySlice = toProbe.filter((s) => priority.has(s.id));
  const restSlice = toProbe.filter((s) => !priority.has(s.id));
  await probeSlice(prioritySlice, options.knownOnly ? 8 : 10);
  sortOut();
  options.onPartial?.([...out]);

  // Wave 2: remainder of catalog probe
  if (restSlice.length) {
    await probeSlice(restSlice, options.knownOnly ? 6 : 10);
    sortOut();
  }

  await logosPromise;
  for (const t of out) {
    const url = logos[t.ledgerId];
    if (url) t.logoUrl = url;
  }
  sortOut();
  options.onPartial?.([...out]);
  return out;
}

/** Warm TokenList cache (call on boot). */
export async function warmTokenCatalog(): Promise<SeedLedger[]> {
  return discoverIcrcLedgers();
}

export type LoadNftHoldingsOptions = {
  signal?: AbortSignal;
  onProgress?: (msg: string, phase?: CanopyHoldingsPhase) => void;
  onBatch?: (nfts: NftHolding[], phase: CanopyHoldingsPhase) => void;
  /** Cap EXT tiers (0 hot · 1 warm · 2 full). Default: embed→1, else→2. */
  maxTier?: 0 | 1 | 2;
};

function toHolding(n: CanopyHoldingNft): NftHolding {
  // Session-allow every NFT collection we already hold (ICRC-7 + EXT + index).
  // Without this, executeExtSend / executeIcrc7Send fail assertSpendTarget for
  // partner EXT cans (e.g. GNight Punks) that are not on the static seed list.
  allowLedgerSpend(n.contractId);
  return {
    contractId: n.contractId,
    tokenId: n.tokenId,
    name: n.name,
    imageUrl: n.imageUrl,
    mediaUrl: n.mediaUrl,
    mediaKind: n.mediaKind,
    posterUrl: n.posterUrl,
    collectionName: n.collectionName,
    groupKey: n.groupKey,
    standard: n.standard,
    bazaarCollectionId: n.bazaarCollectionId ?? null,
    catalogSerial: n.catalogSerial ?? null,
    attributes: n.attributes,
    description: n.description ?? null,
    utilityNotes: n.utilityNotes ?? null,
  };
}

function filterNftsByVisibility(nfts: NftHolding[]): NftHolding[] {
  const hidden = new Set(
    loadWalletNfts()
      .filter((c) => !c.visible)
      .map((c) => c.id.toLowerCase()),
  );
  if (!hidden.size) return nfts;
  return nfts.filter((n) => !hidden.has(n.contractId.toLowerCase()));
}

function scrubHoldingsStatus(msg: string): string {
  return msg
    .replace(/\bDGDG\b/gi, "")
    .replace(/\bCAP\b/g, "market")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\+/g, "")
    .replace(/\+\s+/g, "")
    .trim();
}

/** Progressive NFT holdings — indexes + ICRC-7 then tiered concurrent EXT. */
export async function loadNftHoldings(
  owner: string,
  onProgressOrOpts?:
    | ((msg: string) => void)
    | LoadNftHoldingsOptions,
): Promise<NftHolding[]> {
  const opts: LoadNftHoldingsOptions =
    typeof onProgressOrOpts === "function"
      ? { onProgress: onProgressOrOpts }
      : onProgressOrOpts ?? {};

  const embed = isEmbed();
  const warm = [
    ...loadWarmCanisters(owner),
    ...manualVisibleNftCanisters(),
  ];
  const concurrency = envInt(
    "VITE_HOLDINGS_CONCURRENCY",
    embed ? 6 : 14,
  );
  // 0 / unset = no cap (full coverage ~1279). Embed stays capped for Hub UX.
  const maxExtConfigured = envInt(
    "VITE_HOLDINGS_MAX_EXT",
    embed ? 400 : 0,
  );
  const maxExt =
    maxExtConfigured > 0 ? maxExtConfigured : Number.POSITIVE_INFINITY;
  const maxTier = opts.maxTier ?? (embed ? 1 : 2);

  const result = await fetchCanopyHoldings(owner, {
    signal: opts.signal,
    warmCanisters: warm,
    concurrency,
    maxExtCanisters: maxExt,
    embed,
    maxTier,
    onProgress: (msg, phase) =>
      opts.onProgress?.(scrubHoldingsStatus(msg), phase),
    onBatch: (all, phase) => {
      const mapped = filterNftsByVisibility(all.map(toHolding));
      opts.onBatch?.(mapped, phase);
    },
  });

  const mapped = filterNftsByVisibility(result.map(toHolding));
  saveWarmCanisters(owner, mapped);
  return mapped;
}

/** Rescan one collection canister and return holdings for that group only. */
export async function rescanNftCollection(
  owner: string,
  contractId: string,
  opts?: {
    standard?: NftHolding["standard"];
    bazaarCollectionId?: string | null;
  },
): Promise<NftHolding[]> {
  const result = await rescanCanisterHoldings(owner, contractId, {
    standard: opts?.standard ?? "auto",
    bazaarCollectionId: opts?.bazaarCollectionId,
  });
  const mapped = filterNftsByVisibility(result.map(toHolding));
  return mapped;
}

/**
 * Replace NFTs for one groupKey with a fresh scan result (empty = sold out).
 */
export function replaceNftGroup(
  prev: NftHolding[],
  groupKey: string,
  nextForGroup: NftHolding[],
): NftHolding[] {
  const kept = prev.filter((n) => n.groupKey !== groupKey);
  return [...kept, ...nextForGroup];
}

/** @deprecated use mediaUrl — kept for call sites expecting preferDirectNftImage */
export function preferDirectNftImage(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const u = url.trim();
  if (u.toLowerCase().startsWith("data:image/")) return u;
  if (/entrepot\.io|hdem4-ryaaa|s3\.amazonaws\.com/i.test(u) && /wallet_logos/i.test(u))
    return null;
  if (/entrepot\.io|hdem4-ryaaa/i.test(u)) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return null;
}
