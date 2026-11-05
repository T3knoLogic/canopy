/**
 * Labs / experimental surfaces (Cycles tab, etc.).
 * Enable via ?labs=1 or Manage toggle (localStorage).
 */
const LABS_KEY = "canopy.labs.v1";

export function loadLabsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("labs") === "1" || q.get("labs") === "true") return true;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(LABS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLabsEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(LABS_KEY, "1");
    else localStorage.removeItem(LABS_KEY);
  } catch {
    /* ignore */
  }
}

export const ICPSWAP_APP_URL = "https://app.icpswap.com/swap";

/** Open ICPSwap with optional token canister as input. */
export function icpSwapUrl(ledgerId?: string): string {
  if (!ledgerId) return ICPSWAP_APP_URL;
  const u = new URL(ICPSWAP_APP_URL);
  u.searchParams.set("input", ledgerId);
  return u.toString();
}
