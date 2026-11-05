import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildIcpThumbnailCandidates,
  detectMediaKind,
  encodeExtTokenIdentifier,
  isDirectVideoUrl,
  isLikelyBlankImage,
  materializeIcpImageUrl,
  partnerThumbUrls,
  probeCollectionName,
  type MediaKind,
} from "@t3kno/ic-nft-aggregator";
import type { NftHolding } from "../lib/portfolio";
import { BAZAAR_MARKET_URL } from "../lib/constants";
import { isBazaarListable } from "../lib/bazaarList";
import {
  allItemsSelected,
  nftKey,
  someItemsSelected,
} from "../lib/nftSelection";
import {
  getCachedNftMedia,
  materializeNftMediaCached,
} from "../lib/nftMediaCache";
import { CopyButton } from "./CopyButton";
import { canisterExplorerUrl } from "../lib/addressDisplay";

type Props = {
  items: NftHolding[];
  onSelectSend: (n: NftHolding) => void;
  selectMode?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (n: NftHolding) => void;
  /** Toggle select-all for this collection's full item list (all pages). */
  onToggleSelectCollection?: (items: NftHolding[]) => void;
  onListOne?: (n: NftHolding) => void;
};

export type NftSortKey = "tokenId" | "name" | "serial";

const COL_MIN = 148;
const ROW_GAP = 12;
const CARD_H = 228;
/** Cards per page — keeps media mounts bounded while showing full collections. */
export const NFT_PAGE_SIZE = 24;

function compareTokenId(a: NftHolding, b: NftHolding): number {
  const an = Number(a.tokenId);
  const bn = Number(b.tokenId);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.tokenId.localeCompare(b.tokenId, undefined, { numeric: true });
}

function compareSerial(a: NftHolding, b: NftHolding): number {
  const as = a.catalogSerial ?? "";
  const bs = b.catalogSerial ?? "";
  if (as && bs) {
    const an = Number(as);
    const bn = Number(bs);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return as.localeCompare(bs, undefined, { numeric: true });
  }
  if (as && !bs) return -1;
  if (!as && bs) return 1;
  return compareTokenId(a, b);
}

export function sortNftHoldings(
  items: NftHolding[],
  sort: NftSortKey,
): NftHolding[] {
  const next = [...items];
  next.sort((a, b) => {
    if (sort === "name") {
      const byName = a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      return byName || compareTokenId(a, b);
    }
    if (sort === "serial") return compareSerial(a, b);
    return compareTokenId(a, b);
  });
  return next;
}

type CollectionSectionProps = Props & {
  label: string;
  groupId: string;
  /** Shared sort across collections when provided from parent. */
  sort?: NftSortKey;
  onSortChange?: (sort: NftSortKey) => void;
  /** Rescan only this collection canister. */
  onRefreshCollection?: () => void;
  refreshingCollection?: boolean;
};

