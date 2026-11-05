/**
 * FT send sheet — destination + amount, then parent runs SpendReview + transfer.
 * Errors stay inside this sheet on mobile (toasts alone flash/get covered).
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
import { feeFromBps, MICRO_FT_SEND_BPS } from "../lib/fees";
import {
  fetchIcrc1Meta,
  formatToken,
  maxSpendableFtAmount,
  parseTokenAmount,
} from "../lib/ledger";
import type { TokenHolding } from "../lib/portfolio";
import { TokenLogo } from "./TokenLogo";

type Props = {
  open: boolean;
  token: TokenHolding | null;
  busy?: boolean;
  /** Sticky error — survives toast flash / status-bar clear (critical on mobile). */
  error?: string | null;
  /** Prefill when resuming after mobile II redirect. */
  draft?: { to: string; amount: string } | null;
  onClose: () => void;
  onContinue: (args: { to: string; amount: string }) => void;
  onClearError?: () => void;
};

export function TokenSendModal({
  open,
  token,
  busy,
  error,
  draft,
  onClose,
  onContinue,
  onClearError,
}: Props) {
  const titleId = useId();
  const toRef = useRef<HTMLInputElement>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [maxDisplay, setMaxDisplay] = useState("");
  const [maxBase, setMaxBase] = useState<bigint | null>(null);
  const [recent, setRecent] = useState<RecentRecipient[]>([]);
  const [destHint, setDestHint] = useState("");

  useEffect(() => {
    if (!open) return;
    setTo(draft?.to ?? "");
    setAmount(draft?.amount ?? "");
    setDestHint("");
    setMaxDisplay("");
    setMaxBase(null);
    setRecent(loadRecentRecipients());
    const t = window.setTimeout(() => toRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open, token?.ledgerId, draft?.to, draft?.amount]);

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    void fetchIcrc1Meta(token.ledgerId)
      .then((meta) => {
        if (cancelled) return;
        const max = maxSpendableFtAmount(token.balance, meta.fee);
        setMaxBase(max);
        setMaxDisplay(formatToken(max, token.decimals));
      })
      .catch(() => {
        if (cancelled) return;
        setMaxBase(null);
        setMaxDisplay("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

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
    setDestHint(
      parsed.kind === "accountId"
        ? "ICP Account ID — send_dfx (ICP only)"
        : parsed.label === "ICRC account"
          ? "ICRC account — transfer includes this subaccount"
          : "Principal — ICRC-1 transfer",
    );
  }, [to]);

  if (!open || !token) return null;

  const canContinue = Boolean(to.trim() && amount.trim()) && !busy;
  const parsed = to.trim() ? parseDestination(to) : null;
  const destOk = parsed?.ok === true;

  const amountBase = parseTokenAmount(amount, token.decimals);
  const overMax = maxBase != null && amountBase != null && amountBase > maxBase;
  const feeEstimate =
    amountBase != null && amountBase > 0n
      ? feeFromBps(amountBase, MICRO_FT_SEND_BPS)
      : null;
  const receiveEstimate =
    feeEstimate != null && amountBase != null && amountBase > feeEstimate
      ? amountBase - feeEstimate
      : null;

  const applyMax = () => {
    if (maxDisplay) {
      setAmount(maxDisplay);
      return;
    }
  };

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
        <h2 id={titleId}>Send {token.symbol}</h2>
        <div className="send-sheet__token">
          <TokenLogo
            ledgerId={token.ledgerId}
            symbol={token.symbol}
            logoUrl={token.logoUrl}
          />
          <div>
            <strong>{token.symbol}</strong>
            <p className="muted">{token.name}</p>
            <p className="send-sheet__bal">
              Available <span className="tabular">{token.balanceDisplay}</span>
              {maxDisplay ? (
                <>
                  {" "}
                  · Max send{" "}
                  <span className="tabular">{maxDisplay}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {error ? (
          <div className="send-sheet__error" role="alert">
            <strong>Send failed</strong>
            <p>{error}</p>
            {onClearError ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onClearError}
              >
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}

        <label className="field-label send-sheet__field">
          Destination (principal or ICP Account ID)
          <div className="send-sheet__row">
            <input
              ref={toRef}
              value={to}
              onChange={(e) => {
                onClearError?.();
                setTo(e.target.value);
              }}
              placeholder="aaaaa-… or 64-char Account ID"
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
        {overMax ? (
          <p className="muted send-sheet__hint send-sheet__hint--warn">
            Amount is above Max. The send needs this amount plus two ledger fees.
            Nothing is sent until it fits.
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

        <label className="field-label send-sheet__field">
          Amount
          <div className="send-sheet__row">
            <input
              value={amount}
              onChange={(e) => {
                onClearError?.();
                setAmount(e.target.value);
              }}
              placeholder="0.0"
              inputMode="decimal"
              disabled={busy}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !maxDisplay}
              title={maxDisplay ? "Fill the largest amount that still covers ledger fees" : "Waiting for the ledger fee"}
              onClick={applyMax}
            >
              Max
            </button>
          </div>
        </label>

        <p className="muted send-sheet__hint">
          Max reserves one ledger fee, or two when the Canopy micro-fee is non-zero. Canopy micro-fee
          is taken from the amount and paid first — not refunded if the send
          fails. Account IDs may include spaces or dashes — we strip them.
          {receiveEstimate != null
            ? ` Recipient receives about ${formatToken(receiveEstimate, token.decimals)} ${token.symbol} before the ledger fee.`
            : ""}
        </p>
        <p className="muted send-sheet__hint" data-canopy-send-rail="v5">
          Send rail v5 · mobile II auto-resume · Account ID = send_dfx
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
            disabled={!canContinue || (parsed != null && !destOk) || overMax || amountBase == null}
            onClick={() =>
              onContinue({ to: to.trim(), amount: amount.trim() })
            }
          >
            {busy ? "Sending…" : error ? "Retry send" : "Continue"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
