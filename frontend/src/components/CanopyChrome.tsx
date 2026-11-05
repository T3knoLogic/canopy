import { useEffect, useId, useRef, useState } from "react";
import {
  formatIcpValue,
  formatPct,
  formatUsd,
  type PortfolioValuation,
} from "../lib/prices";
import { shortenAddress } from "../lib/addressDisplay";
import { CopyButton } from "./CopyButton";

type Props = {
  principal: string;
  accountId: string | null | undefined;
  valuation: PortfolioValuation;
  loading?: boolean;
  onReceive: () => void;
  onRefresh: () => void;
  onLogout: () => void;
};

type Panel = "ids" | "grove" | null;

function useCountUp(target: number, durationMs = 420): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (!Number.isFinite(to)) {
      setDisplay(0);
      return;
    }
    if (Math.abs(to - from) < 1e-9) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return display;
}

export function CanopyChrome({
  principal,
  accountId,
  valuation,
  loading,
  onReceive,
  onRefresh,
  onLogout,
}: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const rootRef = useRef<HTMLElement>(null);
  const idsId = useId();
  const groveId = useId();
  const usdAnim = useCountUp(valuation.totalUsd);
  const icpAnim = useCountUp(valuation.totalIcp);
  const icpUsd = valuation.book?.icpUsd ?? 0;
  const ch = valuation.book?.icpChange24hPct ?? null;
  const sources = valuation.book?.icpSources?.join(" · ") || "ICPSwap";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!panel) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  const ageSec = valuation.book
    ? Math.max(0, Math.round((now - valuation.book.updatedAt) / 1000))
    : null;

  const toggle = (next: Panel) =>
    setPanel((cur) => (cur === next ? null : next));

  const usdLabel =
    loading && !valuation.book ? "…" : formatUsd(usdAnim);
  const icpLabel =
    loading && !valuation.book ? "—" : formatIcpValue(icpAnim);

  return (
    <header className="canopy-chrome" ref={rootRef}>
      <div className="canopy-chrome__bar">
        <div className="canopy-chrome__brand">
          <img
            className="canopy-chrome__mark"
            src="/brand/canopy-mark.png"
            alt=""
            width={28}
            height={28}
          />
          <div className="canopy-chrome__titles">
            <span className="canopy-chrome__eyebrow">Bonsai OS</span>
            <span className="canopy-chrome__name">Canopy</span>
          </div>
        </div>

        <button
          type="button"
          className={`canopy-chrome__chip${panel === "ids" ? " is-open" : ""}`}
          aria-expanded={panel === "ids"}
          aria-controls={idsId}
          onClick={() => toggle("ids")}
          title={principal}
        >
          <span className="canopy-chrome__chip-label">Principal</span>
          <span className="canopy-chrome__chip-value tabular">
            {shortenAddress(principal, 5, 4)}
          </span>
          <span className="canopy-chrome__chev" aria-hidden>
            ▾
          </span>
        </button>

        <button
          type="button"
          className={`canopy-chrome__chip canopy-chrome__chip--grove${panel === "grove" ? " is-open" : ""}`}
          aria-expanded={panel === "grove"}
          aria-controls={groveId}
          onClick={() => toggle("grove")}
        >
          <span className="folio-live canopy-chrome__live" aria-hidden>
            <span className="folio-live__dot" />
          </span>
          <span className="canopy-chrome__chip-value canopy-chrome__usd tabular">
            {usdLabel}
          </span>
          {ch != null ? (
            <span
              className={`folio-chg canopy-chrome__chg${ch >= 0 ? " folio-chg--up" : " folio-chg--down"}`}
            >
              {formatPct(ch)}
            </span>
          ) : null}
          <span className="canopy-chrome__chev" aria-hidden>
            ▾
          </span>
        </button>

        <div className="canopy-chrome__ops">
          <button type="button" className="btn btn-primary btn--slim" onClick={onReceive}>
            Receive
          </button>
          <button
            type="button"
            className="btn btn--slim"
            disabled={loading}
            onClick={onRefresh}
            title="Refresh balances"
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn--slim canopy-chrome__signout"
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </div>

      {panel === "ids" ? (
        <div className="canopy-chrome__panel" id={idsId} role="region" aria-label="Wallet IDs">
          <div className="canopy-chrome__id-row">
            <span className="receive-badge">Principal</span>
            <code className="canopy-chrome__id-full" title={principal}>
              {principal}
            </code>
            <CopyButton value={principal} label="Copy" compact />
          </div>
          {accountId ? (
            <div className="canopy-chrome__id-row">
              <span className="receive-badge">Account ID</span>
              <code className="canopy-chrome__id-full" title={accountId}>
                {accountId}
              </code>
              <CopyButton value={accountId} label="Copy" compact />
            </div>
          ) : null}
        </div>
      ) : null}

      {panel === "grove" ? (
        <div
          className="canopy-chrome__panel canopy-chrome__panel--grove"
          id={groveId}
          role="region"
          aria-label="Grove value details"
        >
          <div className="canopy-chrome__grove-head">
            <div>
              <p className="brand-eyebrow">Grove value</p>
              <p className="canopy-chrome__grove-usd tabular">{usdLabel}</p>
              <p className="canopy-chrome__grove-icp tabular">{icpLabel}</p>
            </div>
            <div className="canopy-chrome__grove-meta">
              <span className="folio-live">
                <span className="folio-live__dot" aria-hidden />
                Live
              </span>
              {ch != null ? (
                <span
                  className={`folio-chg${ch >= 0 ? " folio-chg--up" : " folio-chg--down"}`}
                  title="ICP 24h (blended feed)"
                >
                  ICP {formatPct(ch)}
                </span>
              ) : null}
              {icpUsd > 0 ? (
                <span className="muted tabular">1 ICP = {formatUsd(icpUsd)}</span>
              ) : null}
            </div>
          </div>

          {valuation.allocation.length > 0 ? (
            <div className="folio-alloc" aria-hidden>
              <div className="folio-alloc__bar">
                {valuation.allocation.map((a) => (
                  <span
                    key={a.ledgerId}
                    className="folio-alloc__seg"
                    style={{ flexGrow: Math.max(a.weight, 0.02) }}
                    title={`${a.symbol} ${(a.weight * 100).toFixed(1)}%`}
                  />
                ))}
              </div>
              <ul className="folio-alloc__legend">
                {valuation.allocation.slice(0, 4).map((a) => (
                  <li key={a.ledgerId}>
                    <strong>{a.symbol}</strong>
                    <span className="muted">{(a.weight * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="muted canopy-chrome__foot">
            {sources}
            {ageSec != null ? ` · ${ageSec}s ago` : ""}
            {valuation.unpricedCount > 0
              ? ` · ${valuation.unpricedCount} unpriced`
              : ""}
            {" · "}
            {valuation.pricedCount} priced
          </p>
        </div>
      ) : null}
    </header>
  );
}
