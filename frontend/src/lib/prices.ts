/**
 * Live token USD prices — ICPSwap DEX (primary) + CoinGecko ICP/USD cross-check.
 */
import { ICP_LEDGER, ICPSWAP_API } from "./constants";
import {
  fetchIcpSwapTokenInfos,
  type IcpSwapTokenInfo,
} from "./swap/icpswap";
import type { TokenHolding } from "./portfolio";

const COINGECKO_ICP =
  "https://api.coingecko.com/api/v3/simple/price?ids=internet-computer&vs_currencies=usd&include_24hr_change=true";

const CACHE_TTL_MS = 25_000;

export type TokenPriceQuote = {
  ledgerId: string;
  symbol: string;
  usd: number;
  change24hPct: number | null;
  source: "icpswap" | "coingecko" | "derived";
};

export type PriceBook = {
  updatedAt: number;
  icpUsd: number;
  icpChange24hPct: number | null;
  /** Sources that contributed to the ICP/USD rate. */
  icpSources: string[];
  byLedger: Map<string, TokenPriceQuote>;
};

export type TokenFiatLine = {
  ledgerId: string;
  usd: number | null;
  icp: number | null;
  change24hPct: number | null;
  priceUsd: number | null;
  priced: boolean;
};

export type PortfolioValuation = {
  totalUsd: number;
  totalIcp: number;
  pricedCount: number;
  unpricedCount: number;
  lines: Map<string, TokenFiatLine>;
  book: PriceBook | null;
  /** Top holdings by USD for allocation visuals. */
  allocation: Array<{
    ledgerId: string;
    symbol: string;
    usd: number;
    weight: number;
  }>;
};

let cache: { at: number; book: PriceBook } | null = null;
let inflight: Promise<PriceBook> | null = null;

function num(v: string | number | null | undefined): number {
  if (v == null) return NaN;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

async function fetchCoinGeckoIcpUsd(): Promise<{
  usd: number;
  change24hPct: number | null;
} | null> {
  try {
    const res = await fetch(COINGECKO_ICP, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      "internet-computer"?: { usd?: number; usd_24h_change?: number };
    };
    const usd = num(j["internet-computer"]?.usd);
    if (!(usd > 0)) return null;
    const ch = num(j["internet-computer"]?.usd_24h_change);
    return {
      usd,
      change24hPct: Number.isFinite(ch) ? ch : null,
    };
  } catch {
    return null;
  }
}

function buildBook(
  infos: IcpSwapTokenInfo[],
  gecko: { usd: number; change24hPct: number | null } | null,
): PriceBook {
  const byLedger = new Map<string, TokenPriceQuote>();
  for (const row of infos) {
    const id = row.tokenLedgerId?.trim().toLowerCase();
    if (!id) continue;
    const usd = num(row.price);
    if (!(usd > 0)) continue;
    const change24hPct = num(row.priceChange24H);
    byLedger.set(id, {
      ledgerId: id,
      symbol: row.tokenSymbol || "TOKEN",
      usd,
      change24hPct: Number.isFinite(change24hPct) ? change24hPct : null,
      source: "icpswap",
    });
  }

  const icpSwap = byLedger.get(ICP_LEDGER);
  const icpSources: string[] = [];
  let icpUsd = 0;
  let icpChange24hPct: number | null = null;

  if (icpSwap && icpSwap.usd > 0) {
    icpUsd = icpSwap.usd;
    icpChange24hPct = icpSwap.change24hPct;
    icpSources.push("ICPSwap");
  }

  if (gecko && gecko.usd > 0) {
    icpSources.push("CoinGecko");
    if (icpUsd > 0) {
      const drift = Math.abs(gecko.usd - icpUsd) / icpUsd;
      // Prefer CoinGecko for ICP/USD when feeds disagree > 8% (DEX outliers).
      if (drift > 0.08) {
        icpUsd = gecko.usd;
        icpChange24hPct = gecko.change24hPct;
      } else {
        // Midpoint when close — dampens single-feed noise.
        icpUsd = (icpUsd + gecko.usd) / 2;
        if (gecko.change24hPct != null && icpChange24hPct != null) {
          icpChange24hPct = (icpChange24hPct + gecko.change24hPct) / 2;
        } else {
          icpChange24hPct = gecko.change24hPct ?? icpChange24hPct;
        }
      }
    } else {
      icpUsd = gecko.usd;
      icpChange24hPct = gecko.change24hPct;
    }
    byLedger.set(ICP_LEDGER, {
      ledgerId: ICP_LEDGER,
      symbol: "ICP",
      usd: icpUsd,
      change24hPct: icpChange24hPct,
      source: gecko && icpSwap ? "icpswap" : gecko ? "coingecko" : "icpswap",
    });
  } else if (icpSwap) {
    byLedger.set(ICP_LEDGER, {
      ...icpSwap,
      usd: icpUsd || icpSwap.usd,
      change24hPct: icpChange24hPct,
    });
  }

  return {
    updatedAt: Date.now(),
    icpUsd,
    icpChange24hPct,
    icpSources,
    byLedger,
  };
}

/** Fresh or cached price book (ICPSwap + CoinGecko ICP). */
export async function loadPriceBook(force = false): Promise<PriceBook> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.book;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const [infos, gecko] = await Promise.all([
      fetchIcpSwapTokenInfos(),
      fetchCoinGeckoIcpUsd(),
    ]);
    const book = buildBook(infos, gecko);
    cache = { at: Date.now(), book };
    return book;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function formatUsd(n: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (opts?.compact) {
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `$${(n / 1_000).toFixed(2)}K`;
  }
  if (abs >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n);
  }
  if (abs >= 1) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }
  if (abs >= 0.01) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(n);
  }
  if (abs > 0) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(n);
  }
  return "$0.00";
}

