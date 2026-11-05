import { icpPortfolioNftKey } from "@t3kno/ic-nft-aggregator";

/** NFT multi-select helpers for Canopy holdings (bulk send / list). */

export type NftKeyable = {
  contractId: string;
  tokenId: string;
};

export function nftKey(n: NftKeyable): string {
  return icpPortfolioNftKey(n.contractId, n.tokenId);
}

/**
 * Merge progressive NFT scan results into the previous list without reshuffling
 * already-visible items (prevents collection/grid jumpiness).
 *
 * @param dropMissing When false (default during progressive batches), keep prev
 *   items not yet in `next` — a fresh deep scan starts from indexes-only and
 *   must not wipe EXT hits from the fast pass. When true (final flush), drop
 *   sold/missing tokens so the list matches the completed scan.
 */
export function mergeNftHoldingsStable<T extends NftKeyable>(
  prev: T[],
  next: T[],
  opts?: { dropMissing?: boolean },
): T[] {
  if (!prev.length) return next;
  if (!next.length) return prev;

  const dropMissing = opts?.dropMissing === true;
  const nextMap = new Map(next.map((n) => [nftKey(n), n]));
  const out: T[] = [];
  const seen = new Set<string>();

  for (const p of prev) {
    const k = nftKey(p);
    const n = nextMap.get(k);
    if (!n) {
      if (dropMissing) continue;
      out.push(p);
      seen.add(k);
      continue;
    }
    out.push(n);
    seen.add(k);
  }
  for (const n of next) {
    const k = nftKey(n);
    if (seen.has(k)) continue;
    out.push(n);
    seen.add(k);
  }
  return out;
}

export function toggleKey(prev: Set<string>, key: string): Set<string> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function selectKeys(prev: Set<string>, keys: Iterable<string>): Set<string> {
  const next = new Set(prev);
  for (const k of keys) next.add(k);
  return next;
}

export function deselectKeys(
  prev: Set<string>,
  keys: Iterable<string>,
): Set<string> {
  const next = new Set(prev);
  for (const k of keys) next.delete(k);
  return next;
}

export function keysForItems(items: NftKeyable[]): string[] {
  return items.map(nftKey);
}

/** True when every item key is present in selected. Empty items → false. */
export function allItemsSelected(
  items: NftKeyable[],
  selected: Set<string>,
): boolean {
  if (items.length === 0) return false;
  return items.every((n) => selected.has(nftKey(n)));
}

/** True when some but not all item keys are selected. */
export function someItemsSelected(
  items: NftKeyable[],
  selected: Set<string>,
): boolean {
  if (items.length === 0) return false;
  let any = false;
  let all = true;
  for (const n of items) {
    if (selected.has(nftKey(n))) any = true;
    else all = false;
  }
  return any && !all;
}

/**
 * Toggle select-all for a collection (or any item list).
 * If all selected → deselect them; otherwise select all.
 */
export function toggleSelectAllForItems(
  prev: Set<string>,
  items: NftKeyable[],
): Set<string> {
  const keys = keysForItems(items);
  if (allItemsSelected(items, prev)) return deselectKeys(prev, keys);
  return selectKeys(prev, keys);
}

/** Replace selection with all keys from items (wallet-wide select). */
export function selectAllForItems(items: NftKeyable[]): Set<string> {
  return new Set(keysForItems(items));
}
