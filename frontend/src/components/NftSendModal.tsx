/**
 * Single NFT send sheet — destination principal, then parent runs SpendReview.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readClipboardText } from "../lib/clipboard";
import {
  loadRecentRecipients,
  parseDestination,
  shortenDest,
  type RecentRecipient,
} from "../lib/destinations";
import type { NftHolding } from "../lib/portfolio";

type Props = {
  open: boolean;
  nft: NftHolding | null;
  busy?: boolean;
  onClose: () => void;
  onContinue: (to: string) => void;
};

export function NftSendModal({
  open,
  nft,
  busy,
  onClose,
  onContinue,
}: Props) {
  const titleId = useId();
  const toRef = useRef<HTMLInputElement>(null);
  const [to, setTo] = useState("");
  const [recent, setRecent] = useState<RecentRecipient[]>([]);
  const [destHint, setDestHint] = useState("");

  useEffect(() => {
    if (!open) return;
    setTo("");
    setDestHint("");
    setRecent(
      loadRecentRecipients().filter((r) => r.kind === "principal"),
    );
    const t = window.setTimeout(() => toRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open, nft?.tokenId, nft?.contractId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!to.trim()) {
      setDestHint("");
      return;
    }
    const parsed = parseDestination(to);
    if (!parsed.ok) {
      setDestHint(parsed.error);
      return;
    }
    if (parsed.kind === "accountId") {
      setDestHint("NFT sends need a principal — Account ID is ICP-token only");
      return;
    }
    setDestHint("Principal destination");
  }, [to]);

  if (!open || !nft) return null;

  const parsed = to.trim() ? parseDestination(to) : null;
  const destOk =
    parsed?.ok === true && parsed.kind === "principal";
  const canContinue = Boolean(to.trim()) && !busy && destOk;

  return createPortal(
    <div
      className="spend-review-backdrop send-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="spend-review-modal glass-panel send-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Send NFT</h2>
        <div className="send-sheet__token">
          <div>
            <strong>{nft.name}</strong>
            <p className="muted">
              {nft.standard.toUpperCase()} · token {String(nft.tokenId)}
            </p>
            <p className="mono muted" title={nft.contractId}>
              {nft.contractId}
            </p>
          </div>
        </div>

        <label className="field-label send-sheet__field">
          Destination principal
          <div className="send-sheet__row">
            <input
              ref={toRef}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="principal or ICRC account"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                void readClipboardText().then((t) => {
                  if (t) setTo(t.trim());
                });
              }}
            >
              Paste
            </button>
          </div>
        </label>
        {destHint ? (
          <p
            className={`muted send-sheet__hint${destOk ? "" : " send-sheet__hint--warn"}`}
          >
            {destHint}
          </p>
        ) : null}

        {recent.length > 0 ? (
          <div className="send-sheet__recent">
            <span className="muted send-sheet__recent-label">Recent</span>
            <div className="send-sheet__recent-chips">
              {recent.map((r) => (
                <button
                  key={`${r.kind}:${r.value}`}
                  type="button"
                  className="send-sheet__chip"
                  disabled={busy}
                  title={r.value}
                  onClick={() => setTo(r.value)}
                >
                  {shortenDest(r.value)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="muted send-sheet__hint send-sheet__hint--warn">
          Warning: Plug, Stoic, and some other wallets may not show this NFT after
          transfer — it can look missing and be hard to retrieve. Prefer a Canopy
          / Internet Identity principal you control.
        </p>

        <p className="muted send-sheet__hint">
          Next step confirms the ICP micro-fee and destination. Fee is paid
          first and not refunded if the transfer fails.
        </p>

        <div className="spend-review-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canContinue}
            onClick={() => {
              if (!parsed || !parsed.ok || parsed.kind !== "principal") return;
              onContinue(parsed.value);
            }}
          >
            {busy ? "Sending…" : "Continue"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
