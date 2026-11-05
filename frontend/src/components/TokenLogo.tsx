import { useEffect, useState } from "react";
import { tokenLogoCandidates } from "../lib/constants";

type Props = {
  ledgerId: string;
  symbol: string;
  logoUrl?: string | null;
  size?: number;
};

/** Tries resolved on-chain / SNS logos, then canister raw logo. */
export function TokenLogo({ ledgerId, symbol, logoUrl, size = 36 }: Props) {
  const candidates = tokenLogoCandidates(ledgerId, logoUrl ?? undefined);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [ledgerId, logoUrl]);

  const src = candidates[idx];

  if (!src || idx >= candidates.length) {
    return (
      <span
        className="token-logo token-logo--ph"
        style={{ width: size, height: size }}
        aria-hidden
        title={symbol}
      >
        {symbol.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="token-logo"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        setIdx((i) => i + 1);
      }}
    />
  );
}
