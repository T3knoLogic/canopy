/** Compact principal / account display (MetaMask-style first…last). */
export function shortenAddress(value: string, head = 6, tail = 5): string {
  const v = value.trim();
  if (v.length <= head + tail + 1) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/** ICP Dashboard principal explorer. */
export function principalExplorerUrl(principal: string): string {
  return `https://dashboard.internetcomputer.org/account/${encodeURIComponent(principal.trim())}`;
}

/** ICP Dashboard canister explorer. */
export function canisterExplorerUrl(canisterId: string): string {
  return `https://dashboard.internetcomputer.org/canister/${encodeURIComponent(canisterId.trim())}`;
}
