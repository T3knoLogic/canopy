import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Identity } from "@dfinity/agent";
import { principalToAccountId } from "@t3kno/ic-nft-aggregator";
import { CanopyAtmosphere } from "./components/CanopyAtmosphere";
import { CopyButton } from "./components/CopyButton";
import {
  NftCollectionSection,
  useGroupedNfts,
  type NftSortKey,
} from "./components/HoldingsNftGrid";
import {
  mergeNftHoldingsStable,
  nftKey,
  selectAllForItems,
  toggleKey,
  toggleSelectAllForItems,
} from "./lib/nftSelection";
import { ManageWalletPanel } from "./components/ManageWalletPanel";
import { ActivityStrip } from "./components/ActivityStrip";
import { NftSendModal } from "./components/NftSendModal";
import { CanopyChrome } from "./components/CanopyChrome";
import { ReceiveSheet } from "./components/ReceiveSheet";
import { TokenLogo } from "./components/TokenLogo";
import { TokenSendModal } from "./components/TokenSendModal";
import type { TabKind } from "./components/holoTypes";
import {
  canisterExplorerUrl,
  shortenAddress,
} from "./lib/addressDisplay";
import {
  clearActivity,
  icpTxExplorerUrl,
  loadActivity,
  pushActivity,
  type ActivityEntry,
} from "./lib/activity";
import { parseDestination, rememberRecipient } from "./lib/destinations";
import { icpSwapUrl, loadLabsEnabled, setLabsEnabled } from "./lib/labs";
import { readClipboardText } from "./lib/clipboard";
import {
  formatIcpValue,
  formatPct,
  formatUsd,
  loadPriceBook,
  valuePortfolio,
  type PriceBook,
} from "./lib/prices";
import {
  icpToE8s,
  isBazaarListable,
  listBazaarNftFromCanopy,
} from "./lib/bazaarList";
import { resolveBazaarCollectionId } from "./lib/bazaarCollectionResolve";
import { isOsDataSaver } from "@bonsai-os-sdk";

const CanopyHoloScene = lazy(() =>
  import("./components/CanopyHoloScene").then((m) => ({
    default: m.CanopyHoloScene,
  })),
);

/** Data Saver: smaller NFT media warm; full quality when off. */
function canopyNftPrefetchCap(full: number): number {
  return isOsDataSaver() ? Math.min(8, full) : full;
}
import {
  ensureStepUpIfNeeded,
  loginWithIiOrRedirect,
  logoutIi,
  preferCanopyAuthRedirect,
  beginCanopyAuthRedirect,
  principalText,
  restoreIdentity,
} from "./lib/auth";
import {
  clearPendingFtSend,
  loadPendingFtSend,
  savePendingFtSend,
} from "./lib/pendingFtSend";
import {
  installCanopyHostAuthSync,
  requestCanopyHostDelegation,
} from "./lib/embedHostAuth";
import {
  BAZAAR_MARKET_URL,
  ICP_LEDGER,
  KONG_SWAP_URL,
  NFT_MIGRATOR_URL,
  SEED_ICRC1_LEDGERS,
  type SeedLedger,
} from "./lib/constants";
import { formatToken, parseTokenAmount } from "./lib/ledger";
import { isUnverifiedLedger, isUnverifiedNftCollection } from "./lib/ledgerRisk";
import {
  diffNftInbounds,
  diffTokenInbounds,
  formatInboundStatus,
  formatNftInboundStatus,
  loadNftHoldings,
  loadNftSnapshot,
  loadTokenHoldings,
  loadTokenSnapshot,
  mergeTokenHoldingsPoll,
  prefetchNftMedia,
  afterUiIdle,
  replaceNftGroup,
  rescanNftCollection,
  saveNftSnapshot,
  saveTokenSnapshot,
  warmTokenCatalog,
  type NftHolding,
  type TokenHolding,
} from "./lib/portfolio";
import {
  executeFtSend,
  executeIcrc7Send,
  executeExtSend,
  executeBulkNftSend,
  NFT_FOREIGN_WALLET_ACK,
  NFT_FOREIGN_WALLET_RISKS,
} from "./lib/send";
import { useSpendReview } from "./lib/spendReview";
import { useNotify } from "./lib/notify";
import { listCachedOrSeedLedgers } from "./lib/swap/tokenList";
import { prefetchTokenLogos } from "./lib/tokens/logos";
import {
  NFT_BULK_SEND_UI_CAP,
  quoteFtSendFee,
  quoteNftSendBulkFee,
  quoteNftSendFeeE8s,
  type NftBulkFeeQuote,
} from "./lib/fees";
import {
  createCanisterFromCycles,
  fetchCyclesLedgerBalance,
  formatCycles,
  mintCyclesToWallet,
  quoteCycleOp,
  sendCyclesLedger,
  topUpCanisterInHouse,
  withdrawCyclesToCanister,
  type CycleOpQuote,
} from "./lib/cycles/ops";
import {
  addCycleBookmark,
  loadCycleBookmarks,
  removeCycleBookmark,
  type CycleBookmark,
} from "./lib/cycles/bookmarks";
type Tab = TabKind;
type CycleMode =
  | "topup"
  | "mint"
  | "withdraw"
  | "send"
  | "create";

const TAB_IDS = ["tokens", "nfts", "cycles", "manage"] as const;
/** Cycles stays behind Labs until CMC recovery UX is battle-tested. */
const RETIRED_TABS = new Set(["send", "swap"]);

function labsOn(): boolean {
  return loadLabsEnabled();
}

function initialTab(): Tab {
  if (typeof window === "undefined") return "tokens";
  const q = new URLSearchParams(window.location.search).get("tab");
  if (!q || RETIRED_TABS.has(q)) return "tokens";
  if (q === "cycles" && !labsOn()) return "tokens";
  return (TAB_IDS as readonly string[]).includes(q) ? (q as Tab) : "tokens";
}

const isEmbed =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).get("embed") === "os" ||
    window.parent !== window);

function parseIcpToE8s(raw: string): bigint {
  const [whole, frac = ""] = raw.trim().split(".");
  const fracPad = (frac + "00000000").slice(0, 8);
  return BigInt(whole || "0") * 100_000_000n + BigInt(fracPad || "0");
}

function parseCyclesAmount(raw: string): bigint {
  const t = raw.trim().toLowerCase();
  if (!t) return 0n;
  if (t.endsWith("t")) {
    const n = Number(t.slice(0, -1));
    if (!Number.isFinite(n)) return 0n;
    return BigInt(Math.floor(n * 1e12));
  }
  if (t.includes("e") || t.includes(".")) {
    const n = Number(t);
    if (!Number.isFinite(n)) return 0n;
    return BigInt(Math.floor(n));
  }
  return BigInt(t);
}

