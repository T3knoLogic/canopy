/**
 * Collection thumbnail resolution + cache (EXT / ICRC-7 raw candidates).
 */
import {
  ENCHANTED_BONSAI_COLLECTION_BANNER,
  ENCHANTED_BONSAI_LEDGER_ID,
} from "@t3kno/ic-nft-aggregator";

const THUMB_CACHE_KEY = "canopy.nft.thumbs.v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ThumbCache = { at: number; map: Record<string, string> };

function readCache(): ThumbCache | null {
  try {
    const raw = localStorage.getItem(THUMB_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThumbCache;
    if (!parsed?.map || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(map: Record<string, string>): void {
  try {
    localStorage.setItem(
      THUMB_CACHE_KEY,
      JSON.stringify({ at: Date.now(), map }),
    );
  } catch {
    /* quota */
  }
}

export function collectionThumbCandidates(
  canisterId: string,
  preferred?: string | null,
): string[] {
  const id = canisterId.trim().toLowerCase();
  const out: string[] = [];
  const push = (u?: string | null) => {
    if (!u) return;
    const t = u.trim();
    if (!t || out.includes(t)) return;
    if (t.startsWith("data:") || t.startsWith("http") || t.startsWith("/")) {
      out.push(t);
    }
  };
  push(preferred);
  if (id === ENCHANTED_BONSAI_LEDGER_ID.toLowerCase()) {
    push(ENCHANTED_BONSAI_COLLECTION_BANNER);
  }
  try {
    const cached = localStorage.getItem("canopy.nft.thumbs.v1");
    if (cached) {
      const parsed = JSON.parse(cached) as { map?: Record<string, string> };
      push(parsed.map?.[id]);
    }
  } catch {
    /* ignore */
  }
  push(`https://${id}.raw.icp0.io/?index=0&type=thumbnail`);
  push(`https://${id}.raw.icp0.io/collection/logo.png`);
  push(`https://${id}.raw.icp0.io/logo.png`);
  push(`https://${id}.raw.icp0.io/thumbnails/0.png`);
  push(`https://${id}.raw.icp0.io/?tokenid=0&type=thumbnail`);
  return out;
}

/** Probe URL list; first that loads as an image wins. */
export async function pickWorkingThumb(
  candidates: string[],
  timeoutMs = 4500,
): Promise<string | null> {
  for (const url of candidates) {
    if (url.startsWith("data:")) return url;
    const ok = await new Promise<boolean>((resolve) => {
      const img = new Image();
      const t = window.setTimeout(() => {
        img.src = "";
        resolve(false);
      }, timeoutMs);
      img.onload = () => {
        window.clearTimeout(t);
        resolve(img.naturalWidth > 0);
      };
      img.onerror = () => {
        window.clearTimeout(t);
        resolve(false);
      };
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.src = url;
    });
    if (ok) return url;
  }
  return null;
}

/**
 * Resolve thumbs for many collections. `preferredById` skips network when
 * holdings already have art (fast path).
 */
export async function resolveCollectionThumbs(
  canisterIds: string[],
  preferredById?: Record<string, string | null | undefined>,
  opts?: { concurrency?: number; onPartial?: (map: Record<string, string>) => void },
): Promise<Record<string, string>> {
  const cached = readCache()?.map ?? {};
  const out: Record<string, string> = { ...cached };
  const concurrency = opts?.concurrency ?? 12;
  const need: string[] = [];

  for (const raw of canisterIds) {
    const id = raw.trim().toLowerCase();
    if (!id) continue;
    const pref = preferredById?.[id];
    if (pref && (pref.startsWith("http") || pref.startsWith("data:"))) {
      out[id] = pref;
      continue;
    }
    if (out[id]) continue;
    need.push(id);
  }

  if (Object.keys(out).length) opts?.onPartial?.({ ...out });

  let i = 0;
  async function worker() {
    while (i < need.length) {
      const idx = i++;
      const id = need[idx]!;
      const picked = await pickWorkingThumb(
        collectionThumbCandidates(id, preferredById?.[id]),
      );
      if (picked) {
        out[id] = picked;
        opts?.onPartial?.({ ...out });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, need.length)) }, () =>
      worker(),
    ),
  );
  writeCache(out);
  return out;
}

export function getCachedThumb(canisterId: string): string | undefined {
  return readCache()?.map[canisterId.trim().toLowerCase()];
}
