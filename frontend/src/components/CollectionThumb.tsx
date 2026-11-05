import { useEffect, useState } from "react";
import {
  collectionThumbCandidates,
  getCachedThumb,
} from "../lib/nfts/thumbs";

type Props = {
  canisterId: string;
  label?: string;
  preferredUrl?: string | null;
  size?: number;
};

/** Rotates through collection thumbnail candidates until one loads. */
export function CollectionThumb({
  canisterId,
  label = "NFT",
  preferredUrl,
  size = 36,
}: Props) {
  const candidates = collectionThumbCandidates(
    canisterId,
    preferredUrl ?? getCachedThumb(canisterId),
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [canisterId, preferredUrl]);

  const src = candidates[idx];

  if (!src || idx >= candidates.length) {
    return (
      <span
        className="token-logo token-logo--ph"
        style={{ width: size, height: size }}
        aria-hidden
        title={label}
      >
        {label.slice(0, 3).toUpperCase()}
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
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
