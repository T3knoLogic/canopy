/**
 * Persist an in-progress FT send across mobile II redirect (`?auth=ii`).
 * Desktop popup waits in-place; mobile navigates away and must resume.
 */
const KEY = "canopy.pending.ftSend.v1";
const MAX_AGE_MS = 30 * 60 * 1000;

export type PendingFtSend = {
  ledgerId: string;
  to: string;
  amount: string;
  symbol?: string;
  /** True after SpendReview confirm — resume can skip a second review. */
  confirmed?: boolean;
  at: number;
};

export function savePendingFtSend(p: Omit<PendingFtSend, "at">): void {
  try {
    const row: PendingFtSend = { ...p, at: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(row));
  } catch {
    /* private mode */
  }
}

export function loadPendingFtSend(): PendingFtSend | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingFtSend;
    if (
      !parsed ||
      typeof parsed.ledgerId !== "string" ||
      typeof parsed.to !== "string" ||
      typeof parsed.amount !== "string" ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingFtSend(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