export function formatIcpValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${n.toFixed(2)} ICP`;
  if (abs >= 1) return `${n.toFixed(4)} ICP`;
  if (abs >= 0.0001) return `${n.toFixed(6)} ICP`;
  if (abs > 0) return `${n.toFixed(8)} ICP`;
  return "0 ICP";
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function humanBalance(t: TokenHolding): number {
  const d = Math.max(0, t.decimals);
  return Number(t.balance) / 10 ** d;
}

export function valuePortfolio(
  tokens: TokenHolding[],
  book: PriceBook | null,
): PortfolioValuation {
  const lines = new Map<string, TokenFiatLine>();
  let totalUsd = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  const allocRaw: Array<{ ledgerId: string; symbol: string; usd: number }> =
    [];

  for (const t of tokens) {
    if (t.balance <= 0n && t.symbol !== "ICP") {
      lines.set(t.ledgerId, {
        ledgerId: t.ledgerId,
        usd: 0,
        icp: 0,
        change24hPct: null,
        priceUsd: null,
        priced: false,
      });
      continue;
    }
    const q = book?.byLedger.get(t.ledgerId.toLowerCase());
    const human = humanBalance(t);
    if (!q || !(q.usd > 0) || !Number.isFinite(human)) {
      unpricedCount += 1;
      lines.set(t.ledgerId, {
        ledgerId: t.ledgerId,
        usd: null,
        icp: null,
        change24hPct: null,
        priceUsd: null,
        priced: false,
      });
      continue;
    }
    const usd = human * q.usd;
    const icp =
      book && book.icpUsd > 0 ? usd / book.icpUsd : t.ledgerId === ICP_LEDGER ? human : null;
    pricedCount += 1;
    totalUsd += usd;
    lines.set(t.ledgerId, {
      ledgerId: t.ledgerId,
      usd,
      icp,
      change24hPct: q.change24hPct,
      priceUsd: q.usd,
      priced: true,
    });
    if (usd > 0) {
      allocRaw.push({ ledgerId: t.ledgerId, symbol: t.symbol, usd });
    }
  }

  const totalIcp = book && book.icpUsd > 0 ? totalUsd / book.icpUsd : 0;
  allocRaw.sort((a, b) => b.usd - a.usd);
  const allocation = allocRaw.slice(0, 6).map((a) => ({
    ...a,
    weight: totalUsd > 0 ? a.usd / totalUsd : 0,
  }));

  return {
    totalUsd,
    totalIcp,
    pricedCount,
    unpricedCount,
    lines,
    book,
    allocation,
  };
}

/** Prefetch helper — warms cache without throwing. */
export async function warmPrices(): Promise<PriceBook | null> {
  try {
    return await loadPriceBook(true);
  } catch {
    return null;
  }
}

/** Exposed for diagnostics / ALLOWLIST docs. */
export const PRICE_ENDPOINTS = {
  icpswap: `${ICPSWAP_API}/info/token/all`,
  coingeckoIcp: COINGECKO_ICP,
} as const;
