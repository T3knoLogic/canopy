import { useEffect, useState } from "react";
import { principalToAccountId } from "@t3kno/ic-nft-aggregator";
import { CopyButton } from "./CopyButton";
import {
  principalExplorerUrl,
  shortenAddress,
} from "../lib/addressDisplay";

type Props = {
  principal: string;
  open: boolean;
  onClose: () => void;
};

export function ReceiveSheet({ principal, open, onClose }: Props) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShowQr(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !principal) return;
    let cancelled = false;
    setAccountId(null);
    void principalToAccountId(principal)
      .then((id) => {
        if (!cancelled) setAccountId(id);
      })
      .catch(() => {
        if (!cancelled) setAccountId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, principal]);

  useEffect(() => {
    if (!open || !principal || !showQr) return;
    let cancelled = false;
    setQrDataUrl(null);
    setQrError(false);
    void import("qrcode")
      .then((QR) =>
        QR.toDataURL(principal, {
          width: 148,
          margin: 1,
          color: { dark: "#0b1a12", light: "#e8f5e9" },
          errorCorrectionLevel: "M",
        }),
      )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, principal, showQr]);

  if (!open) return null;

  return (
    <div
      className="receive-sheet"
      role="dialog"
      aria-modal
      aria-label="Receive"
      onClick={onClose}
    >
      <div
        className="receive-sheet__panel glass-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="receive-sheet__head">
          <div>
            <p className="brand-eyebrow">Receive</p>
            <h2>Your wallet address</h2>
            <p className="muted receive-sheet__lead">
              Same Internet Identity as Hub &amp; Bazaar. Use{" "}
              <strong>Principal ID</strong> for ICRC wallets; use{" "}
              <strong>Account ID</strong> when an exchange only accepts the
              legacy ICP account identifier — still the same wallet.
            </p>
          </div>
          <button type="button" className="btn receive-sheet__close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="receive-field receive-field--primary">
          <div className="receive-field__label">
            <span>Principal ID</span>
            <span className="receive-badge">ICP · ICRC</span>
          </div>
          <code className="receive-field__value mono" title={principal}>
            {principal}
          </code>
          <div className="row row--inline receive-field__actions">
            <CopyButton value={principal} label="Copy principal" />
            <button
              type="button"
              className="btn"
              aria-expanded={showQr}
              onClick={() => setShowQr((v) => !v)}
            >
              {showQr ? "Hide QR" : "Show QR"}
            </button>
            <a
              className="btn"
              href={principalExplorerUrl(principal)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer
            </a>
          </div>
          <p className="muted receive-field__hint">
            Check ends match after paste — {shortenAddress(principal, 8, 6)}
          </p>
        </div>

        {showQr ? (
          <div className="receive-sheet__qr receive-sheet__qr--compact">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Principal QR code"
                width={148}
                height={148}
              />
            ) : qrError ? (
              <p className="muted">QR unavailable — use copy instead.</p>
            ) : (
              <p className="muted">Generating…</p>
            )}
          </div>
        ) : null}

        <div className="receive-field receive-field--primary">
          <div className="receive-field__label">
            <span>Account ID</span>
            <span className="receive-badge">Exchanges · NNS</span>
          </div>
          <p className="muted receive-field__hint">
            Default subaccount for this principal — for exchange withdrawals that
            require Account ID (not a second wallet).
          </p>
          {accountId ? (
            <>
              <code className="receive-field__value mono" title={accountId}>
                {accountId}
              </code>
              <div className="row row--inline receive-field__actions">
                <CopyButton value={accountId} label="Copy account ID" />
              </div>
              <p className="muted receive-field__hint">
                Check ends match after paste — {shortenAddress(accountId, 8, 6)}
              </p>
            </>
          ) : (
            <p className="muted">Deriving account ID…</p>
          )}
        </div>
      </div>
    </div>
  );
}
