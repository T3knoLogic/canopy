/**
 * Local wallet registry — custom tokens / NFT collections + visibility.
 * Non-custodial: metadata only in localStorage (per browser / device).
 */
import type { SeedLedger } from "../constants";
import type { NftStandard } from "../nfts/sense";

const TOKENS_KEY = "canopy.wallet.tokens.v1";
const NFTS_KEY = "canopy.wallet.nfts.v1";
const HIDDEN_SEED_KEY = "canopy.wallet.hiddenSeed.v1";

export type WalletToken = SeedLedger & {
  visible: boolean;
  source: "manual" | "seed" | "icpswap";
  addedAt: number;
};

export type WalletNftCollection = {
  id: string;
  name: string;
  standard: NftStandard;
  thumbnailUrl: string | null;
  visible: boolean;
  source: "manual" | "discovered";
  addedAt: number;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function loadWalletTokens(): WalletToken[] {
  const rows = readJson<WalletToken[]>(TOKENS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function saveWalletTokens(tokens: WalletToken[]): void {
  writeJson(TOKENS_KEY, tokens);
}

export function upsertWalletToken(
  token: Omit<WalletToken, "addedAt" | "visible"> & {
    visible?: boolean;
    addedAt?: number;
  },
): WalletToken[] {
  const list = loadWalletTokens();
  const id = token.id.toLowerCase();
  const idx = list.findIndex((t) => t.id === id);
  const row: WalletToken = {
    ...token,
    id,
    visible: token.visible ?? true,
    addedAt: token.addedAt ?? Date.now(),
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx]!, ...row, addedAt: list[idx]!.addedAt };
  } else {
    list.push(row);
  }
  saveWalletTokens(list);
  return list;
}

export function setTokenVisible(id: string, visible: boolean): WalletToken[] {
  const list = loadWalletTokens().map((t) =>
    t.id === id.toLowerCase() ? { ...t, visible } : t,
  );
  saveWalletTokens(list);
  return list;
}

export function removeWalletToken(id: string): WalletToken[] {
  const list = loadWalletTokens().filter((t) => t.id !== id.toLowerCase());
  saveWalletTokens(list);
  return list;
}

export function loadHiddenSeedIds(): Set<string> {
  const rows = readJson<string[]>(HIDDEN_SEED_KEY, []);
  return new Set((Array.isArray(rows) ? rows : []).map((x) => x.toLowerCase()));
}

export function setSeedTokenVisible(id: string, visible: boolean): Set<string> {
  const set = loadHiddenSeedIds();
  const n = id.toLowerCase();
  if (visible) set.delete(n);
  else set.add(n);
  writeJson(HIDDEN_SEED_KEY, [...set]);
  return set;
}

export function loadWalletNfts(): WalletNftCollection[] {
  const rows = readJson<WalletNftCollection[]>(NFTS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function saveWalletNfts(rows: WalletNftCollection[]): void {
  writeJson(NFTS_KEY, rows);
}

export function upsertWalletNft(
  col: Omit<WalletNftCollection, "addedAt" | "visible"> & {
    visible?: boolean;
    addedAt?: number;
  },
): WalletNftCollection[] {
  const list = loadWalletNfts();
  const id = col.id.toLowerCase();
  const idx = list.findIndex((t) => t.id === id);
  const row: WalletNftCollection = {
    ...col,
    id,
    visible: col.visible ?? true,
    addedAt: col.addedAt ?? Date.now(),
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx]!, ...row, addedAt: list[idx]!.addedAt };
  } else {
    list.push(row);
  }
  saveWalletNfts(list);
  return list;
}

export function setNftVisible(
  id: string,
  visible: boolean,
): WalletNftCollection[] {
  const list = loadWalletNfts().map((t) =>
    t.id === id.toLowerCase() ? { ...t, visible } : t,
  );
  saveWalletNfts(list);
  return list;
}

export function removeWalletNft(id: string): WalletNftCollection[] {
  const list = loadWalletNfts().filter((t) => t.id !== id.toLowerCase());
  saveWalletNfts(list);
  return list;
}

/** Manual + visible catalog extras to always probe for balances. */
export function manualVisibleLedgerIds(): string[] {
  return loadWalletTokens()
    .filter((t) => t.visible)
    .map((t) => t.id);
}

/** Manual visible NFT canisters for holdings warm list. */
export function manualVisibleNftCanisters(): string[] {
  return loadWalletNfts()
    .filter((t) => t.visible)
    .map((t) => t.id);
}
