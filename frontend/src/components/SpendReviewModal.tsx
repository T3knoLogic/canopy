/**
 * In-app spend review — replaces window.confirm for wallet fund moves.
 */
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

export type SpendReviewField = {
  label: string;
  value: string;
  mono?: boolean;
};

export type SpendReviewRequest = {
  title: string;
  fields: SpendReviewField[];
  /** Shown as callouts (fee-before-action, unverified ledger, etc.) */
  risks?: string[];
  /** Custom / Manage-added ledger — user must check acknowledge */
  requireUnverifiedAck?: boolean;
  /** Extra required checkbox (e.g. foreign-wallet NFT risk). */
  requireExtraAck?: string;
  confirmLabel?: string;
};

type Props = {
  open: boolean;
  request: SpendReviewRequest | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SpendReviewModal({ open, request, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const [acked, setAcked] = useState(false);
  const [extraAcked, setExtraAcked] = useState(false);

  useEffect(() => {
    if (!open) {
      setAcked(false);
      setExtraAcked(false);
    }
  }, [open, request]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !request) return null;

  const canConfirm =
    (!request.requireUnverifiedAck || acked) &&
    (!request.requireExtraAck || extraAcked);

  return createPortal(
    <div
      className="spend-review-backdrop spend-review-backdrop--confirm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="spend-review-modal glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{request.title}</h2>
        <dl className="spend-review-fields">
          {request.fields.map((f) => (
            <div key={f.label} className="spend-review-row">
              <dt>{f.label}</dt>
              <dd className={f.mono ? "mono" : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
        {request.risks && request.risks.length > 0 && (
          <ul className="spend-review-risks">
            {request.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {request.requireUnverifiedAck && (
          <label className="spend-review-ack">
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
            />
            I understand this is an unverified custom canister and I accept the risk.
          </label>
        )}
        {request.requireExtraAck ? (
          <label className="spend-review-ack">
            <input
              type="checkbox"
              checked={extraAcked}
              onChange={(e) => setExtraAcked(e.target.checked)}
            />
            {request.requireExtraAck}
          </label>
        ) : null}
        <div className="spend-review-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {request.confirmLabel ?? "Confirm spend"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
