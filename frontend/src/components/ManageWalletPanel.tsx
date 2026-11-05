import { useCallback, useEffect, useMemo, useState } from "react";
import { CollectionThumb } from "./CollectionThumb";
import { TokenLogo } from "./TokenLogo";
import { NFT_MIGRATOR_URL, SEED_ICRC1_LEDGERS, type SeedLedger } from "../lib/constants";
import type { NftHolding } from "../lib/portfolio";
import { senseIcrcToken } from "../lib/tokens/sense";
import {
  getCachedLogo,
  prefetchTokenLogos,
  resolveTokenLogos,
} from "../lib/tokens/logos";
import { senseNftCollection } from "../lib/nfts/sense";
import { resolveCollectionThumbs } from "../lib/nfts/thumbs";
import {
  loadHiddenSeedIds,
  loadWalletNfts,
  loadWalletTokens,
  removeWalletNft,
  removeWalletToken,
  setNftVisible,
  setSeedTokenVisible,
  setTokenVisible,
  upsertWalletNft,
  upsertWalletToken,
  type WalletNftCollection,
  type WalletToken,
} from "../lib/wallet/registry";

type Props = {
  onChanged: () => void;
  ledgerCatalog?: SeedLedger[];
  nftHoldings?: NftHolding[];
};

type ManageTokenRow = {
  id: string;
  symbol: string;
  name: string;
  logoUrl: string;
  kind: "seed" | "manual" | "catalog";
  standards?: string[];
};

type ManageNftRow = {
  id: string;
  name: string;
  standard: string;
  thumb: string | null;
  kind: "manual" | "discovered";
  visible: boolean;
};

