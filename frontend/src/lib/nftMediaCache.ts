/**
 * Session cache for materialized NFT preview URLs (data: SVG composites, unwrapped
 * asset URLs). Survives React remounts so the grid does not re-fetch / jump.
 */
const MAX = 800;

const resolvedByKey = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

export function nftMediaCacheKey(contractId: string, tokenId: string): string {
  return `${contractId.trim().toLowerCase()}:${String(tokenId).trim()}`;
}

export function getCachedNftMedia(
  contractId: string,
  tokenId: string,
): string | null {
  return resolvedByKey.get(nftMediaCacheKey(contractId, tokenId)) ?? null;
}

export function setCachedNftMedia(
  contractId: string,
  tokenId: string,
  url: string,
): void {
  const key = nftMediaCacheKey(contractId, tokenId);
  if (resolvedByKey.has(key)) resolvedByKey.delete(key);
  resolvedByKey.set(key, url);
  while (resolvedByKey.size > MAX) {
    const first = resolvedByKey.keys().next().value as string | undefined;
    if (first == null) break;
    resolvedByKey.delete(first);
  }
}

/** Deduped materialize — concurrent thumbs for the same NFT share one fetch. */
export function materializeNftMediaCached(
  contractId: string,
  tokenId: string,
  candidate: string,
  materialize: (url: string) => Promise<string | null>,
): Promise<string | null> {
  const hit = getCachedNftMedia(contractId, tokenId);
  if (hit) return Promise.resolve(hit);

  const flightKey = `${nftMediaCacheKey(contractId, tokenId)}|${candidate}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;

  const p = materialize(candidate)
    .then((url) => {
      inFlight.delete(flightKey);
      if (url) setCachedNftMedia(contractId, tokenId, url);
      return url;
    })
    .catch(() => {
      inFlight.delete(flightKey);
      return null;
    });
  inFlight.set(flightKey, p);
  return p;
}
