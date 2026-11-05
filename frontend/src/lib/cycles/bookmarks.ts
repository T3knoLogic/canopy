/**
 * Local bookmarks for canisters developers top up often.
 */
export type CycleBookmark = {
  id: string;
  label: string;
  addedAt: number;
};

const KEY = "canopy.cycle.bookmarks.v1";

export function loadCycleBookmarks(): CycleBookmark[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is CycleBookmark =>
          !!x &&
          typeof x === "object" &&
          typeof (x as CycleBookmark).id === "string" &&
          typeof (x as CycleBookmark).label === "string",
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}

function save(list: CycleBookmark[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* quota */
  }
}

export function addCycleBookmark(id: string, label?: string): CycleBookmark[] {
  const clean = id.trim().toLowerCase();
  if (!clean) return loadCycleBookmarks();
  const prev = loadCycleBookmarks().filter((b) => b.id !== clean);
  const next: CycleBookmark[] = [
    {
      id: clean,
      label: (label?.trim() || clean.slice(0, 12) + "…").slice(0, 48),
      addedAt: Date.now(),
    },
    ...prev,
  ];
  save(next);
  return next;
}

export function removeCycleBookmark(id: string): CycleBookmark[] {
  const next = loadCycleBookmarks().filter(
    (b) => b.id !== id.trim().toLowerCase(),
  );
  save(next);
  return next;
}

export function renameCycleBookmark(
  id: string,
  label: string,
): CycleBookmark[] {
  const next = loadCycleBookmarks().map((b) =>
    b.id === id.trim().toLowerCase()
      ? { ...b, label: label.trim().slice(0, 48) || b.label }
      : b,
  );
  save(next);
  return next;
}
