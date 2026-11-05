/**
 * Local activity feed — last N wallet actions for UX / support.
 * Display-only; not a substitute for on-chain indexers.
 */
export type ActivityKind =
  | "ft_send"
  | "ft_receive"
  | "nft_send"
  | "nft_receive"
  | "nft_bulk"
  | "list"
  | "cycles"
  | "swap"
  | "connect"
  | "disconnect"
  | "receive";

export type ActivityEntry = {
  id: string;
  at: number;
  kind: ActivityKind;
  title: string;
  detail: string;
  /** Explorer or deep-link when known */
  href?: string;
  block?: string;
};

const KEY = "canopy.activity.v1";
const MAX = 60;

const KIND_LABEL: Record<ActivityKind, string> = {
  ft_send: "Send",
  ft_receive: "Receive",
  receive: "Receive",
  nft_send: "NFT out",
  nft_receive: "NFT in",
  nft_bulk: "Bulk",
  list: "List",
  cycles: "Cycles",
  swap: "Swap",
  connect: "Connect",
  disconnect: "Disconnect",
};

export function activityKindLabel(kind: ActivityKind): string {
  return KIND_LABEL[kind] ?? kind;
}

export function icpTxExplorerUrl(block: string | bigint): string {
  return `https://dashboard.internetcomputer.org/transaction/${block.toString()}`;
}

export function loadActivity(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ActivityEntry =>
          !!e &&
          typeof e === "object" &&
          typeof (e as ActivityEntry).id === "string" &&
          typeof (e as ActivityEntry).title === "string",
      )
      .map((e) => ({
        ...e,
        kind: (e.kind as ActivityKind) || "ft_send",
      }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushActivity(
  entry: Omit<ActivityEntry, "id" | "at"> & { id?: string; at?: number },
): ActivityEntry[] {
  const full: ActivityEntry = {
    id: entry.id ?? `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    title: entry.title,
    detail: entry.detail,
    href: entry.href,
    block: entry.block,
  };
  try {
    const next = [full, ...loadActivity()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return [full];
  }
}

export function clearActivity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function formatActivityTime(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
