/**
 * Connected surfaces — apps that embed or sync with Canopy.
 * Disconnect forgets the surface and blocks further wallet-sync from that origin
 * until the user reconnects (local Canopy policy; II sessions elsewhere are unchanged).
 */

export type ConnectedApp = {
  id: string;
  origin: string;
  name: string;
  connectedAt: number;
  lastSeenAt: number;
  source: "embed" | "sync" | "manual";
};

const APPS_KEY = "canopy.connectedApps.v1";
const DENY_KEY = "canopy.connectedApps.deny.v1";
const MAX = 40;

/** Known Bonsai / ecosystem hosts Canopy may sync with. */
export const KNOWN_APP_CATALOG: ReadonlyArray<{
  id: string;
  name: string;
  origins: readonly string[];
  href: string;
}> = [
  {
    id: "bazaar",
    name: "Bonsai Bazaar",
    origins: [
      "https://iabi6-zqaaa-aaaau-agwpq-cai.icp0.io",
      "https://iabi6-zqaaa-aaaau-agwpq-cai.ic0.app",
    ],
    href: "https://iabi6-zqaaa-aaaau-agwpq-cai.icp0.io/",
  },
  {
    id: "registry",
    name: "Bonsai Registry / Hub",
    origins: [
      "https://u2jsa-baaaa-aaaau-aghea-cai.icp0.io",
      "https://u2jsa-baaaa-aaaau-aghea-cai.ic0.app",
    ],
    href: "https://u2jsa-baaaa-aaaau-aghea-cai.icp0.io/",
  },
  {
    id: "landing",
    name: "Bonsai OS",
    origins: [
      "https://bonsaios.app",
      "https://www.bonsaios.app",
      "https://2dxs4-nyaaa-aaaau-agzda-cai.icp0.io",
      "https://2dxs4-nyaaa-aaaau-agzda-cai.ic0.app",
    ],
    href: "https://bonsaios.app/",
  },
  {
    id: "radio",
    name: "Bonsai Radio",
    origins: [
      "https://yfpar-eiaaa-aaaau-agzoa-cai.icp0.io",
      "https://yfpar-eiaaa-aaaau-agzoa-cai.ic0.app",
    ],
    href: "https://yfpar-eiaaa-aaaau-agzoa-cai.icp0.io/",
  },
  {
    id: "works",
    name: "Bonsai Works",
    origins: [
      "https://z2htg-hqaaa-aaaau-agzkq-cai.icp0.io",
      "https://z2htg-hqaaa-aaaau-agzkq-cai.ic0.app",
    ],
    href: "https://z2htg-hqaaa-aaaau-agzkq-cai.icp0.io/",
  },
];

function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function catalogMatch(origin: string): (typeof KNOWN_APP_CATALOG)[number] | null {
  const o = origin.toLowerCase();
  for (const app of KNOWN_APP_CATALOG) {
    if (app.origins.some((x) => x.toLowerCase() === o)) return app;
  }
  return null;
}

function appIdForOrigin(origin: string): string {
  const known = catalogMatch(origin);
  if (known) return known.id;
  try {
    return `origin:${new URL(origin).hostname}`;
  } catch {
    return `origin:${origin}`;
  }
}

function nameForOrigin(origin: string): string {
  const known = catalogMatch(origin);
  if (known) return known.name;
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function loadConnectedApps(): ConnectedApp[] {
  try {
    const raw = localStorage.getItem(APPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ConnectedApp =>
          !!e &&
          typeof e === "object" &&
          typeof (e as ConnectedApp).id === "string" &&
          typeof (e as ConnectedApp).origin === "string" &&
          typeof (e as ConnectedApp).name === "string",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function saveConnectedApps(apps: ConnectedApp[]): void {
  try {
    localStorage.setItem(APPS_KEY, JSON.stringify(apps.slice(0, MAX)));
  } catch {
    /* ignore */
  }
}

export function loadDeniedOrigins(): string[] {
  try {
    const raw = localStorage.getItem(DENY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o): o is string => typeof o === "string" && !!normalizeOrigin(o))
      .map((o) => normalizeOrigin(o)!);
  } catch {
    return [];
  }
}

function saveDeniedOrigins(origins: string[]): void {
  try {
    localStorage.setItem(DENY_KEY, JSON.stringify([...new Set(origins)].slice(0, MAX)));
  } catch {
    /* ignore */
  }
}

export function isOriginDenied(origin: string): boolean {
  const o = normalizeOrigin(origin);
  if (!o) return true;
  const deny = loadDeniedOrigins();
  if (deny.includes(o)) return true;
  const known = catalogMatch(o);
  if (known) {
    return known.origins.some((x) => deny.includes(x));
  }
  return false;
}

/**
 * Record or refresh a connected surface (embed host / wallet-sync).
 * No-op when origin is on the disconnect denylist.
 */
export function touchConnectedApp(
  originRaw: string,
  source: ConnectedApp["source"] = "sync",
): ConnectedApp | null {
  const origin = normalizeOrigin(originRaw);
  if (!origin) return null;
  if (isOriginDenied(origin)) return null;

  const id = appIdForOrigin(origin);
  const name = nameForOrigin(origin);
  const now = Date.now();
  const prev = loadConnectedApps();
  const existing = prev.find((a) => a.id === id);
  const next: ConnectedApp = existing
    ? {
        ...existing,
        origin,
        name,
        lastSeenAt: now,
        source: source === "manual" ? existing.source : source,
      }
    : {
        id,
        origin,
        name,
        connectedAt: now,
        lastSeenAt: now,
        source,
      };
  const rest = prev.filter((a) => a.id !== id);
  saveConnectedApps([next, ...rest]);
  return next;
}

/** Disconnect: drop from list and deny further wallet-sync from that app’s origins. */
export function disconnectConnectedApp(id: string): ConnectedApp | null {
  const prev = loadConnectedApps();
  const target = prev.find((a) => a.id === id) ?? null;
  if (!target) return null;

  saveConnectedApps(prev.filter((a) => a.id !== id));

  const deny = loadDeniedOrigins();
  const known = KNOWN_APP_CATALOG.find((a) => a.id === id);
  const toDeny = known ? [...known.origins] : [target.origin];
  saveDeniedOrigins([...deny, ...toDeny]);

  return target;
}

/** Allow wallet-sync again (does not auto-connect — host must sync). */
export function allowConnectedAppOrigin(originRaw: string): void {
  const origin = normalizeOrigin(originRaw);
  if (!origin) return;
  const known = catalogMatch(origin);
  const remove = new Set(
    (known ? known.origins : [origin]).map((o) => o.toLowerCase()),
  );
  saveDeniedOrigins(
    loadDeniedOrigins().filter((o) => !remove.has(o.toLowerCase())),
  );
}

export function reconnectKnownApp(appId: string): void {
  const known = KNOWN_APP_CATALOG.find((a) => a.id === appId);
  if (!known) return;
  for (const o of known.origins) allowConnectedAppOrigin(o);
  touchConnectedApp(known.origins[0]!, "manual");
}

export function formatConnectedTime(at: number): string {
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
