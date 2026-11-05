import { useEffect, useRef, useState } from "react";
import {
  formatIcpValue,
  formatPct,
  formatUsd,
  type PortfolioValuation,
} from "../lib/prices";

type Props = {
  valuation: PortfolioValuation;
  loading?: boolean;
};

function useCountUp(target: number, durationMs = 520): number {
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

export function PortfolioHero({ valuation, loading }: Props) {
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
  const ageSec = valuation.book
    ? Math.max(0, Math.round((now - valuation.book.updatedAt) / 1000))
    : null;

  return (
    <section className="folio-hero glass-panel" aria-label="Portfolio value">
      <div className="folio-hero__glow" aria-hidden />
      <div className="folio-hero__top">
        <div>
          <p className="brand-eyebrow">Grove value</p>
          <p className="folio-hero__usd tabular">
            {loading && !valuation.book ? "…" : formatUsd(usdAnim)}
          </p>
          <p className="folio-hero__icp tabular">
            {loading && !valuation.book ? "—" : formatIcpValue(icpAnim)}
          </p>
        </div>
        <div className="folio-hero__meta">
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
            <span className="muted folio-hero__rate tabular">
              1 ICP = {formatUsd(icpUsd)}
            </span>
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

      <p className="muted folio-hero__foot">
        {sources}
        {ageSec != null ? ` · ${ageSec}s ago` : ""}
        {valuation.unpricedCount > 0
          ? ` · ${valuation.unpricedCount} unpriced`
          : ""}
        {" · "}
        {valuation.pricedCount} priced
      </p>
    </section>
  );
}