/** One collection: sort + multi-page lazy window (no hard NFT cap). */
export function NftCollectionSection({
  label,
  groupId,
  items,
  sort: controlledSort,
  onSortChange,
  selectMode = false,
  selectedKeys,
  onToggleSelectCollection,
  onRefreshCollection,
  refreshingCollection = false,
  ...gridProps
}: CollectionSectionProps) {
  const [localSort, setLocalSort] = useState<NftSortKey>("tokenId");
  const sort = controlledSort ?? localSort;
  const [page, setPage] = useState(0);
  /** Progressive scans append to this order; user sort rebuilds it. */
  const orderRef = useRef<{ sort: NftSortKey; keys: string[] }>({
    sort: "tokenId",
    keys: [],
  });

  // Only reset paging when collection or sort changes — not on progressive length growth.
  useEffect(() => {
    setPage(0);
  }, [groupId, sort]);

  useEffect(() => {
    orderRef.current = { sort, keys: [] };
  }, [groupId, sort]);

  const stableItems = useMemo(() => {
    const byKey = new Map(items.map((n) => [nftKey(n), n]));
    const state = orderRef.current;
    if (state.keys.length === 0 || state.sort !== sort) {
      const sorted = sortNftHoldings(items, sort);
      orderRef.current = { sort, keys: sorted.map((n) => nftKey(n)) };
      return sorted;
    }
    const keySet = new Set(byKey.keys());
    const keys = state.keys.filter((k) => keySet.has(k));
    const seen = new Set(keys);
    for (const n of items) {
      const k = nftKey(n);
      if (seen.has(k)) continue;
      keys.push(k);
      seen.add(k);
    }
    orderRef.current = { sort, keys };
    return keys
      .map((k) => byKey.get(k))
      .filter((n): n is NftHolding => !!n);
  }, [items, sort]);

  const pageCount = Math.max(1, Math.ceil(stableItems.length / NFT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * NFT_PAGE_SIZE;
  const pageItems = stableItems.slice(start, start + NFT_PAGE_SIZE);
  const showingFrom = stableItems.length === 0 ? 0 : start + 1;
  const showingTo = Math.min(start + NFT_PAGE_SIZE, stableItems.length);

  const setSort = (next: NftSortKey) => {
    if (onSortChange) onSortChange(next);
    else setLocalSort(next);
  };

  const selected = selectedKeys ?? new Set<string>();
  const collectionAll = allItemsSelected(items, selected);
  const collectionSome = someItemsSelected(items, selected);

  return (
    <div className="nft-group" data-group={groupId}>
      <div className="nft-group__head">
        <div className="nft-group__title-row">
          {selectMode && onToggleSelectCollection ? (
            <label className="nft-select-all">
              <input
                type="checkbox"
                checked={collectionAll}
                ref={(el) => {
                  if (el) el.indeterminate = collectionSome;
                }}
                onChange={() => onToggleSelectCollection(items)}
                aria-label={`Select all in ${label}`}
              />
              <span className="muted">Select all</span>
            </label>
          ) : null}
          <h3>
            {label}{" "}
            <span className="muted">({stableItems.length})</span>
          </h3>
        </div>
        <div className="nft-group__controls">
          {onRefreshCollection ? (
            <button
              type="button"
              className="btn nft-group__refresh"
              disabled={refreshingCollection}
              onClick={() => onRefreshCollection()}
              title="Rescan this collection only"
            >
              {refreshingCollection ? "Scanning…" : "Refresh"}
            </button>
          ) : null}
          <label className="nft-sort">
            <span className="muted">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as NftSortKey)}
              aria-label={`Sort ${label}`}
            >
              <option value="tokenId">Token ID</option>
              <option value="name">Name</option>
              <option value="serial">Catalog serial</option>
            </select>
          </label>
        </div>
      </div>
      <HoldingsNftGrid
        items={pageItems}
        selectMode={selectMode}
        selectedKeys={selectedKeys}
        {...gridProps}
      />
      {stableItems.length > NFT_PAGE_SIZE ? (
        <div className="nft-pager">
          <span className="muted nft-pager__meta">
            Showing {showingFrom}–{showingTo} of {stableItems.length}
          </span>
          <div className="row nft-pager__btns">
            <button
              type="button"
              className="btn"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span className="muted">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </button>
            {safePage < pageCount - 1 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Load next{" "}
                {Math.min(NFT_PAGE_SIZE, stableItems.length - showingTo)}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Lightweight windowed grid — avoids mounting thousands of media nodes. */
export function HoldingsNftGrid({
  items,
  onSelectSend,
  selectMode = false,
  selectedKeys,
  onToggleSelect,
  onListOne,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(480);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setViewH(el.clientHeight);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Do not reset scroll on every progressive batch — that causes permanent jumpiness.

  const cols = Math.max(1, Math.floor((width + ROW_GAP) / (COL_MIN + ROW_GAP)));
  const rows = Math.ceil(items.length / cols) || 1;
  const totalH = rows * (CARD_H + ROW_GAP);
  const startRow = Math.max(0, Math.floor(scrollTop / (CARD_H + ROW_GAP)) - 1);
  const visibleRows = Math.ceil(viewH / (CARD_H + ROW_GAP)) + 3;
  const endRow = Math.min(rows, startRow + visibleRows);
  const startIdx = startRow * cols;
  const endIdx = Math.min(items.length, endRow * cols);
  const slice = items.slice(startIdx, endIdx);

  const padTop = startRow * (CARD_H + ROW_GAP);

  if (items.length === 0) return null;

  return (
    <div
      className="holdings-virt"
      ref={scrollerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="holdings-virt__spacer" style={{ height: totalH }}>
        <div
          className="holdings-virt__window"
          style={{
            transform: `translateY(${padTop}px)`,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          }}
        >
          {slice.map((n) => (
            <NftCard
              key={nftKey(n)}
              nft={n}
              selected={selectedKeys?.has(nftKey(n)) ?? false}
              selectMode={selectMode}
              onSelectSend={onSelectSend}
              onToggleSelect={onToggleSelect}
              onListOne={onListOne}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NftCard({
  nft,
  selected,
  selectMode,
  onSelectSend,
  onToggleSelect,
  onListOne,
}: {
  nft: NftHolding;
  selected: boolean;
  selectMode: boolean;
  onSelectSend: (n: NftHolding) => void;
  onToggleSelect?: (n: NftHolding) => void;
  onListOne?: (n: NftHolding) => void;
}) {
  const [open, setOpen] = useState(false);
  const kind = nft.mediaKind;
  // Video/audio must use mediaUrl — posterUrl is a still and breaks <video src>.
  const src =
    kind === "video" || kind === "audio"
      ? nft.mediaUrl || nft.imageUrl || nft.posterUrl
      : nft.posterUrl || nft.imageUrl || nft.mediaUrl;
  const poster =
    kind === "video" || kind === "audio"
      ? nft.posterUrl ||
        (nft.imageUrl && nft.imageUrl !== src ? nft.imageUrl : null)
      : null;
  const fallbacks = [nft.mediaUrl, nft.imageUrl, nft.posterUrl].filter(
    (u): u is string => !!u && u !== src,
  );
  const collectionLabel =
    nft.collectionName?.trim() || nft.contractId.slice(0, 12) + "…";

  return (
    <>
      <button
        type="button"
        className={`card holdings-card${selected ? " holdings-card--selected" : ""}`}
        onClick={() => {
          if (selectMode) {
            onToggleSelect?.(nft);
            return;
          }
          setOpen(true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelectSend(nft);
        }}
        title={
          selectMode
            ? "Click to select for bulk send / list"
            : "Click for details · right-click to send"
        }
      >
        {selectMode ? (
          <span
            className={`holdings-card__check${selected ? " is-on" : ""}`}
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? `Deselect ${nft.name}` : `Select ${nft.name}`}
          >
            <input
              type="checkbox"
              checked={selected}
              tabIndex={-1}
              readOnly
              aria-hidden
            />
          </span>
        ) : null}
        <MediaThumb
          kind={kind}
          src={src}
          poster={poster}
          fallbacks={fallbacks}
          name={nft.name}
          contractId={nft.contractId}
          tokenId={nft.tokenId}
        />
        <div className="t">{nft.name}</div>
        <div className="s">
          {collectionLabel}
          <br />
          {nft.standard} · #{nft.tokenId}
          {kind !== "image" && kind !== "unknown" ? ` · ${kind}` : ""}
        </div>
      </button>
      {open
        ? createPortal(
            <HoldingsLightbox
              nft={nft}
              onClose={() => setOpen(false)}
              onSend={() => {
                setOpen(false);
                onSelectSend(nft);
              }}
              onList={
                onListOne && isBazaarListable(nft)
                  ? () => {
                      setOpen(false);
                      onListOne(nft);
                    }
                  : undefined
              }
            />,
            document.body,
          )
        : null}
    </>
  );
}

function MediaThumb({
  kind,
  src,
  poster = null,
  fallbacks = [],
  name,
  contractId,
  tokenId,
  className = "holdings-media",
}: {
  kind: MediaKind;
  src: string | null;
  poster?: string | null;
  fallbacks?: string[];
  name: string;
  contractId: string;
  tokenId: string;
  className?: string;
}) {
  const numericIndex = useMemo(() => {
    if (!/^\d+$/.test(tokenId.trim())) return null;
    const n = Number.parseInt(tokenId, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [tokenId]);

  const [extTokenId, setExtTokenId] = useState<string | null>(
    numericIndex == null ? tokenId : null,
  );
  const [tidReady, setTidReady] = useState(numericIndex == null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState<string | null>(() =>
    getCachedNftMedia(contractId, tokenId),
  );

  useEffect(() => {
    const cached = getCachedNftMedia(contractId, tokenId);
    if (cached) {
      setResolved(cached);
      setFailed(false);
      setAttempt(0);
      setTidReady(true);
      return;
    }
    if (numericIndex == null) {
      setTidReady(true);
      return;
    }
    let cancelled = false;
    setTidReady(false);
    void encodeExtTokenIdentifier(contractId, numericIndex)
      .then((tid) => {
        if (!cancelled) {
          setExtTokenId(tid);
          setTidReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setTidReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId, numericIndex, tokenId]);

  const candidates = useMemo(() => {
    const partner = partnerThumbUrls(contractId, tokenId);
    const preferred =
      [src, ...fallbacks].find(
        (u) =>
          !!u &&
          (/^https?:\/\//i.test(u) ||
            u.toLowerCase().startsWith("data:image/") ||
            u.toLowerCase().startsWith("data:video/") ||
            u.toLowerCase().startsWith("data:audio/")),
      ) ?? null;

    // Prefer .mp4 / video URLs first when this NFT is video (or src is video).
    const videoFirst = [src, ...fallbacks]
      .filter((u): u is string => !!u && isDirectVideoUrl(u))
      .filter((u, i, a) => a.indexOf(u) === i);

    if (
      preferred &&
      (/^https?:\/\//i.test(preferred) ||
        preferred.toLowerCase().startsWith("data:image/") ||
        preferred.toLowerCase().startsWith("data:video/") ||
        preferred.toLowerCase().startsWith("data:audio/"))
    ) {
      const list: string[] = [];
      for (const u of partner) {
        if (!list.includes(u)) list.push(u);
      }
      for (const u of videoFirst) {
        if (!list.includes(u)) list.push(u);
      }
      if (preferred && !list.includes(preferred)) list.push(preferred);
      for (const u of fallbacks) {
        if (u && !list.includes(u)) list.push(u);
      }
      if (numericIndex != null && !tidReady) return list;
      const built = buildIcpThumbnailCandidates(contractId, numericIndex ?? 0, {
        preferred: null,
        extTokenId:
          extTokenId && extTokenId.length > 20 ? extTokenId : null,
        includeEntrepotProxy: false,
        preferFullAssetBeforeThumbnail: true,
      });
      for (const u of built) {
        if (!list.includes(u)) list.push(u);
      }
      return list;
    }

    if (numericIndex != null && !tidReady) {
      return [...partner, ...videoFirst];
    }

    const built = buildIcpThumbnailCandidates(contractId, numericIndex ?? 0, {
      preferred,
      extTokenId:
        extTokenId && extTokenId.length > 20 ? extTokenId : null,
      includeEntrepotProxy: false,
      preferFullAssetBeforeThumbnail: true,
    });
    const list = [...partner, ...videoFirst];
    for (const u of built) {
      if (!list.includes(u)) list.push(u);
    }
    return list;
  }, [
    src,
    fallbacks,
    contractId,
    numericIndex,
    extTokenId,
    tidReady,
  ]);

  const candidatesKey = candidates.join("\0");

  useEffect(() => {
    // Keep showing cached art while candidate list refreshes — no blank flash.
    if (getCachedNftMedia(contractId, tokenId)) return;
    setAttempt(0);
    setFailed(false);
  }, [contractId, tokenId, candidatesKey]);

  useEffect(() => {
    if (failed || !tidReady) return;
    const cached = getCachedNftMedia(contractId, tokenId);
    if (cached) {
      if (resolved !== cached) setResolved(cached);
      return;
    }
    const candidate = candidates[attempt];
    if (!candidate) {
      if (candidates.length === 0) return;
      setFailed(true);
      return;
    }
    let cancelled = false;
    const candidateKind = detectMediaKind(candidate);
    if (
      candidate.toLowerCase().startsWith("data:") ||
      kind === "video" ||
      kind === "audio" ||
      candidateKind === "video" ||
      candidateKind === "audio" ||
      isDirectVideoUrl(candidate)
    ) {
      setResolved(candidate);
      return;
    }
    void materializeNftMediaCached(
      contractId,
      tokenId,
      candidate,
      materializeIcpImageUrl,
    ).then((url) => {
      if (cancelled) return;
      if (!url) {
        const next = attempt + 1;
        if (next < candidates.length) setAttempt(next);
        else setFailed(true);
        return;
      }
      setResolved(url);
    });
    return () => {
      cancelled = true;
    };
  }, [
    candidates,
    candidatesKey,
    attempt,
    failed,
    tidReady,
    kind,
    contractId,
    tokenId,
  ]);

  // Reserve space even while resolving — prevents grid jump when art arrives.
  if (!resolved) {
    return <div className={`card-ph ${className}`} aria-hidden />;
  }

  const playKind: MediaKind =
    detectMediaKind(resolved) === "video" ||
    kind === "video" ||
    isDirectVideoUrl(resolved)
      ? "video"
      : detectMediaKind(resolved) === "audio" || kind === "audio"
        ? "audio"
        : kind === "gif"
          ? "gif"
          : "image";

  if (playKind === "video") {
    return (
      <video
        className={className}
        src={resolved}
        poster={poster && !isDirectVideoUrl(poster) ? poster : undefined}
        muted
        playsInline
        loop
        autoPlay
        preload="metadata"
        onError={() => {
          const next = attempt + 1;
          if (next < candidates.length) setAttempt(next);
          else setFailed(true);
        }}
      />
    );
  }
  if (playKind === "audio") {
    return (
      <div className="card-ph holdings-audio-ph">
        <span>Audio</span>
        <audio src={resolved} preload="metadata" />
      </div>
    );
  }
  return (
    <img
      src={resolved}
      alt={name}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onLoad={(e) => {
        if (isLikelyBlankImage(e.currentTarget)) {
          const next = attempt + 1;
          if (next < candidates.length) setAttempt(next);
          else setFailed(true);
        }
      }}
      onError={() => {
        const next = attempt + 1;
        if (next < candidates.length) setAttempt(next);
        else setFailed(true);
      }}
    />
  );
}

function describeUtility(nft: NftHolding): string | null {
  if (nft.utilityNotes?.trim()) return nft.utilityNotes.trim();
  const attrs = nft.attributes ?? {};
  const utilKeys = Object.entries(attrs).filter(([k]) =>
    /util|access|tier|member|pass|perk|benefit|gate/i.test(k),
  );
  if (utilKeys.length) {
    return utilKeys.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }
  if (nft.bazaarCollectionId) {
    return "Bonsai Bazaar NFT Market–compliant. List for sale from Canopy; buy on the Market page.";
  }
  if (nft.standard === "ext" || nft.standard === "index") {
    return "Legacy EXT / Entrepot-era collection. Transfer from Canopy; marketplace listing uses the collection’s native EXT list path (coming with analytics).";
  }
  return null;
}

function HoldingsLightbox({
  nft,
  onClose,
  onSend,
  onList,
}: {
  nft: NftHolding;
  onClose: () => void;
  onSend: () => void;
  onList?: () => void;
}) {
  const media = nft.mediaUrl || nft.imageUrl;
  const kind = nft.mediaKind;
  const [resolvedName, setResolvedName] = useState(nft.collectionName);
  const [probeMsg, setProbeMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const looksTruncated =
      !nft.collectionName ||
      nft.collectionName.includes("…") ||
      /^[a-z0-9-]{20,}-cai$/i.test(nft.collectionName);
    if (!looksTruncated) return;
    setProbeMsg("Resolving collection name…");
    void probeCollectionName(nft.contractId).then((name) => {
      if (cancelled) return;
      if (name) setResolvedName(name);
      setProbeMsg(null);
    });
    return () => {
      cancelled = true;
    };
  }, [nft.contractId, nft.collectionName]);

  const collectionLabel = resolvedName?.trim() || nft.contractId;
  const utility = describeUtility(nft);
  const attrs = Object.entries(nft.attributes ?? {});
  const marketHref = nft.bazaarCollectionId
    ? `${BAZAAR_MARKET_URL}/collection/${nft.bazaarCollectionId}`
    : `${BAZAAR_MARKET_URL}/`;

  return (
    <div className="holdings-lb" role="dialog" aria-modal onClick={onClose}>
      <div
        className="holdings-lb__panel glass-panel holdings-lb__panel--deep"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="holdings-lb__stage">
          {!media && kind !== "image" && kind !== "video" && kind !== "unknown" ? (
            <div className="card-ph" />
          ) : kind === "audio" ? (
            <div className="holdings-lb__audio">
              <MediaThumb
                kind="image"
                src={nft.posterUrl || nft.imageUrl}
                fallbacks={[nft.imageUrl, nft.posterUrl].filter(
                  (u): u is string => !!u,
                )}
                name={nft.name}
                contractId={nft.contractId}
                tokenId={nft.tokenId}
              />
              {media ? <audio src={media} controls autoPlay /> : null}
            </div>
          ) : kind === "html" && media && media.includes(".raw.") ? (
            <iframe
              title={nft.name}
              src={media}
              sandbox="allow-scripts allow-same-origin"
              className="holdings-lb__frame"
            />
          ) : (
            <MediaThumb
              kind={kind === "video" ? "video" : "image"}
              src={
                kind === "video"
                  ? nft.mediaUrl || nft.imageUrl || nft.posterUrl
                  : nft.posterUrl || nft.imageUrl || nft.mediaUrl
              }
              poster={
                kind === "video"
                  ? nft.posterUrl ||
                    (nft.imageUrl && !isDirectVideoUrl(nft.imageUrl)
                      ? nft.imageUrl
                      : null)
                  : null
              }
              fallbacks={[nft.mediaUrl, nft.imageUrl, nft.posterUrl].filter(
                (u): u is string => !!u,
              )}
              name={nft.name}
              contractId={nft.contractId}
              tokenId={nft.tokenId}
              className="holdings-lb__media"
            />
          )}
        </div>
        <div className="holdings-lb__meta holdings-lb__meta--deep">
          <strong>{nft.name}</strong>
          <span className="muted">
            {collectionLabel}
            {probeMsg ? ` · ${probeMsg}` : ""}
          </span>
          <dl className="holdings-lb__facts">
            <div>
              <dt>Standard</dt>
              <dd>{nft.standard.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd className="holdings-lb__copy-row">
                <span>#{nft.tokenId}</span>
                <CopyButton value={nft.tokenId} label="Copy" compact />
              </dd>
            </div>
            {nft.catalogSerial ? (
              <div>
                <dt>Catalog serial</dt>
                <dd>#{nft.catalogSerial}</dd>
              </div>
            ) : null}
            {nft.bazaarCollectionId ? (
              <div>
                <dt>Bazaar collection</dt>
                <dd className="holdings-lb__copy-row">
                  <span>{nft.bazaarCollectionId}</span>
                  <CopyButton value={nft.bazaarCollectionId} label="Copy" compact />
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Canister</dt>
              <dd className="holdings-lb__copy-row">
                <span className="mono">{nft.contractId}</span>
                <CopyButton value={nft.contractId} label="Copy" compact />
              </dd>
            </div>
          </dl>
          {nft.description ? (
            <p className="holdings-lb__desc">{nft.description}</p>
          ) : null}
          {utility ? (
            <div className="holdings-lb__utility">
              <h4>Utility</h4>
              <p>{utility}</p>
            </div>
          ) : null}
          {attrs.length ? (
            <div className="holdings-lb__traits">
              <h4>Traits</h4>
              <ul>
                {attrs.map(([k, v]) => (
                  <li key={k}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted holdings-lb__hint">
              Trait / rarity sorting lands with the next analytics pass — metadata
              is already plumbed when the ledger exposes it.
            </p>
          )}
          <div className="row holdings-lb__actions">
            {onList ? (
              <button type="button" className="btn btn-primary" onClick={onList}>
                List on Bazaar
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={onSend}>
              Send
            </button>
            <a
              className="btn"
              href={marketHref}
              target="_blank"
              rel="noreferrer"
            >
              Open on Market
            </a>
            <a
              className="btn"
              href={canisterExplorerUrl(nft.contractId)}
              target="_blank"
              rel="noreferrer"
            >
              Canister
            </a>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="muted holdings-lb__hint">
            Buys settle on the Bazaar NFT Market page — Canopy lists and transfers
            only. Do not send to Plug or wallets that may not index this collection
            — the NFT can become hard to retrieve.
          </p>
        </div>
      </div>
    </div>
  );
}

export function useGroupedNfts(nfts: NftHolding[]) {
  /**
   * Stable order for non-Bazaar groups (first-seen).
   * Bazaar-registered series always sort by collection id ascending.
   */
  const orderRef = useRef<string[]>([]);

  return useMemo(() => {
    const map = new Map<string, { label: string; items: NftHolding[] }>();
    for (const n of nfts) {
      const id = n.groupKey;
      const label =
        n.collectionName?.trim() || n.contractId.slice(0, 12) + "…";
      const g = map.get(id);
      if (g) {
        const k = nftKey(n);
        if (g.items.some((x) => nftKey(x) === k)) continue;
        g.items.push(n);
        if (
          n.collectionName &&
          (!g.label || g.label.includes("…")) &&
          !n.collectionName.includes("…")
        ) {
          g.label = n.collectionName.trim();
        }
      } else map.set(id, { label, items: [n] });
    }

    const present = new Set(map.keys());
    orderRef.current = orderRef.current.filter((id) => present.has(id));
    const seen = new Set(orderRef.current);
    for (const id of map.keys()) {
      if (seen.has(id)) continue;
      orderRef.current.push(id);
      seen.add(id);
    }

    const groups = orderRef.current
      .map((id) => {
        const g = map.get(id);
        return g ? ([id, g] as const) : null;
      })
      .filter(
        (e): e is readonly [string, { label: string; items: NftHolding[] }] =>
          !!e,
      );

    const bazaarId = (items: NftHolding[]) => {
      for (const n of items) {
        if (n.bazaarCollectionId && /^\d+$/.test(n.bazaarCollectionId)) {
          return Number(n.bazaarCollectionId);
        }
      }
      return null;
    };

    groups.sort((a, b) => {
      const aB = bazaarId(a[1].items);
      const bB = bazaarId(b[1].items);
      if (aB != null && bB != null) return aB - bB;
      if (aB != null) return -1;
      if (bB != null) return 1;
      return a[1].label.localeCompare(b[1].label, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });

    return groups;
  }, [nfts]);
}

export { nftKey };
