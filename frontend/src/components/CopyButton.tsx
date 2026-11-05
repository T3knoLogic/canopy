import { useEffect, useState } from "react";
import { copyText } from "../lib/clipboard";

type Props = {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  title?: string;
  /** Compact icon-style control for headers / inline rows. */
  compact?: boolean;
};

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className = "",
  title,
  compact = false,
}: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      className={`btn copy-btn${compact ? " copy-btn--compact" : ""}${copied ? " copy-btn--ok" : ""} ${className}`.trim()}
      title={title ?? (copied ? copiedLabel : label)}
      aria-label={copied ? copiedLabel : label}
      disabled={!value.trim()}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(value).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