export function ManageWalletPanel({
  onChanged,
  ledgerCatalog = [],
  nftHoldings = [],
}: Props) {
  const [walletTokens, setWalletTokens] = useState<WalletToken[]>(() =>
    loadWalletTokens(),
  );
  const [walletNfts, setWalletNfts] = useState<WalletNftCollection[]>(() =>
    loadWalletNfts(),
  );
  const [hiddenSeed, setHiddenSeed] = useState(() => loadHiddenSeedIds());
  const [logoMap, setLogoMap] = useState<Record<string, string>>({});
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [mediaBusy, setMediaBusy] = useState(false);
  const [tokenCid, setTokenCid] = useState("");
  const [nftCid, setNftCid] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const reload = useCallback(() => {
    setWalletTokens(loadWalletTokens());
    setWalletNfts(loadWalletNfts());
    setHiddenSeed(loadHiddenSeedIds());
  }, []);

  const tokenRows = useMemo(() => {
    const map = new Map<string, ManageTokenRow>();
    for (const s of SEED_ICRC1_LEDGERS) {
      map.set(s.id, {
        id: s.id,
        symbol: s.symbol,
        name: s.name,
        logoUrl: logoMap[s.id] || getCachedLogo(s.id) || s.logoUrl,
        kind: "seed",
        standards: s.standards,
      });
    }
    for (const t of walletTokens) {
      map.set(t.id, {
        id: t.id,
        symbol: t.symbol,
        name: t.name,
        logoUrl: logoMap[t.id] || t.logoUrl || getCachedLogo(t.id) || "",
        kind: "manual",
        standards: t.standards,
      });
    }
    for (const s of ledgerCatalog) {
      const id = s.id.toLowerCase();
      if (map.has(id)) {
        const prev = map.get(id)!;
        if (!prev.logoUrl && (logoMap[id] || s.logoUrl)) {
          map.set(id, {
            ...prev,
            logoUrl: logoMap[id] || s.logoUrl || prev.logoUrl,
          });
        }
        continue;
      }
      map.set(id, {
        id,
        symbol: s.symbol,
        name: s.name,
        logoUrl: logoMap[id] || s.logoUrl || getCachedLogo(id) || "",
        kind: "catalog",
        standards: s.standards,
      });
    }
    return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [walletTokens, ledgerCatalog, logoMap]);

  const nftRows = useMemo(() => {
    const map = new Map<string, ManageNftRow>();
    for (const c of walletNfts) {
      map.set(c.id, {
        id: c.id,
        name: c.name,
        standard: c.standard,
        thumb: thumbMap[c.id] || c.thumbnailUrl,
        kind: "manual",
        visible: c.visible,
      });
    }
    for (const n of nftHoldings) {
      const id = n.contractId.toLowerCase();
      const art = n.posterUrl || n.imageUrl || n.mediaUrl;
      if (map.has(id)) {
        const prev = map.get(id)!;
        if (!prev.thumb && art) {
          map.set(id, { ...prev, thumb: thumbMap[id] || art });
        }
        continue;
      }
      map.set(id, {
        id,
        name: n.collectionName || n.name || id.slice(0, 12),
        standard: n.standard,
        thumb: thumbMap[id] || art,
        kind: "discovered",
        visible: true,
      });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [walletNfts, nftHoldings, thumbMap]);

  useEffect(() => {
    let cancelled = false;
    const ids = [
      ...SEED_ICRC1_LEDGERS.map((s) => s.id),
      ...walletTokens.map((t) => t.id),
      ...ledgerCatalog.map((s) => s.id),
    ];
    const uniq = [...new Set(ids.map((x) => x.toLowerCase()))];
    if (!uniq.length) return;
    setMediaBusy(true);
    prefetchTokenLogos(uniq);
    void resolveTokenLogos(uniq, {
      concurrency: 16,
      onPartial: (m) => {
        if (!cancelled) setLogoMap((prev) => ({ ...prev, ...m }));
      },
    })
      .then((m) => {
        if (!cancelled) setLogoMap((prev) => ({ ...prev, ...m }));
      })
      .finally(() => {
        if (!cancelled) setMediaBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ledgerCatalog, walletTokens]);

  useEffect(() => {
    let cancelled = false;
    const preferred: Record<string, string | null | undefined> = {};
    const ids: string[] = [];
    for (const c of walletNfts) {
      ids.push(c.id);
      preferred[c.id] = c.thumbnailUrl;
    }
    for (const n of nftHoldings) {
      const id = n.contractId.toLowerCase();
      ids.push(id);
      preferred[id] =
        preferred[id] || n.posterUrl || n.imageUrl || n.mediaUrl;
    }
    const uniq = [...new Set(ids)];
    if (!uniq.length) return;
    setMediaBusy(true);
    void resolveCollectionThumbs(uniq, preferred, {
      concurrency: 14,
      onPartial: (m) => {
        if (!cancelled) setThumbMap((prev) => ({ ...prev, ...m }));
      },
    })
      .then((m) => {
        if (!cancelled) setThumbMap((prev) => ({ ...prev, ...m }));
      })
      .finally(() => {
        if (!cancelled) setMediaBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [walletNfts, nftHoldings]);

  const addToken = async () => {
    setBusy(true);
    setErr("");
    setMsg("Sensing ledger…");
    try {
      const sensed = await senseIcrcToken(tokenCid);
      const list = upsertWalletToken({
        ...sensed,
        visible: true,
        source: "manual",
      });
      setWalletTokens(list);
      if (sensed.logoUrl) {
        setLogoMap((prev) => ({ ...prev, [sensed.id]: sensed.logoUrl }));
      }
      setTokenCid("");
      setMsg(
        `Saved ${sensed.symbol} · ${sensed.standards.join("+").toUpperCase()}`,
      );
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsg("");
    } finally {
      setBusy(false);
    }
  };

  const addNft = async () => {
    setBusy(true);
    setErr("");
    setMsg("Sensing collection…");
    try {
      const sensed = await senseNftCollection(nftCid);
      const list = upsertWalletNft({
        ...sensed,
        visible: true,
        source: "manual",
      });
      setWalletNfts(list);
      if (sensed.thumbnailUrl) {
        setThumbMap((prev) => ({ ...prev, [sensed.id]: sensed.thumbnailUrl! }));
      }
      setNftCid("");
      setMsg(
        sensed.standard === "dip721"
          ? `Saved ${sensed.name} · DIP721. Canopy Send covers ICRC-7 and EXT. Move DIP721 with the IC NFT Migrator (${NFT_MIGRATOR_URL}).`
          : `Saved ${sensed.name} · ${sensed.standard.toUpperCase()}`,
      );
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsg("");
    } finally {
      setBusy(false);
    }
  };

  const toggleToken = (row: ManageTokenRow, on: boolean) => {
    if (row.kind === "manual") {
      setWalletTokens(setTokenVisible(row.id, on));
    } else {
      setHiddenSeed(setSeedTokenVisible(row.id, on));
    }
    onChanged();
  };

  const isTokenOn = (row: ManageTokenRow) => {
    if (row.kind === "manual") {
      return walletTokens.find((t) => t.id === row.id)?.visible ?? true;
    }
    return !hiddenSeed.has(row.id);
  };

  return (
    <section className="panel glass-panel manage-panel">
      <div className="panel-head">
        <div>
          <h2>Manage wallet</h2>
          <p className="muted panel-lead">
            Add ledgers and NFT collections by canister id. Logos and collection
            thumbs load automatically from on-chain metadata, SNS aggregator,
            and your holdings cache.
            {mediaBusy ? " Refreshing media…" : ""}
          </p>
        </div>
        <span className="panel-count muted">
          {tokenRows.length} tokens · {nftRows.length} collections
        </span>
      </div>

      {msg ? <p className="muted status-line">{msg}</p> : null}
      {err ? <p className="err status-line">{err}</p> : null}

      <div className="manage-block">
        <h3>Add token ledger</h3>
        <div className="row manage-add-row">
          <label className="grow">
            Canister id
            <input
              value={tokenCid}
              onChange={(e) => setTokenCid(e.target.value)}
              placeholder="ryjl3-tyaaa-aaaaa-aaaba-cai"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !tokenCid.trim()}
            onClick={() => void addToken()}
          >
            Sense &amp; save
          </button>
        </div>
      </div>

      <div className="manage-block">
        <h3>Token visibility</h3>
        <ul className="manage-list manage-list--dense">
          {tokenRows.map((row) => {
            const on = isTokenOn(row);
            return (
              <li key={`tok-${row.id}`} className="manage-row">
                <TokenLogo
                  ledgerId={row.id}
                  symbol={row.symbol}
                  logoUrl={row.logoUrl}
                />
                <div className="manage-row__meta">
                  <strong>
                    {row.symbol}
                    {row.kind === "manual" ? (
                      <span className="risk-badge">Unverified</span>
                    ) : null}
                  </strong>
                  <span className="muted">
                    {row.name} · {row.kind}
                    {row.standards?.length
                      ? ` · ${row.standards.join("+").toUpperCase()}`
                      : ""}
                  </span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggleToken(row, e.target.checked)}
                  />
                  <span className="switch__ui" />
                  <span className="switch__label">{on ? "On" : "Off"}</span>
                </label>
                {row.kind === "manual" ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setWalletTokens(removeWalletToken(row.id));
                      onChanged();
                      reload();
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="manage-block">
        <h3>Add NFT collection</h3>
        <div className="row manage-add-row">
          <label className="grow">
            Canister id
            <input
              value={nftCid}
              onChange={(e) => setNftCid(e.target.value)}
              placeholder="collection canister id"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !nftCid.trim()}
            onClick={() => void addNft()}
          >
            Sense &amp; save
          </button>
        </div>
      </div>

      <div className="manage-block">
        <h3>NFT collection visibility</h3>
        {nftRows.length === 0 ? (
          <p className="muted">
            No collections yet — load holdings or add a canister id above.
            Thumbnails pull from your NFT art first, then collection endpoints.
          </p>
        ) : (
          <ul className="manage-list manage-list--dense">
            {nftRows.map((c) => (
              <li key={`nft-${c.id}`} className="manage-row">
                <CollectionThumb
                  canisterId={c.id}
                  label={c.name}
                  preferredUrl={c.thumb}
                />
                <div className="manage-row__meta">
                  <strong>{c.name}</strong>
                  <span className="muted">
                    {c.standard.toUpperCase()} · {c.kind} · {c.id.slice(0, 16)}…
                    {c.standard === "dip721" ? (
                      <>
                        {" "}
                        ·{" "}
                        <a href={NFT_MIGRATOR_URL} target="_blank" rel="noreferrer">
                          Move via Migrator
                        </a>
                      </>
                    ) : null}
                  </span>
                </div>
                {c.kind === "manual" ? (
                  <>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={c.visible}
                        onChange={(e) => {
                          setWalletNfts(setNftVisible(c.id, e.target.checked));
                          onChanged();
                        }}
                      />
                      <span className="switch__ui" />
                      <span className="switch__label">
                        {c.visible ? "On" : "Off"}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setWalletNfts(removeWalletNft(c.id));
                        onChanged();
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="muted switch__label">in wallet</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