export function App() {
  const { requestSpendReview } = useSpendReview();
  const notify = useNotify();
  const [identity, setIdentity] = useState<Identity | null>(null);
  /** True when identity came from Bazaar/Hub iframe sub-delegation (not local AuthClient). */
  const [hostLinked, setHostLinked] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [labsEnabled, setLabsEnabledState] = useState(() => loadLabsEnabled());
  useEffect(() => {
    /* Persist URL ?labs=1 so Cycles stays available after navigation. */
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("labs") === "1" || q.get("labs") === "true") {
        setLabsEnabled(true);
        setLabsEnabledState(true);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const [activity, setActivity] = useState<ActivityEntry[]>(() =>
    typeof window !== "undefined" ? loadActivity() : [],
  );
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tokens, setTokens] = useState<TokenHolding[]>([]);
  const [nfts, setNfts] = useState<NftHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const selectTab = useCallback((next: Tab) => {
    if (RETIRED_TABS.has(next)) return;
    if (next === "cycles" && !loadLabsEnabled()) return;
    setTab(next);
    if (typeof window === "undefined" || isEmbed) return;
    try {
      const url = new URL(window.location.href);
      if (next === "tokens") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url);
    } catch {
      /* ignore */
    }
  }, []);

  // Send (token/NFT sheets — no standalone Send tab)
  const [ftSendToken, setFtSendToken] = useState<TokenHolding | null>(null);
  const [ftSendBusy, setFtSendBusy] = useState(false);
  /** Sticky in-sheet error (mobile toasts flash / get covered by the modal). */
  const [ftSendError, setFtSendError] = useState<string | null>(null);
  const [ftSendDraft, setFtSendDraft] = useState<{
    to: string;
    amount: string;
  } | null>(null);
  const pendingFtResumeRef = useRef(false);
  const runSendFtRef = useRef<
    (args: {
      ledgerId: string;
      to: string;
      amount: string;
      skipReview?: boolean;
    }) => Promise<void>
  >(async () => {});
  const [sendNft, setSendNft] = useState<NftHolding | null>(null);
  const [nftSendBusy, setNftSendBusy] = useState(false);
  const [nftSelectMode, setNftSelectMode] = useState<null | "list" | "send">(
    null,
  );
  const [nftSelected, setNftSelected] = useState<Set<string>>(() => new Set());
  const [listPriceIcp, setListPriceIcp] = useState("1");
  const [listingBusy, setListingBusy] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [nftSort, setNftSort] = useState<NftSortKey>("tokenId");
  const [bulkSendTo, setBulkSendTo] = useState("");
  const [bulkFeeQuote, setBulkFeeQuote] = useState<NftBulkFeeQuote | null>(
    null,
  );
  const [bulkSendProgress, setBulkSendProgress] = useState<string | null>(null);
  /** NFT holdings scan running after tokens (does not block Tokens tab). */
  const [nftPrefetching, setNftPrefetching] = useState(false);
  const [refreshingNftGroup, setRefreshingNftGroup] = useState<string | null>(
    null,
  );
  const nftPrefetchGenRef = useRef(0);

  useEffect(() => {
    if (loading || ftSendBusy || nftSendBusy || listingBusy) {
      const label = ftSendBusy
        ? "Sending token…"
        : nftSendBusy
          ? "Sending NFT…"
          : listingBusy
            ? "Listing on Bazaar…"
            : status || "Working…";
      notify.setStatusBar({ label });
      return;
    }
    if (bulkSendProgress) {
      notify.setStatusBar({ label: bulkSendProgress });
      return;
    }
    if (nftPrefetching) {
      notify.setStatusBar({
        label: status || "Loading NFTs in background…",
      });
      return;
    }
    notify.setStatusBar(null);
  }, [
    loading,
    ftSendBusy,
    nftSendBusy,
    listingBusy,
    bulkSendProgress,
    nftPrefetching,
    status,
    notify,
  ]);

  const [ledgerCatalog, setLedgerCatalog] = useState<SeedLedger[]>(() =>
    listCachedOrSeedLedgers(),
  );
  const ledgerCatalogRef = useRef(ledgerCatalog);
  ledgerCatalogRef.current = ledgerCatalog;

  // Cycles
  const [cycleMode, setCycleMode] = useState<CycleMode>("topup");
  const [cycleCanister, setCycleCanister] = useState("");
  const [cycleIcp, setCycleIcp] = useState("1");
  const [cycleAmount, setCycleAmount] = useState("1t");
  const [cycleSendTo, setCycleSendTo] = useState("");
  const [cycleQuote, setCycleQuote] = useState<CycleOpQuote | null>(null);
  const [cyclesBalance, setCyclesBalance] = useState<bigint | null>(null);
  const [bookmarks, setBookmarks] = useState<CycleBookmark[]>(() =>
    typeof window !== "undefined" ? loadCycleBookmarks() : [],
  );
  const [bookmarkLabel, setBookmarkLabel] = useState("");
  const tokensRef = useRef<TokenHolding[]>([]);
  const nftsRef = useRef<NftHolding[]>([]);
  const nftApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nftPendingBatchRef = useRef<NftHolding[] | null>(null);
  const tokenPollBusyRef = useRef(false);
  const tokenPollTickRef = useRef(0);
  const skipInboundOnceRef = useRef(true);
  const skipNftInboundOnceRef = useRef(true);
  const [priceBook, setPriceBook] = useState<PriceBook | null>(null);

  const pid = identity ? principalText(identity) : "";
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    if (!pid) {
      setAccountId("");
      return;
    }
    let cancelled = false;
    void principalToAccountId(pid)
      .then((id) => {
        if (!cancelled) setAccountId(id);
      })
      .catch(() => {
        if (!cancelled) setAccountId("");
      });
    return () => {
      cancelled = true;
    };
  }, [pid]);

  const nftGroups = useGroupedNfts(nfts);
  const valuation = useMemo(
    () => valuePortfolio(tokens, priceBook),
    [tokens, priceBook],
  );
  const tokensSorted = useMemo(() => {
    return [...tokens].sort((a, b) => {
      const au = valuation.lines.get(a.ledgerId)?.usd;
      const bu = valuation.lines.get(b.ledgerId)?.usd;
      if (au != null && bu != null && au !== bu) return bu - au;
      if (au != null && bu == null) return -1;
      if (au == null && bu != null) return 1;
      if (a.balance === 0n && b.balance !== 0n) return 1;
      if (b.balance === 0n && a.balance !== 0n) return -1;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [tokens, valuation]);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    nftsRef.current = nfts;
  }, [nfts]);

  const refreshPrices = useCallback(async (force = false) => {
    try {
      const book = await loadPriceBook(force);
      setPriceBook(book);
    } catch {
      /* keep prior book */
    }
  }, []);

  useEffect(() => {
    void restoreIdentity().then((id) => {
      if (id) {
        setIdentity(id);
        setHostLinked(false);
      }
    });
    void warmTokenCatalog()
      .then((cat) => {
        setLedgerCatalog(cat);
        prefetchTokenLogos(cat.map((s) => s.id));
      })
      .catch(() => {
        /* seed fallback already in state */
        prefetchTokenLogos(SEED_ICRC1_LEDGERS.map((s) => s.id));
      });
    void refreshPrices(true);
    return () => {
      abortRef.current?.abort();
    };
  }, [refreshPrices]);

  /** After mobile II return: reopen send sheet and auto-resume confirmed FT once. */
  useEffect(() => {
    if (!identity || pendingFtResumeRef.current) return;
    const pending = loadPendingFtSend();
    if (!pending) return;
    pendingFtResumeRef.current = true;
    const catalog =
      ledgerCatalog.length > 0 ? ledgerCatalog : SEED_ICRC1_LEDGERS;
    const fromTokens = tokens.find((t) => t.ledgerId === pending.ledgerId);
    const spec = catalog.find((s) => s.id === pending.ledgerId);
    const tokenRow: TokenHolding =
      fromTokens ??
      ({
        ledgerId: pending.ledgerId,
        symbol: pending.symbol ?? spec?.symbol ?? "TOKEN",
        name: spec?.name ?? pending.ledgerId,
        decimals: spec?.decimals ?? 8,
        balance: 0n,
        balanceDisplay: "—",
        logoUrl: spec?.logoUrl ?? "",
        standards: spec?.standards ?? ["icrc1"],
      } as TokenHolding);
    setFtSendDraft({ to: pending.to, amount: pending.amount });
    setFtSendToken(tokenRow);
    if (pending.confirmed) {
      setFtSendError(null);
      notify.info(
        "Finishing send",
        "Completing your transfer after Internet Identity…",
      );
      // No effect cleanup — do not cancel if tokens/catalog refresh before 250ms.
      // Defer so AuthClient IndexedDB identity is ready after full-page return.
      window.setTimeout(() => {
        void runSendFtRef.current({
          ledgerId: pending.ledgerId,
          to: pending.to,
          amount: pending.amount,
          skipReview: true,
        });
      }, 250);
      return;
    }
    setFtSendError(
      "Internet Identity finished — tap Retry send to complete the transfer.",
    );
    notify.info(
      "Ready to finish send",
      "Tap Retry send in the sheet to complete your transfer.",
    );
    // Only gate on identity so catalog/token polls cannot cancel auto-resume.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [identity]);

  /** Bazaar / Hub iframe: inherit parent II via sub-delegation (no second popup). */
  useEffect(() => {
    if (!isEmbed) return;
    return installCanopyHostAuthSync(({ identity: hostId }) => {
      if (!hostId) {
        requestCanopyHostDelegation();
        return;
      }
      setIdentity((cur) => {
        // Prefer host signing identity when embed has no local session yet,
        // or when principals match (refresh chain).
        if (!cur) {
          setHostLinked(true);
          return hostId;
        }
        try {
          if (cur.getPrincipal().toText() === hostId.getPrincipal().toText()) {
            setHostLinked(true);
            return hostId;
          }
        } catch {
          /* keep local */
        }
        return cur;
      });
    });
  }, []);

  const refresh = useCallback(async (id: Identity) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError("");
    const owner = principalText(id);
    const prefetchGen = ++nftPrefetchGenRef.current;

    // Paint last snapshot immediately (display-only; live probes still run).
    const cachedTokens = loadTokenSnapshot(owner);
    const cachedNfts = loadNftSnapshot(owner);
    if (cachedTokens?.length) {
      skipInboundOnceRef.current = true;
      setTokens(cachedTokens);
    }
    if (cachedNfts?.length) {
      skipNftInboundOnceRef.current = true;
      setNfts(cachedNfts);
      prefetchNftMedia(cachedNfts, canopyNftPrefetchCap(36));
    }

    const hadCache = Boolean(cachedTokens?.length);
    setLoading(!hadCache);
    setStatus(hadCache ? "Updating tokens…" : "Loading tokens…");
    setNftPrefetching(false);

    try {
      // Don't block on TokenList network — seeds/cache first, warm in background.
      const cachedCatalog = ledgerCatalogRef.current;
      const catalog =
        cachedCatalog.length > 0
          ? cachedCatalog
          : listCachedOrSeedLedgers();
      void warmTokenCatalog()
        .then((c) => {
          if (!ac.signal.aborted) setLedgerCatalog(c);
        })
        .catch(() => {
          /* keep seeds */
        });

      const cyclesP = fetchCyclesLedgerBalance(owner)
        .then((cb) => {
          if (!ac.signal.aborted) setCyclesBalance(cb);
        })
        .catch(() => {
          if (!ac.signal.aborted) setCyclesBalance(null);
        });

      // Tokens first — keep the network free so the Tokens tab stays snappy.
      const t = await loadTokenHoldings(owner, [], catalog, {
        prioritizeLedgerIds: [
          ...(cachedTokens?.map((row) => row.ledgerId) ?? []),
          ...SEED_ICRC1_LEDGERS.map((s) => s.id),
        ],
        onPartial: (partial) => {
          if (ac.signal.aborted) return;
          skipInboundOnceRef.current = true;
          setTokens(partial);
          if (!hadCache && partial.length) setLoading(false);
        },
      });
      if (ac.signal.aborted) return;
      skipInboundOnceRef.current = true;
      setTokens(t);
      saveTokenSnapshot(owner, t);
      setLoading(false);
      void refreshPrices(true);
      await cyclesP;

      const cachedCount = cachedNfts?.length ?? 0;
      setStatus(
        cachedCount
          ? `${t.length} token ledger(s) · ${cachedCount} NFT(s) cached · refreshing NFTs…`
          : `${t.length} token ledger(s) · loading NFTs in background…`,
      );

      // After tokens paint: warm NFT holdings + art without blocking Tokens UX.
      const cancelIdle = afterUiIdle(() => {
        if (ac.signal.aborted || nftPrefetchGenRef.current !== prefetchGen) {
          return;
        }
        setNftPrefetching(true);

        const flushNfts = (batch: NftHolding[], force = false) => {
          if (ac.signal.aborted || nftPrefetchGenRef.current !== prefetchGen) {
            return;
          }
          // Progressive batches: union (keep fast-pass EXT while deep scan restarts).
          // Final flush: authoritative — drop sold / no-longer-held tokens.
          const prev = nftsRef.current;
          const merged = mergeNftHoldingsStable(prev, batch, {
            dropMissing: force,
          });
          // Skip no-op paints (same keys + same length).
          if (
            !force &&
            merged.length === prev.length &&
            merged.every(
              (n, i) =>
                nftKey(n) === nftKey(prev[i]!) &&
                n.imageUrl === prev[i]!.imageUrl,
            )
          ) {
            return;
          }

          if (force) {
            const inbound = skipNftInboundOnceRef.current
              ? []
              : diffNftInbounds(prev, merged, nftKey);
            skipNftInboundOnceRef.current = false;
            if (inbound.length) {
              const inboundMsg = formatNftInboundStatus(inbound);
              setStatus(inboundMsg);
              notify.success("NFT received", inboundMsg);
              setActivity(
                pushActivity({
                  kind: "nft_receive",
                  title:
                    inbound.length === 1
                      ? "Received NFT"
                      : `Received ${inbound.length} NFTs`,
                  detail: inboundMsg,
                }),
              );
            }
          }

          nftsRef.current = merged;
          setNfts(merged);
          saveNftSnapshot(owner, merged);
          prefetchNftMedia(merged, canopyNftPrefetchCap(48));
        };

        /** Progressive batches coalesce — loaded collections stay put between paints. */
        const applyNfts = (batch: NftHolding[], immediate = false) => {
          if (ac.signal.aborted || nftPrefetchGenRef.current !== prefetchGen) {
            return;
          }
          nftPendingBatchRef.current = batch;
          if (immediate) {
            if (nftApplyTimerRef.current) {
              clearTimeout(nftApplyTimerRef.current);
              nftApplyTimerRef.current = null;
            }
            flushNfts(batch, true);
            nftPendingBatchRef.current = null;
            return;
          }
          if (nftApplyTimerRef.current) return;
          nftApplyTimerRef.current = setTimeout(() => {
            nftApplyTimerRef.current = null;
            const pending = nftPendingBatchRef.current;
            nftPendingBatchRef.current = null;
            if (pending) flushNfts(pending);
          }, 1500);
        };

        void (async () => {
          try {
            // One progressive scan: indexes → ICRC-7 → EXT hot → warm → full.
            // (A second maxTier:2 pass used to re-scan hot/warm for minutes and
            // still capped out at 954/1279 collections.)
            const nAll = await loadNftHoldings(owner, {
              signal: ac.signal,
              // Standalone: full catalog. Hub embed: hot+warm only (faster).
              maxTier: isEmbed ? 1 : 2,
              onProgress: (msg) => {
                if (
                  !ac.signal.aborted &&
                  nftPrefetchGenRef.current === prefetchGen
                ) {
                  setStatus(msg);
                }
              },
              onBatch: (batch) => applyNfts(batch, false),
            });
            if (ac.signal.aborted || nftPrefetchGenRef.current !== prefetchGen) {
              return;
            }
            applyNfts(nAll, true);
            setStatus(
              `${t.length} token ledger(s) · ${nAll.length} NFT(s)`,
            );
            notify.info(
              "NFTs ready",
              `${nAll.length} NFT(s) · ${t.length} token ledger(s)`,
            );
          } catch (e) {
            if (
              ac.signal.aborted ||
              (e instanceof Error && e.name === "AbortError") ||
              nftPrefetchGenRef.current !== prefetchGen
            ) {
              return;
            }
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`NFT scan issue: ${msg}`);
            /* keep cached NFTs */
          } finally {
            if (nftApplyTimerRef.current) {
              clearTimeout(nftApplyTimerRef.current);
              nftApplyTimerRef.current = null;
            }
            const pending = nftPendingBatchRef.current;
            nftPendingBatchRef.current = null;
            if (
              pending &&
              nftPrefetchGenRef.current === prefetchGen &&
              !ac.signal.aborted
            ) {
              flushNfts(pending, true);
            }
            if (nftPrefetchGenRef.current === prefetchGen) {
              setNftPrefetching(false);
            }
          }
        })();
      }, 80);

      ac.signal.addEventListener(
        "abort",
        () => {
          cancelIdle();
          if (nftApplyTimerRef.current) {
            clearTimeout(nftApplyTimerRef.current);
            nftApplyTimerRef.current = null;
          }
          nftPendingBatchRef.current = null;
          if (nftPrefetchGenRef.current === prefetchGen) {
            setNftPrefetching(false);
          }
        },
        { once: true },
      );
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      notify.error("Holdings refresh failed", msg);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [refreshPrices, notify]);

  /** Rescan a single NFT collection group (EXT canister or Bazaar series). */
  const refreshNftCollection = useCallback(
    async (groupId: string, items: NftHolding[]) => {
      const sample = items[0];
      if (!sample || !identity) return;
      const owner = principalText(identity);
      setRefreshingNftGroup(groupId);
      try {
        const next = await rescanNftCollection(owner, sample.contractId, {
          standard: sample.standard,
          bazaarCollectionId: sample.bazaarCollectionId,
        });
        // Keep groupKey stable for multi-series shared ledgers.
        const stamped = next.map((n) =>
          n.groupKey === groupId ? n : { ...n, groupKey: groupId },
        );
        const merged = replaceNftGroup(nftsRef.current, groupId, stamped);
        nftsRef.current = merged;
        setNfts(merged);
        saveNftSnapshot(owner, merged);
        prefetchNftMedia(stamped, canopyNftPrefetchCap(24));
        notify.info(
          "Collection updated",
          `${sample.collectionName ?? "Collection"} · ${stamped.length} NFT(s)`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notify.error("Collection refresh failed", msg);
      } finally {
        setRefreshingNftGroup(null);
      }
    },
    [identity, notify],
  );

  /** Quiet token poll — auto-detect receives without NFT rescan / full spinner. */
  const refreshTokensQuiet = useCallback(
    async (id: Identity, mode: "known" | "full" = "known") => {
      if (tokenPollBusyRef.current || loading) return;
      tokenPollBusyRef.current = true;
      try {
        const owner = principalText(id);
        const prev = tokensRef.current;
        const prioritize = [
          ...prev.map((t) => t.ledgerId),
          ...SEED_ICRC1_LEDGERS.map((s) => s.id),
        ];
        const catalog =
          ledgerCatalog.length > 0 ? ledgerCatalog : listCachedOrSeedLedgers();
        const polled = await loadTokenHoldings(owner, [], catalog, {
          prioritizeLedgerIds: prioritize,
          knownOnly: mode === "known",
          maxProbe: mode === "known" ? 64 : 160,
        });
        const probedIds =
          mode === "known"
            ? [
                ...prioritize,
                ...SEED_ICRC1_LEDGERS.map((s) => s.id),
              ]
            : polled.map((t) => t.ledgerId);
        const next =
          mode === "known"
            ? mergeTokenHoldingsPoll(prev, polled, probedIds)
            : polled;
        const inbound = skipInboundOnceRef.current
          ? []
          : diffTokenInbounds(prev, next);
        skipInboundOnceRef.current = false;
        setTokens(next);
        saveTokenSnapshot(principalText(id), next);
        if (inbound.length) {
          const inboundMsg = formatInboundStatus(inbound);
          setStatus(inboundMsg);
          notify.success("Received", inboundMsg);
          setActivity(
            pushActivity({
              kind: "ft_receive",
              title:
                inbound.length === 1
                  ? `Received ${inbound[0]!.symbol}`
                  : "Received tokens",
              detail: inboundMsg,
            }),
          );
        }
        void refreshPrices(false);
        try {
          const cb = await fetchCyclesLedgerBalance(owner);
          setCyclesBalance(cb);
        } catch {
          /* keep prior cycles balance */
        }
      } catch {
        /* quiet poll failures stay quiet */
      } finally {
        tokenPollBusyRef.current = false;
      }
    },
    [ledgerCatalog, loading, refreshPrices, notify],
  );

  useEffect(() => {
    if (identity) void refresh(identity);
  }, [identity, refresh]);

  useEffect(() => {
    if (!identity) return;
    const id = identity;
    const dataSaver = isOsDataSaver();
    const POLL_MS = dataSaver ? 60_000 : 12_000;
    const FULL_EVERY = dataSaver ? 2 : 5; // ~60s / ~120s broad scan
    const PRICE_MS = dataSaver ? 90_000 : 30_000;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      tokenPollTickRef.current += 1;
      const mode =
        tokenPollTickRef.current % FULL_EVERY === 0 ? "full" : "known";
      void refreshTokensQuiet(id, mode);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshTokensQuiet(id, "known");
        void refreshPrices(true);
      }
    };
    const onFocus = () => {
      void refreshTokensQuiet(id, "known");
      void refreshPrices(false);
    };

    const timer = window.setInterval(tick, POLL_MS);
    const priceTimer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refreshPrices(true);
    }, PRICE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(priceTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [identity, refreshTokensQuiet, refreshPrices]);

  const identityRef = useRef(identity);
  identityRef.current = identity;

  const onLogin = async () => {
    setError("");
    try {
      if (isEmbed) {
        setStatus("Syncing Internet Identity from host…");
        requestCanopyHostDelegation();
        await new Promise((r) => setTimeout(r, 2500));
        if (
          identityRef.current &&
          !identityRef.current.getPrincipal().isAnonymous()
        ) {
          setStatus("");
          return;
        }
        // Passkeys fail inside iframes ("Unable to connect"). Prefer host
        // sub-delegation; only break out to ?auth=ii if the host never answers.
        setStatus(
          "Waiting for Account session… If this stalls, use Connect Canopy above first.",
        );
        for (let i = 0; i < 8; i++) {
          requestCanopyHostDelegation();
          await new Promise((r) => setTimeout(r, 750));
          if (
            identityRef.current &&
            !identityRef.current.getPrincipal().isAnonymous()
          ) {
            setStatus("");
            return;
          }
        }
        setStatus(
          "Opening Canopy sign-in in a new tab… Finish there, then return here.",
        );
        beginCanopyAuthRedirect({ newTab: true });
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const id = await restoreIdentity();
          if (id && !id.getPrincipal().isAnonymous()) {
            setHostLinked(false);
            setIdentity(id);
            setStatus("");
            return;
          }
        }
        setError(
          "Sign-in timed out. Connect Canopy on this page first (same PID), then tap Sync again — or finish Internet Identity in the Canopy tab.",
        );
        setStatus("");
        return;
      }

      if (preferCanopyAuthRedirect()) {
        setStatus("Opening Internet Identity…");
        beginCanopyAuthRedirect();
        return;
      }

      const result = await loginWithIiOrRedirect();
      if (result === "redirected") {
        setStatus(
          "Complete Internet Identity in the sign-in page, then return here.",
        );
        return;
      }
      setHostLinked(false);
      setIdentity(result);
      setStatus("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    }
  };

  const onLogout = async () => {
    abortRef.current?.abort();
    if (!hostLinked) {
      await logoutIi();
    }
    setHostLinked(false);
    setIdentity(null);
    setTokens([]);
    setNfts([]);
    skipInboundOnceRef.current = true;
    skipNftInboundOnceRef.current = true;
    tokenPollTickRef.current = 0;
  };

  const runSendFt = async (args: {
    ledgerId: string;
    to: string;
    amount: string;
    /** Skip SpendReview when resuming after mobile II (already confirmed). */
    skipReview?: boolean;
  }) => {
    if (!identity) return;
    setError("");
    setFtSendError(null);
    const catalog =
      ledgerCatalog.length > 0 ? ledgerCatalog : SEED_ICRC1_LEDGERS;
    const spec = catalog.find((s) => s.id === args.ledgerId);
    const tokenRow = tokens.find((t) => t.ledgerId === args.ledgerId);
    const decimals = tokenRow?.decimals ?? spec?.decimals ?? 8;
    const sym = tokenRow?.symbol ?? spec?.symbol ?? "TOKEN";
    const raw = args.amount.trim();
    const dest = args.to.trim();
    if (!raw || !dest) {
      const msg = "Destination and amount required";
      setError(msg);
      setFtSendError(msg);
      return;
    }
    const amount = parseTokenAmount(raw, decimals);
    if (amount == null) {
      const msg = `Enter an amount with at most ${decimals} decimal places`;
      setError(msg);
      setFtSendError(msg);
      return;
    }
    if (amount <= 0n) {
      const msg = "Amount must be greater than zero";
      setError(msg);
      setFtSendError(msg);
      return;
    }
    const parsedDest = parseDestination(dest);
    if (!parsedDest.ok) {
      setError(parsedDest.error);
      setFtSendError(parsedDest.error);
      return;
    }
    if (parsedDest.kind === "accountId" && args.ledgerId !== ICP_LEDGER) {
      const msg =
        "Account ID destinations are only supported for ICP. Paste a principal for other tokens.";
      setError(msg);
      setFtSendError(msg);
      return;
    }

    setFtSendDraft({ to: parsedDest.value, amount: raw });

    if (!args.skipReview) {
      const fee = await quoteFtSendFee(amount);
      const unverified = isUnverifiedLedger(args.ledgerId);
      const ok = await requestSpendReview({
        title: `Send ${sym}`,
        fields: [
          { label: "Amount", value: `${raw} ${sym}` },
          {
            label: "Recipient receives",
            value: `${formatToken(amount > fee.feeAmount ? amount - fee.feeAmount : 0n, decimals)} ${sym}`,
          },
          { label: "Ledger", value: args.ledgerId, mono: true },
          {
            label: `To (${parsedDest.label})`,
            value: parsedDest.value,
            mono: true,
          },
          {
            label: "Canopy fee",
            value: `${formatToken(fee.feeAmount, decimals)} ${sym} (${fee.bps.toString()} bps)`,
          },
          { label: "Fee treasury", value: fee.treasury, mono: true },
          { label: "Signer", value: "Internet Identity" },
        ],
        risks: [
          "Fee is paid first; if the send fails afterward, the micro-fee is not refunded.",
          ...(parsedDest.kind === "accountId"
            ? [
                "Account ID uses send_dfx. Confirm the hex matches the exchange deposit address.",
              ]
            : []),
          ...(unverified
            ? ["This ledger was added manually in Manage — treat as unverified."]
            : []),
          ...(preferCanopyAuthRedirect()
            ? [
                "On mobile, Internet Identity may open a full-page sign-in. After you return, Canopy finishes the send automatically.",
              ]
            : []),
        ],
        requireUnverifiedAck: unverified,
        confirmLabel: "Confirm FT send",
      });
      if (!ok) {
        clearPendingFtSend();
        return;
      }
    }

    // Persist after confirm so mobile II redirect can resume without a second review.
    savePendingFtSend({
      ledgerId: args.ledgerId,
      to: parsedDest.value,
      amount: raw,
      symbol: sym,
      confirmed: true,
    });

    setFtSendBusy(true);
    setLoading(true);
    try {
      let id = await ensureStepUpIfNeeded({
        amount,
        decimals,
        isIcpLedger: args.ledgerId === ICP_LEDGER,
      });
      setIdentity(id);

      const runOnce = () =>
        executeFtSend({
          identity: id,
          ledgerId: args.ledgerId,
          to: parsedDest.value,
          amount,
          payFee: true,
        });

      let r: Awaited<ReturnType<typeof executeFtSend>>;
      try {
        r = await runOnce();
      } catch (first) {
        const firstMsg =
          first instanceof Error ? first.message : String(first);
        if (firstMsg.includes("CANOPY_II_REDIRECT")) {
          setFtSendError(
            "Finish Internet Identity in the sign-in page — Canopy will complete the send when you return.",
          );
          notify.info(
            "Sign in to continue",
            "After Internet Identity, return to Canopy — send finishes automatically.",
          );
          return;
        }
        // One forced II refresh if session died before any fee leg — never
        // auto-retry when micro-fee may already have moved (no double fee).
        const canRetryAuth =
          /session expired|invalid signature|invalid basic signature|not authenticated/i.test(
            firstMsg,
          ) && !/micro-fee may already have been paid/i.test(firstMsg);
        if (!canRetryAuth) throw first;
        id = await ensureStepUpIfNeeded({
          amount,
          decimals,
          isIcpLedger: args.ledgerId === ICP_LEDGER,
          force: true,
        });
        setIdentity(id);
        r = await runOnce();
      }

      clearPendingFtSend();
      setFtSendDraft(null);
      setFtSendError(null);
      rememberRecipient({
        value: parsedDest.value,
        kind: parsedDest.kind,
        label: sym,
      });
      const blockStr = r.block.toString();
      setActivity(
        pushActivity({
          kind: "ft_send",
          title: `Sent ${sym}`,
          detail: `${raw} → ${parsedDest.value.slice(0, 12)}… · block ${blockStr}`,
          block: blockStr,
          href:
            args.ledgerId === ICP_LEDGER
              ? icpTxExplorerUrl(blockStr)
              : undefined,
        }),
      );
      setStatus(
        `Sent. Block ${blockStr}${r.feeBlock ? ` · fee ${r.feeBlock}` : ""}`,
      );
      notify.success(
        `Sent ${sym}`,
        `Block ${blockStr}${r.feeBlock ? ` · fee ${r.feeBlock}` : ""}`,
      );
      setFtSendToken(null);
      await refresh(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("CANOPY_II_REDIRECT")) {
        setFtSendError(
          "Finish Internet Identity in the sign-in page — Canopy will complete the send when you return.",
        );
        notify.info(
          "Sign in to continue",
          "After Internet Identity, return to Canopy — send finishes automatically.",
        );
        return;
      }
      setError(msg);
      setFtSendError(msg);
      notify.error("Token send failed", msg);
    } finally {
      setFtSendBusy(false);
      setLoading(false);
    }
  };
  runSendFtRef.current = runSendFt;

  const runSendNft = async (destRaw: string) => {
    if (!identity || !sendNft) return;
    const parsedDest = parseDestination(destRaw);
    if (!parsedDest.ok) {
      setError(parsedDest.error);
      return;
    }
    if (parsedDest.kind !== "principal") {
      setError("NFT sends require a principal destination");
      return;
    }
    const dest = parsedDest.value;
    const fee = await quoteNftSendFeeE8s();
    const unverified = isUnverifiedNftCollection(sendNft.contractId);
    const isExt =
      sendNft.standard === "ext" || sendNft.standard === "index";
    const isIcrc7 = sendNft.standard === "icrc7";
    if (!isExt && !isIcrc7) {
      setError("Send supports ICRC-7 and EXT collections only.");
      return;
    }
    const ok = await requestSpendReview({
      title: `Send NFT (${sendNft.standard.toUpperCase()})`,
      fields: [
        { label: "NFT", value: sendNft.name },
        { label: "Collection", value: sendNft.contractId, mono: true },
        { label: "Token id", value: String(sendNft.tokenId), mono: true },
        { label: "To", value: dest, mono: true },
        {
          label: "Canopy fee",
          value: `${formatToken(fee.feeE8s, 8)} ICP`,
        },
        { label: "Fee treasury", value: fee.treasury, mono: true },
      ],
      risks: [
        ...NFT_FOREIGN_WALLET_RISKS,
        ...(unverified
          ? ["This collection was added manually in Manage — unverified."]
          : []),
        ...(sendNft.standard === "index"
          ? [
              "This NFT was indexed as legacy EXT-era — transfer uses the EXT path.",
            ]
          : []),
      ],
      requireUnverifiedAck: unverified,
      requireExtraAck: NFT_FOREIGN_WALLET_ACK,
      confirmLabel: "Confirm NFT send",
    });
    if (!ok) return;

    setNftSendBusy(true);
    setLoading(true);
    setError("");
    try {
      const id = await ensureStepUpIfNeeded({
        amount: fee.feeE8s,
        decimals: 8,
        isIcpLedger: true,
      });
      setIdentity(id);
      const r = isIcrc7
        ? await executeIcrc7Send({
            identity: id,
            ledgerId: sendNft.contractId,
            tokenId: BigInt(sendNft.tokenId),
            to: dest,
            payFee: true,
          })
        : await executeExtSend({
            identity: id,
            canisterId: sendNft.contractId,
            tokenIdentifier: String(sendNft.tokenId),
            to: dest,
            payFee: true,
          });
      if (!r.ok) {
        throw new Error(
          r.detail +
            (r.feeBlock
              ? ` (fee already paid · block ${r.feeBlock.toString()})`
              : ""),
        );
      }
      setStatus(r.detail);
      notify.success("NFT sent", r.detail);
      rememberRecipient({ value: dest, kind: "principal", label: "NFT" });
      setActivity(
        pushActivity({
          kind: "nft_send",
          title: `Sent NFT · ${sendNft.name}`,
          detail: r.detail,
        }),
      );
      setSendNft(null);
      await refresh(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      notify.error("NFT send failed", msg);
    } finally {
      setNftSendBusy(false);
      setLoading(false);
    }
  };

  const toggleNftSelect = useCallback((n: NftHolding) => {
    setNftSelected((prev) => toggleKey(prev, nftKey(n)));
  }, []);

  const toggleSelectCollection = useCallback((items: NftHolding[]) => {
    setNftSelected((prev) => toggleSelectAllForItems(prev, items));
  }, []);

  const selectAllWalletExperimental = useCallback(() => {
    const count = nfts.length;
    if (count === 0) return;
    const ok = window.confirm(
      [
        "EXPERIMENTAL — Select all NFTs in this wallet?",
        "",
        `This will select ${count} NFT${count === 1 ? "" : "s"} across every collection.`,
        `Bulk send is capped at ${NFT_BULK_SEND_UI_CAP} per batch; fees are paid first and not refunded if a transfer fails.`,
        "",
        "Use at your own risk. Continue?",
      ].join("\n"),
    );
    if (!ok) return;
    setNftSelected(selectAllForItems(nfts));
  }, [nfts]);

  const listableSelected = useMemo(
    () => nfts.filter((n) => nftSelected.has(nftKey(n)) && isBazaarListable(n)),
    [nfts, nftSelected],
  );

  const sendableSelected = useMemo(
    () =>
      nfts.filter(
        (n) =>
          nftSelected.has(nftKey(n)) &&
          (n.standard === "icrc7" ||
            n.standard === "ext" ||
            n.standard === "index"),
      ),
    [nfts, nftSelected],
  );

  useEffect(() => {
    if (nftSelectMode !== "send" || sendableSelected.length === 0) {
      setBulkFeeQuote(null);
      return;
    }
    let cancelled = false;
    void quoteNftSendBulkFee(sendableSelected.length).then((q) => {
      if (!cancelled) setBulkFeeQuote(q);
    });
    return () => {
      cancelled = true;
    };
  }, [nftSelectMode, sendableSelected.length]);

  const enterNftMode = useCallback((mode: "list" | "send") => {
    setNftSelectMode((cur) => {
      if (cur === mode) {
        setNftSelected(new Set());
        return null;
      }
      setNftSelected(new Set());
      return mode;
    });
    setBulkSendProgress(null);
  }, []);

  const runBulkSendNfts = async () => {
    if (!identity) return;
    const parsedDest = parseDestination(bulkSendTo);
    if (!parsedDest.ok) {
      setError(parsedDest.error);
      return;
    }
    if (parsedDest.kind !== "principal") {
      setError("NFT sends require a principal destination");
      return;
    }
    const dest = parsedDest.value;
    const targets = sendableSelected.slice(0, NFT_BULK_SEND_UI_CAP);
    if (!targets.length) {
      setError("Select ICRC-7 or EXT NFTs to send.");
      return;
    }
    if (sendableSelected.length > NFT_BULK_SEND_UI_CAP) {
      setError(
        `Bulk send is capped at ${NFT_BULK_SEND_UI_CAP} NFTs per batch for approval UX.`,
      );
      return;
    }
    const fee = await quoteNftSendBulkFee(targets.length);
    const unverifiedCount = targets.filter((n) =>
      isUnverifiedNftCollection(n.contractId),
    ).length;
    const saved =
      fee.subtotalE8s > fee.feeE8s ? fee.subtotalE8s - fee.feeE8s : 0n;
    const ok = await requestSpendReview({
      title: `Bulk send ${targets.length} NFT${targets.length === 1 ? "" : "s"}`,
      fields: [
        {
          label: "Items",
          value:
            targets
              .slice(0, 6)
              .map((n) => n.name)
              .join(", ") +
            (targets.length > 6 ? ` · +${targets.length - 6} more` : ""),
        },
        { label: "To", value: dest, mono: true },
        {
          label: "Unit fee",
          value: `${formatToken(fee.unitFeeE8s, 8)} ICP × ${targets.length}`,
        },
        {
          label: "Stacked subtotal",
          value: `${formatToken(fee.subtotalE8s, 8)} ICP`,
        },
        {
          label: "Bulk discount",
          value:
            fee.discountBps > 0
              ? `${(fee.discountBps / 100).toFixed(0)}% (−${formatToken(fee.discountE8s, 8)} ICP)`
              : "None (single-item rate)",
        },
        {
          label: "You pay",
          value: `${formatToken(fee.feeE8s, 8)} ICP${saved > 0n ? ` · saved ${formatToken(saved, 8)}` : ""}`,
        },
        { label: "Fee treasury", value: fee.treasury, mono: true },
      ],
      risks: [
        ...NFT_FOREIGN_WALLET_RISKS,
        "One ICP fee is paid first for the whole batch; failed transfers are not refunded.",
        "Only ICRC-7 and EXT (incl. indexed legacy) collections transfer from Canopy.",
        ...(unverifiedCount
          ? [`${unverifiedCount} selected collection(s) are unverified (Manage).`]
          : []),
      ],
      requireUnverifiedAck: unverifiedCount > 0,
      requireExtraAck: NFT_FOREIGN_WALLET_ACK,
      confirmLabel: `Confirm bulk send (${targets.length})`,
    });
    if (!ok) return;

    setLoading(true);
    setError("");
    setBulkSendProgress("Preparing…");
    try {
      const id = await ensureStepUpIfNeeded({
        amount: fee.feeE8s,
        decimals: 8,
        isIcpLedger: true,
      });
      setIdentity(id);
      const result = await executeBulkNftSend({
        identity: id,
        to: dest,
        items: targets.map((n) => ({
          key: nftKey(n),
          name: n.name,
          contractId: n.contractId,
          tokenId: n.tokenId,
          standard: n.standard === "icrc7" ? "icrc7" : ("ext" as const),
        })),
        onProgress: (p) => {
          if (p.phase === "fee") {
            setBulkSendProgress(p.detail ?? "Paying bulk fee…");
          } else if (p.phase === "transfer" || p.phase === "item-ok" || p.phase === "item-err") {
            setBulkSendProgress(
              `${p.index}/${p.total} · ${p.item.name}${p.detail ? ` — ${p.detail}` : ""}`,
            );
          } else if (p.phase === "done") {
            setBulkSendProgress(p.detail ?? "Done");
          }
        },
      });
      const failNote = result.failed.length
        ? ` · ${result.failed.length} failed`
        : "";
      setStatus(
        `Bulk sent ${result.ok.length}/${targets.length}${failNote} · fee ${formatToken(result.feeE8s, 8)} ICP (${result.discountBps / 100}% off)${result.feeBlock ? ` · block ${result.feeBlock}` : ""}`,
      );
      if (result.failed.length) {
        const failMsg = result.failed
          .slice(0, 3)
          .map((f) => f.detail)
          .join(" · ");
        setError(failMsg);
        notify.error(
          `Bulk send: ${result.ok.length} ok, ${result.failed.length} failed`,
          failMsg,
        );
      } else {
        notify.success(
          `Bulk sent ${result.ok.length} NFT(s)`,
          `Fee ${formatToken(result.feeE8s, 8)} ICP`,
        );
      }
      rememberRecipient({ value: dest, kind: "principal", label: "NFT bulk" });
      setActivity(
        pushActivity({
          kind: "nft_bulk",
          title: `Bulk sent ${result.ok.length} NFT${result.ok.length === 1 ? "" : "s"}`,
          detail: `→ ${dest.slice(0, 12)}… · fee ${formatToken(result.feeE8s, 8)} ICP${result.feeBlock ? ` · block ${result.feeBlock}` : ""}${failNote}`,
          block: result.feeBlock ? String(result.feeBlock) : undefined,
          href: result.feeBlock
            ? icpTxExplorerUrl(result.feeBlock)
            : undefined,
        }),
      );
      setNftSelected(new Set());
      setNftSelectMode(null);
      await refresh(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      notify.error("Bulk send failed", msg);
    } finally {
      setLoading(false);
      setBulkSendProgress(null);
    }
  };

  const runListBazaarNfts = async (targets: NftHolding[]) => {
    if (!identity) {
      setError("Sign in with Internet Identity to list.");
      return;
    }
    const listable = targets.filter(isBazaarListable);
    if (!listable.length) {
      setError(
        "Select Bazaar Market–compliant NFTs (with a registry collection id).",
      );
      return;
    }
    let priceE8s: bigint;
    try {
      priceE8s = icpToE8s(listPriceIcp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const ok = await requestSpendReview({
      title:
        listable.length === 1
          ? "List NFT on Bazaar Market"
          : `Bulk list ${listable.length} NFTs on Bazaar`,
      fields: [
        {
          label: "Items",
          value: listable.map((n) => n.name).slice(0, 8).join(", ") +
            (listable.length > 8 ? ` (+${listable.length - 8})` : ""),
        },
        { label: "Price each", value: `${listPriceIcp.trim()} ICP` },
        {
          label: "Note",
          value: "Buyers purchase on the Bazaar Market page — not in Canopy.",
        },
      ],
      risks: [
        "Creates marketplace listings signed by your Internet Identity.",
        "Approves the Bazaar marketplace as ICRC-37 spender for each token.",
        "Does not move ICP. Cancel listings from Bazaar vault if needed.",
      ],
      confirmLabel: listable.length === 1 ? "Confirm listing" : "Confirm bulk list",
    });
    if (!ok) return;

    setListingBusy(true);
    setError("");
    let okCount = 0;
    try {
      for (const n of listable) {
        const collectionIdText = await resolveBazaarCollectionId(n);
        if (!collectionIdText) {
          throw new Error(
            `No Bazaar collection id for ${n.name} (${n.contractId})`,
          );
        }
        const collectionId = BigInt(collectionIdText);
        setStatus(`Listing ${n.name}…`);
        await listBazaarNftFromCanopy({
          identity,
          collectionId,
          tokenId: BigInt(n.tokenId),
          priceE8s,
          ledgerCanisterId: n.contractId,
          onProgress: (m) => setStatus(m),
        });
        okCount++;
      }
      setStatus(
        `Listed ${okCount} NFT(s) on Bazaar Market at ${listPriceIcp.trim()} ICP each.`,
      );
      notify.success(
        `Listed ${okCount} NFT(s)`,
        `${listPriceIcp.trim()} ICP each on Bazaar Market`,
      );
      setActivity(
        pushActivity({
          kind: "list",
          title:
            okCount === 1
              ? "Listed NFT on Bazaar"
              : `Listed ${okCount} NFTs on Bazaar`,
          detail: `${listPriceIcp.trim()} ICP each · ${listable
            .slice(0, 3)
            .map((n) => n.name)
            .join(", ")}${listable.length > 3 ? "…" : ""}`,
          href: BAZAAR_MARKET_URL,
        }),
      );
      setNftSelected(new Set());
      setNftSelectMode(null);
    } catch (e) {
      const msg = okCount
        ? `Listed ${okCount}, then failed: ${e instanceof Error ? e.message : String(e)}`
        : e instanceof Error
          ? e.message
          : String(e);
      setError(msg);
      notify.error("Listing failed", msg);
    } finally {
      setListingBusy(false);
    }
  };

  const runCycleQuote = async () => {
    setError("");
    const icpE8s = parseIcpToE8s(cycleIcp);
    if (icpE8s <= 0n && (cycleMode === "topup" || cycleMode === "mint")) {
      setError("Enter an ICP amount");
      return;
    }
    setLoading(true);
    try {
      if (cycleMode === "topup" || cycleMode === "mint") {
        const q = await quoteCycleOp(icpE8s);
        setCycleQuote(q);
        setStatus(
          `Est. ${formatCycles(q.estimatedCycles)} cycles · Canopy ${q.bps.toString()} bps = ${formatToken(q.marginE8s, 8)} ICP · net ${formatToken(q.netIcpE8s, 8)} ICP → CMC`,
        );
      } else {
        setCycleQuote(null);
        setStatus(
          cycleMode === "withdraw"
            ? `Withdraw ${formatCycles(parseCyclesAmount(cycleAmount))} to canister (from cycles ledger)`
            : cycleMode === "send"
              ? `Send ${formatCycles(parseCyclesAmount(cycleAmount))} cycles on ledger`
              : `Create canister with ${formatCycles(parseCyclesAmount(cycleAmount))} from ledger`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const runCycleExecute = async () => {
    if (!identity) return;
    const icpE8s =
      cycleMode === "topup" || cycleMode === "mint"
        ? parseIcpToE8s(cycleIcp)
        : 0n;
    const cycleAmt =
      cycleMode === "withdraw" ||
      cycleMode === "send" ||
      cycleMode === "create"
        ? parseCyclesAmount(cycleAmount)
        : 0n;

    if (cycleMode === "topup") {
      if (!cycleCanister.trim()) {
        setError("Canister id required");
        return;
      }
      const q = await quoteCycleOp(icpE8s);
      const ok = await requestSpendReview({
        title: "Cycle top-up (CMC)",
        fields: [
          { label: "Target canister", value: cycleCanister.trim(), mono: true },
          { label: "Gross ICP", value: formatToken(icpE8s, 8) },
          {
            label: "Canopy fee",
            value: `${formatToken(q.marginE8s, 8)} ICP (${q.bps.toString()} bps)`,
          },
          { label: "Fee treasury", value: q.treasury, mono: true },
          { label: "Net to CMC", value: formatToken(q.netIcpE8s, 8) },
          { label: "Est. cycles", value: formatCycles(q.estimatedCycles) },
        ],
        risks: ["Fee is paid first; if CMC notify fails, recover via NNS/CMC tools."],
        confirmLabel: "Confirm top-up",
      });
      if (!ok) return;
    } else if (cycleMode === "mint") {
      const q = await quoteCycleOp(icpE8s);
      const ok = await requestSpendReview({
        title: "Mint cycles to wallet",
        fields: [
          { label: "Gross ICP", value: formatToken(icpE8s, 8) },
          {
            label: "Canopy fee",
            value: `${formatToken(q.marginE8s, 8)} ICP (${q.bps.toString()} bps)`,
          },
          { label: "Fee treasury", value: q.treasury, mono: true },
          { label: "Net to CMC", value: formatToken(q.netIcpE8s, 8) },
          { label: "Est. cycles", value: formatCycles(q.estimatedCycles) },
        ],
        risks: ["Fee paid first before CMC mint."],
        confirmLabel: "Confirm mint",
      });
      if (!ok) return;
    } else if (cycleMode === "withdraw") {
      if (!cycleCanister.trim()) {
        setError("Canister id required");
        return;
      }
      const ok = await requestSpendReview({
        title: "Withdraw cycles to canister",
        fields: [
          { label: "Amount", value: formatCycles(cycleAmt) },
          { label: "To canister", value: cycleCanister.trim(), mono: true },
        ],
        confirmLabel: "Confirm withdraw",
      });
      if (!ok) return;
    } else if (cycleMode === "send") {
      if (!cycleSendTo.trim()) {
        setError("Destination principal required");
        return;
      }
      const ok = await requestSpendReview({
        title: "Send cycles (ledger)",
        fields: [
          { label: "Amount", value: formatCycles(cycleAmt) },
          { label: "To", value: cycleSendTo.trim(), mono: true },
        ],
        confirmLabel: "Confirm send",
      });
      if (!ok) return;
    } else if (cycleMode === "create") {
      const ok = await requestSpendReview({
        title: "Create canister from cycles",
        fields: [{ label: "Amount", value: formatCycles(cycleAmt) }],
        confirmLabel: "Confirm create",
      });
      if (!ok) return;
    }

    setLoading(true);
    setError("");
    try {
      const id = await ensureStepUpIfNeeded({
        amount: icpE8s > 0n ? icpE8s : undefined,
        decimals: 8,
        isIcpLedger: icpE8s > 0n,
        force: cycleMode === "create",
      });
      setIdentity(id);
      if (cycleMode === "topup") {
        const r = await topUpCanisterInHouse({
          identity: id,
          canisterId: cycleCanister.trim(),
          icpE8s,
        });
        const msg = `Topped up ${cycleCanister.trim()} with ${formatCycles(r.cycles)} · Canopy fee ${formatToken(r.feeE8s, 8)} ICP`;
        setStatus(msg);
        notify.success("Canister topped up", msg);
        setActivity(
          pushActivity({
            kind: "cycles",
            title: "Cycles top-up",
            detail: msg,
          }),
        );
        setBookmarks(addCycleBookmark(cycleCanister.trim(), bookmarkLabel));
      } else if (cycleMode === "mint") {
        const r = await mintCyclesToWallet({
          identity: id,
          icpE8s,
        });
        const msg = `Minted ${formatCycles(r.cycles)} to cycles ledger · Canopy fee ${formatToken(r.feeE8s, 8)} ICP`;
        setStatus(msg);
        notify.success("Cycles minted", msg);
        setActivity(
          pushActivity({
            kind: "cycles",
            title: "Minted cycles",
            detail: msg,
          }),
        );
      } else if (cycleMode === "withdraw") {
        const block = await withdrawCyclesToCanister({
          identity: id,
          canisterId: cycleCanister.trim(),
          amount: cycleAmt,
        });
        const msg = `Withdrew ${formatCycles(cycleAmt)} to ${cycleCanister.trim()} · block ${block}`;
        setStatus(msg);
        notify.success("Cycles withdrawn", msg);
        setActivity(
          pushActivity({
            kind: "cycles",
            title: "Withdrew cycles",
            detail: msg,
            block: String(block),
          }),
        );
        setBookmarks(addCycleBookmark(cycleCanister.trim(), bookmarkLabel));
      } else if (cycleMode === "send") {
        const block = await sendCyclesLedger({
          identity: id,
          to: cycleSendTo.trim(),
          amount: cycleAmt,
        });
        const msg = `Sent ${formatCycles(cycleAmt)} cycles · block ${block}`;
        setStatus(msg);
        notify.success("Cycles sent", msg);
        setActivity(
          pushActivity({
            kind: "cycles",
            title: "Sent cycles",
            detail: msg,
            block: String(block),
          }),
        );
      } else {
        const r = await createCanisterFromCycles({
          identity: id,
          amount: cycleAmt,
        });
        const msg = `Created canister ${r.canisterId} · ${formatCycles(cycleAmt)}`;
        setStatus(msg);
        notify.success("Canister created", msg);
        setActivity(
          pushActivity({
            kind: "cycles",
            title: "Created canister",
            detail: msg,
          }),
        );
        setCycleCanister(r.canisterId);
        setBookmarks(addCycleBookmark(r.canisterId, bookmarkLabel || "new"));
      }
      const bal = await fetchCyclesLedgerBalance(principalText(id));
      setCyclesBalance(bal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      notify.error("Cycles operation failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const tagline = isEmbed
    ? "Non-custodial Bonsai OS wallet — same II as Hub & Bazaar."
    : "Hold the grove. Non-custodial Bonsai OS wallet — ICP tokens & NFTs with direct art URLs. Same II principal as Hub & Bazaar.";
  const skipHolo = isEmbed || isOsDataSaver();

  return (
    <>
      <CanopyAtmosphere variant={isEmbed ? "embed" : "standalone"} />
      {!skipHolo ? (
        <Suspense fallback={null}>
          <CanopyHoloScene
            mode="background"
            tab={tab}
            embed={false}
          />
        </Suspense>
      ) : null}
      <div className={`app ${isEmbed ? "embed" : ""}${identity ? " app--authed" : ""}`}>
        {identity ? (
          <>
            <CanopyChrome
              principal={pid}
              accountId={accountId}
              valuation={valuation}
              loading={loading}
              onReceive={() => setReceiveOpen(true)}
              onRefresh={() => void refresh(identity)}
              onLogout={() => void onLogout()}
            />
            <ReceiveSheet
              principal={pid}
              open={receiveOpen}
              onClose={() => {
                setReceiveOpen(false);
                void refreshTokensQuiet(identity, "known");
              }}
            />
          </>
        ) : (
          <header className="brand">
            <div className="brand-lockup">
              <img
                className="brand-mark"
                src="/brand/canopy-mark.png"
                alt=""
                width={52}
                height={52}
              />
              <div>
                <p className="brand-eyebrow">Bonsai OS</p>
                <h1>Canopy</h1>
                <p className="tag">{tagline}</p>
              </div>
            </div>
          </header>
        )}

        {!identity ? (
          <section className="glass-panel auth-gate">
            <h2>Enter the grove</h2>
            <p>
              {isEmbed
                ? "Syncing with your Bazaar / Hub Internet Identity — same principal, no second popup when the host is signed in."
                : "Sign in with Internet Identity to view holdings and send tokens or NFTs — non-custodial, same principal as the Hub. Swap via ICPSwap/Kong; Cycles under Labs."}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onLogin()}
            >
              {isEmbed
                ? "Sync Internet Identity"
                : "Sign in with Internet Identity"}
            </button>
          </section>
        ) : null}

        {identity && !skipHolo ? (
          <div className="holo-stage glass-panel" aria-hidden>
            <Suspense fallback={<div className="muted">Loading holo…</div>}>
              <CanopyHoloScene mode="stage" tab={tab} embed={false} />
            </Suspense>
            <div className="holo-stage__caption muted">
              Holo · {tab}
            </div>
          </div>
        ) : null}

        {status ? (
          <p
            className={`muted status-line${status.startsWith("Received") ? " status-line--inbound" : ""}`}
            role="status"
          >
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="err status-line" role="alert">
            {error}
          </p>
        ) : null}

        <nav className="tabs" aria-label="Wallet sections">
          {(
            [
              ["tokens", "Tokens"],
              ["nfts", "NFTs"],
              ...(labsEnabled ? ([["cycles", "Cycles"]] as const) : []),
              ["manage", "Manage"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => selectTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {identity ? (
          <ActivityStrip
            entries={activity}
            onClear={() => {
              clearActivity();
              setActivity([]);
            }}
            onAppsChanged={({ action, name, origin }) => {
              setActivity(
                pushActivity({
                  kind: action === "disconnect" ? "disconnect" : "connect",
                  title:
                    action === "disconnect"
                      ? `Disconnected ${name}`
                      : `Allowed sync · ${name}`,
                  detail: origin,
                }),
              );
            }}
          />
        ) : null}

        {tab === "tokens" && (
          <section className="panel glass-panel tokens-panel">
            <div className="panel-head">
              <div>
                <h2>Tokens</h2>
                <p className="muted panel-lead">
                  ICRC-1 / ICRC-2 balances from seed + ICPSwap TokenList
                  discovery. Tap a token to send — destination accepts a
                  principal or ICP Account ID. Micro-fee is a % of the same
                  token → treasury.
                </p>
                {identity ? (
                  <div className="token-dex-links">
                    <a
                      className="btn"
                      href={icpSwapUrl()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Swap on ICPSwap
                    </a>
                    <a
                      className="btn"
                      href={KONG_SWAP_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Swap on Kong
                    </a>
                  </div>
                ) : null}
              </div>
              {identity ? (
                <span className="panel-count muted">
                  {tokens.length} ledger{tokens.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {!identity && <p className="muted">Sign in to load balances.</p>}
            {identity && tokens.length === 0 && !loading ? (
              <p className="muted">No seed ledger balances yet.</p>
            ) : null}
            <div className="token-list">
              {tokensSorted.map((t) => {
                const fiat = valuation.lines.get(t.ledgerId);
                return (
                <button
                  key={t.ledgerId}
                  type="button"
                  className="token-row token-row--action"
                  onClick={() => setFtSendToken(t)}
                >
                  <div className="token-row__main">
                    <TokenLogo
                      ledgerId={t.ledgerId}
                      symbol={t.symbol}
                      logoUrl={t.logoUrl}
                    />
                    <div className="token-row__id">
                      <strong>
                        {t.symbol}
                        {isUnverifiedLedger(t.ledgerId) ? (
                          <span className="risk-badge">Unverified</span>
                        ) : null}
                        {fiat?.change24hPct != null ? (
                          <span
                            className={`token-chg${fiat.change24hPct >= 0 ? " token-chg--up" : " token-chg--down"}`}
                          >
                            {formatPct(fiat.change24hPct)}
                          </span>
                        ) : null}
                      </strong>
                      <div className="muted token-row__meta">
                        <span>{t.name}</span>
                        {fiat?.priceUsd != null ? (
                          <span> · {formatUsd(fiat.priceUsd)}/ea</span>
                        ) : (
                          <span>
                            {t.standards.includes("icrc2")
                              ? " · ICRC-2"
                              : " · ICRC-1"}
                          </span>
                        )}
                      </div>
                      <div
                        className="token-row__ledger"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <span className="mono muted" title={t.ledgerId}>
                          {shortenAddress(t.ledgerId, 5, 5)}
                        </span>
                        <CopyButton value={t.ledgerId} label="Copy ID" compact />
                        <a
                          className="token-row__explorer"
                          href={canisterExplorerUrl(t.ledgerId)}
                          target="_blank"
                          rel="noreferrer"
                          title="Open ledger on ICP Dashboard"
                        >
                          Explorer
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="token-row__bal">
                    <span className="token-row__amt">{t.balanceDisplay}</span>
                    {fiat?.priced && fiat.usd != null ? (
                      <>
                        <span className="token-row__usd tabular">
                          {formatUsd(fiat.usd)}
                        </span>
                        <span className="muted token-row__icp-val tabular">
                          {fiat.icp != null ? formatIcpValue(fiat.icp) : "—"}
                        </span>
                      </>
                    ) : (
                      <span className="muted token-row__hint">Unpriced</span>
                    )}
                    <a
                      className="token-row__swap"
                      href={icpSwapUrl(t.ledgerId)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Swap
                    </a>
                  </div>
                </button>
                );
              })}
            </div>
          </section>
        )}

        {tab === "nfts" && (
          <section className="panel glass-panel nfts-panel">
            <div className="panel-head">
              <div>
                <h2>NFTs</h2>
                <p className="muted panel-lead">
                  All holdings per collection — paginated for display only,
                  no hard NFT or collection cap. Every Bonsai Bazaar registry
                  collection (ICRC-7 + EXT) is probed and sorted by collection
                  id. Holdings refresh in the background after tokens. Bazaar
                  listing stays in Canopy; buys on Market.{" "}
                  <a
                    href={`${BAZAAR_MARKET_URL}/wallet/ii`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Bazaar vault
                  </a>
                  {" · "}
                  <a
                    href={NFT_MIGRATOR_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    NFT Migrator
                  </a>
                </p>
              </div>
              {identity ? (
                <span className="panel-count muted">
                  {nfts.length} item{nfts.length === 1 ? "" : "s"} ·{" "}
                  {nftGroups.length} collection
                  {nftGroups.length === 1 ? "" : "s"}
                  {nftPrefetching ? " · updating…" : ""}
                </span>
              ) : null}
            </div>
            {identity ? (
              <div className="row nft-toolbar">
                <label className="nft-sort">
                  <span className="muted">Sort all</span>
                  <select
                    value={nftSort}
                    onChange={(e) => setNftSort(e.target.value as NftSortKey)}
                    aria-label="Sort NFT collections"
                  >
                    <option value="tokenId">Token ID</option>
                    <option value="name">Name</option>
                    <option value="serial">Catalog serial</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={`btn${nftSelectMode === "send" ? " btn-primary" : ""}`}
                  disabled={loading || listingBusy}
                  onClick={() => enterNftMode("send")}
                >
                  {nftSelectMode === "send" ? "Cancel send" : "Bulk send"}
                </button>
                <button
                  type="button"
                  className={`btn${nftSelectMode === "list" ? " btn-primary" : ""}`}
                  disabled={loading || listingBusy}
                  onClick={() => enterNftMode("list")}
                >
                  {nftSelectMode === "list" ? "Cancel list" : "Bulk list"}
                </button>
                {nftSelectMode != null ? (
                  <div className="nft-select-wallet">
                    <button
                      type="button"
                      className="btn"
                      disabled={loading || listingBusy || nfts.length === 0}
                      onClick={() => selectAllWalletExperimental()}
                      title="Experimental: select every NFT in this wallet. Use at your own risk."
                    >
                      Select all wallet
                    </button>
                    <span className="muted nft-select-wallet__risk">
                      Experimental · use at own risk · send batch cap{" "}
                      {NFT_BULK_SEND_UI_CAP}
                    </span>
                    {nftSelected.size > 0 ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setNftSelected(new Set())}
                      >
                        Clear selection ({nftSelected.size})
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {nftSelectMode === "list" ? (
                  <>
                    <label className="nft-price-label">
                      Price (ICP)
                      <input
                        value={listPriceIcp}
                        onChange={(e) => setListPriceIcp(e.target.value)}
                        inputMode="decimal"
                        style={{ width: 88 }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={listingBusy || !listableSelected.length}
                      onClick={() => void runListBazaarNfts(listableSelected)}
                    >
                      List {listableSelected.length || ""} selected
                    </button>
                  </>
                ) : null}
                {nftSelectMode === "send" ? (
                  <div className="nft-bulk-send">
                    <label className="nft-price-label grow">
                      Destination principal
                      <input
                        value={bulkSendTo}
                        onChange={(e) => setBulkSendTo(e.target.value)}
                        placeholder="aaaaa-…"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void readClipboardText().then((t) => {
                          if (t) setBulkSendTo(t);
                        });
                      }}
                    >
                      Paste
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        loading ||
                        !sendableSelected.length ||
                        !bulkSendTo.trim()
                      }
                      onClick={() => void runBulkSendNfts()}
                    >
                      Send {Math.min(sendableSelected.length, NFT_BULK_SEND_UI_CAP) || ""}{" "}
                      selected
                    </button>
                    {bulkFeeQuote && sendableSelected.length > 0 ? (
                      <p className="muted nft-bulk-fee">
                        Fee {formatToken(bulkFeeQuote.feeE8s, 8)} ICP
                        {bulkFeeQuote.discountBps > 0
                          ? ` · ${bulkFeeQuote.discountBps / 100}% bulk off (was ${formatToken(bulkFeeQuote.subtotalE8s, 8)})`
                          : ` · ${formatToken(bulkFeeQuote.unitFeeE8s, 8)} ICP each`}
                        {" · "}
                        {sendableSelected.length} ICRC-7/EXT
                        {sendableSelected.length > NFT_BULK_SEND_UI_CAP
                          ? ` · cap ${NFT_BULK_SEND_UI_CAP}/batch`
                          : ""}
                      </p>
                    ) : null}
                    {bulkSendProgress ? (
                      <p className="status-line status-line--inbound">
                        {bulkSendProgress}
                      </p>
                    ) : null}
                    <p className="muted nft-bulk-hint">
                      Micro-fee stacks per NFT; bulk tiers unlock at 2 / 5 / 10 /
                      25 / 50+. Click cards to select · right-click opens a
                      single-send popup. Warning: Plug / other wallets may not
                      load these NFTs after transfer.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!identity && <p className="muted">Sign in to load NFT holdings.</p>}
            {identity && nftPrefetching && nfts.length === 0 ? (
              <p className="muted">Loading NFTs in the background…</p>
            ) : null}
            {identity && nftGroups.length === 0 && !loading && !nftPrefetching ? (
              <div className="empty-grove">
                <img
                  src="/brand/canopy-empty-grove.png"
                  alt=""
                  width={420}
                  height={315}
                />
                <p className="muted">
                  The grove is quiet — no NFTs indexed yet. Mint or collect on
                  Bazaar, then refresh.
                </p>
              </div>
            ) : null}
            {nftGroups.map(([gid, g]) => (
              <NftCollectionSection
                key={gid}
                groupId={gid}
                label={g.label}
                items={g.items}
                sort={nftSort}
                onSortChange={setNftSort}
                selectMode={nftSelectMode != null}
                selectedKeys={nftSelected}
                onToggleSelect={toggleNftSelect}
                onToggleSelectCollection={toggleSelectCollection}
                onListOne={(n) => void runListBazaarNfts([n])}
                onSelectSend={(n) => setSendNft(n)}
                onRefreshCollection={() =>
                  void refreshNftCollection(gid, g.items)
                }
                refreshingCollection={refreshingNftGroup === gid}
              />
            ))}
          </section>
        )}

        {tab === "cycles" && (
          <section className="panel glass-panel">
            <div className="panel-head">
              <div>
                <h2>Cycles</h2>
                <p className="muted panel-lead">
                  Labs · In-house CMC + cycles ledger — no NNS hop. ~0.25% Canopy
                  fee in ICP stacks on CMC and credits the ICP↔cycles LP bucket.
                  Prefer small test amounts until you are comfortable with the
                  flow.
                </p>
              </div>
              {identity && cyclesBalance != null ? (
                <span className="panel-count muted">
                  Ledger {formatCycles(cyclesBalance)}
                </span>
              ) : null}
            </div>

            <div className="cycle-modes">
              {(
                [
                  ["topup", "Top up canister"],
                  ["mint", "Mint to wallet"],
                  ["withdraw", "Ledger → canister"],
                  ["send", "Send cycles"],
                  ["create", "Create canister"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn cycle-mode ${cycleMode === id ? "is-active" : ""}`}
                  onClick={() => {
                    setCycleMode(id);
                    setCycleQuote(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="row">
              {(cycleMode === "topup" ||
                cycleMode === "withdraw" ||
                cycleMode === "create") && (
                <label className="field-label">
                  Canister
                  <input
                    placeholder="Target canister id"
                    value={cycleCanister}
                    onChange={(e) => setCycleCanister(e.target.value)}
                    disabled={cycleMode === "create"}
                  />
                </label>
              )}
              {cycleMode === "send" && (
                <>
                  <label className="field-label">
                    To principal
                    <input
                      placeholder="Destination principal"
                      value={cycleSendTo}
                      onChange={(e) => setCycleSendTo(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void readClipboardText().then((t) => {
                        if (t) setCycleSendTo(t);
                      });
                    }}
                  >
                    Paste
                  </button>
                </>
              )}
              {(cycleMode === "topup" || cycleMode === "mint") && (
                <label className="field-label">
                  ICP
                  <input
                    placeholder="ICP amount"
                    value={cycleIcp}
                    onChange={(e) => setCycleIcp(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
              )}
              {(cycleMode === "withdraw" ||
                cycleMode === "send" ||
                cycleMode === "create") && (
                <label className="field-label">
                  Cycles
                  <input
                    placeholder="e.g. 1t or 1000000000000"
                    value={cycleAmount}
                    onChange={(e) => setCycleAmount(e.target.value)}
                  />
                </label>
              )}
              {(cycleMode === "topup" || cycleMode === "withdraw") && (
                <label className="field-label">
                  Bookmark label
                  <input
                    placeholder="Optional name"
                    value={bookmarkLabel}
                    onChange={(e) => setBookmarkLabel(e.target.value)}
                  />
                </label>
              )}
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => void runCycleQuote()}
              >
                Quote
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!identity || loading}
                onClick={() => void runCycleExecute()}
              >
                {cycleMode === "topup"
                  ? "Top up in Canopy"
                  : cycleMode === "mint"
                    ? "Mint in Canopy"
                    : cycleMode === "withdraw"
                      ? "Withdraw to canister"
                      : cycleMode === "send"
                        ? "Send cycles"
                        : "Create canister"}
              </button>
            </div>

            {cycleQuote && (cycleMode === "topup" || cycleMode === "mint") && (
              <div className="preview">
                <div>ICP in: {formatToken(cycleQuote.icpE8s, 8)}</div>
                <div>
                  Canopy fee ({cycleQuote.bps.toString()} bps):{" "}
                  {formatToken(cycleQuote.marginE8s, 8)} ICP → treasury + LP
                </div>
                <div>Net to CMC: {formatToken(cycleQuote.netIcpE8s, 8)} ICP</div>
                <div>Est. cycles: {formatCycles(cycleQuote.estimatedCycles)}</div>
                <div className="muted">
                  Rate ≈ {formatCycles(cycleQuote.cyclesPerIcp)} / ICP
                </div>
              </div>
            )}

            <div className="lp-desk cycle-bookmarks">
              <h3>Bookmarks</h3>
              <p className="muted panel-lead">
                Quick-fill canister ids for top-ups and withdraws. Stored on
                this device only.
              </p>
              {bookmarks.length === 0 ? (
                <p className="muted">No bookmarks yet.</p>
              ) : (
                <ul className="lp-credit-list">
                  {bookmarks.map((b) => (
                    <li key={b.id} className="lp-credit-row">
                      <button
                        type="button"
                        className="btn bookmark-pick"
                        onClick={() => {
                          setCycleCanister(b.id);
                          setBookmarkLabel(b.label);
                          if (cycleMode !== "topup" && cycleMode !== "withdraw") {
                            setCycleMode("topup");
                          }
                        }}
                      >
                        <strong>{b.label}</strong>
                        <span className="muted">{b.id}</span>
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          setBookmarks(removeCycleBookmark(b.id))
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "manage" && (
          <>
            <section className="panel glass-panel labs-panel">
              <div className="panel-head">
                <div>
                  <h2>Labs</h2>
                  <p className="muted panel-lead">
                    Experimental ICP tooling. Cycles top-up / mint / create stay
                    behind Labs until CMC recovery paths are hardened. Also
                    enable with <span className="mono">?labs=1</span>.
                  </p>
                </div>
              </div>
              <label className="labs-toggle">
                <input
                  type="checkbox"
                  checked={labsEnabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setLabsEnabled(on);
                    setLabsEnabledState(on);
                    if (!on) selectTab("tokens");
                  }}
                />
                <span>Enable Cycles tab (Labs)</span>
              </label>
            </section>
            <ManageWalletPanel
              ledgerCatalog={ledgerCatalog.length > 0 ? ledgerCatalog : SEED_ICRC1_LEDGERS}
              nftHoldings={nfts}
              onChanged={() => {
                if (identity) void refresh(identity);
              }}
            />
          </>
        )}

        <footer className="app-footer muted">
          Non-custodial · II Registry derivation ·{" "}
          <a href="/docs/THREAT_MODEL.md">Threat model</a> (repo) · Fees to Bonsai
          treasury · Not financial advice ·{" "}
          <a href="https://bonsaios.app/hope/" target="_blank" rel="noopener noreferrer">
            Hope Matters
          </a>
        </footer>
      </div>
      <TokenSendModal
        open={ftSendToken != null}
        token={ftSendToken}
        busy={ftSendBusy}
        error={ftSendError}
        draft={ftSendDraft}
        onClearError={() => setFtSendError(null)}
        onClose={() => {
          if (ftSendBusy) return;
          clearPendingFtSend();
          setFtSendDraft(null);
          setFtSendError(null);
          setFtSendToken(null);
        }}
        onContinue={({ to, amount }) => {
          if (!ftSendToken || ftSendBusy) return;
          const pending = loadPendingFtSend();
          void runSendFt({
            ledgerId: ftSendToken.ledgerId,
            to,
            amount,
            // Resume after mobile II: SpendReview already confirmed.
            skipReview: pending?.confirmed === true,
          });
        }}
      />
      <NftSendModal
        open={sendNft != null}
        nft={sendNft}
        busy={nftSendBusy}
        onClose={() => {
          if (nftSendBusy) return;
          setSendNft(null);
        }}
        onContinue={(to) => {
          if (nftSendBusy) return;
          void runSendNft(to);
        }}
      />
    </>
  );
}
