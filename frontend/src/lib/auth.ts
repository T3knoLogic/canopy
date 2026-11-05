import { AuthClient } from "@dfinity/auth-client";
import type { Identity } from "@dfinity/agent";
import {
  DEFAULT_II_IDENTITY_PROVIDER,
  II_POPUP_WINDOW_FEATURES,
  isIiConnectFailure,
  loginOptionsFromDerivationOrigin,
  preferIiAuthRedirect,
} from "@bonsai-os-sdk";
import { CANOPY_ORIGIN, DERIVATION_ORIGIN } from "./constants";
import { loadPendingFtSend } from "./pendingFtSend";

/** Session lifetime — wallet spend surface; prefer re-auth over long-lived theft window. */
export const SESSION_TTL_NS = BigInt(8) * BigInt(60 * 60 * 1_000_000_000); // 8 hours
/** Idle logout — 15 minutes. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Step-up when ICP-denominated notional ≥ this (default 0.1 ICP). */
export const STEP_UP_ICP_E8S = BigInt(
  (
    import.meta as ImportMeta & { env?: Record<string, string> }
  ).env?.VITE_STEP_UP_ICP_E8S?.trim() || "10000000",
);

const AUTH_RETURN_KEY = "canopy:authReturn";
/** Set by AuthIiPage before returning — consume on restore so mobile skips re-step-up. */
const II_FRESH_KEY = "canopy.ii.fresh.v1";
export const AUTH_II_QUERY = "auth";

/** After mobile/`?auth=ii` login, treat session as stepped-up for this long. */
export const FRESH_II_WINDOW_MS = 10 * 60 * 1000;

let client: AuthClient | null = null;
/** True after cold restoreIdentity until a step-up or explicit clear. */
let restoredSessionPendingStepUp = false;
let lastFreshLoginAt = 0;

export async function getAuthClient(): Promise<AuthClient> {
  if (!client) {
    client = await AuthClient.create({
      idleOptions: {
        idleTimeout: IDLE_TIMEOUT_MS,
        disableIdle: false,
      },
      loginOptions: {
        identityProvider: DEFAULT_II_IDENTITY_PROVIDER,
        maxTimeToLive: SESSION_TTL_NS,
        ...loginOptionsFromDerivationOrigin(DERIVATION_ORIGIN),
      },
    });
  }
  return client;
}

/** Call when II completes on AuthIiPage (mobile) or popup success (desktop). */
export function markFreshIiLogin(): void {
  restoredSessionPendingStepUp = false;
  lastFreshLoginAt = Date.now();
  try {
    sessionStorage.setItem(II_FRESH_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function consumeFreshIiFlag(): boolean {
  try {
    const raw = sessionStorage.getItem(II_FRESH_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(II_FRESH_KEY);
    const at = Number(raw);
    if (!Number.isFinite(at)) return true;
    return Date.now() - at < FRESH_II_WINDOW_MS;
  } catch {
    return false;
  }
}

export async function restoreIdentity(): Promise<Identity | null> {
  const c = await getAuthClient();
  if (await c.isAuthenticated()) {
    if (consumeFreshIiFlag()) {
      // Just returned from mobile AuthIiPage — do not force another step-up.
      restoredSessionPendingStepUp = false;
      lastFreshLoginAt = Date.now();
    } else {
      restoredSessionPendingStepUp = true;
    }
    return c.getIdentity();
  }
  return null;
}

/** Poll + focus recovery when II popup completes but AuthClient onSuccess does not fire. */
export function watchAuthClientCompletion(
  authClient: AuthClient,
  onComplete: () => void,
): () => void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onComplete();
  };

  const check = async () => {
    if (done) return;
    try {
      if (!(await authClient.isAuthenticated())) return;
      if (authClient.getIdentity().getPrincipal().isAnonymous()) return;
      finish();
    } catch {
      /* ignore */
    }
  };

  const interval = window.setInterval(() => void check(), 750);
  const onFocus = () => void check();
  const onVisibility = () => {
    if (document.visibilityState === "visible") void check();
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

function iiLoginOptions(mode: "popup" | "redirect") {
  return {
    identityProvider: DEFAULT_II_IDENTITY_PROVIDER,
    maxTimeToLive: SESSION_TTL_NS,
    // Match AuthIiPage. false here blocked desktop II accounts that sign in with a PIN.
    allowPinAuthentication: true,
    ...(mode === "popup" ? { windowOpenerFeatures: II_POPUP_WINDOW_FEATURES } : {}),
    ...loginOptionsFromDerivationOrigin(DERIVATION_ORIGIN),
  };
}

/**
 * Desktop popup II login (Hub/Bazaar-sized window). Same Registry derivationOrigin.
 */
export async function loginWithIi(): Promise<Identity> {
  const c = await getAuthClient();
  await new Promise<void>((resolve, reject) => {
    const stopWatch = watchAuthClientCompletion(c, () => resolve());
    void c.login({
      ...iiLoginOptions("popup"),
      onSuccess: () => {
        stopWatch();
        resolve();
      },
      onError: (err) => {
        stopWatch();
        reject(new Error(err ?? "II login failed"));
      },
    });
  });
  markFreshIiLogin();
  return c.getIdentity();
}

export function isCanopyAuthIiPath(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get(AUTH_II_QUERY) === "ii";
  } catch {
    return false;
  }
}

export function saveAuthReturnPath(href?: string): void {
  try {
    sessionStorage.setItem(
      AUTH_RETURN_KEY,
      href ?? window.location.href,
    );
  } catch {
    /* ignore */
  }
}

export function consumeAuthReturnPath(fallback = "/"): string {
  try {
    const v = sessionStorage.getItem(AUTH_RETURN_KEY);
    sessionStorage.removeItem(AUTH_RETURN_KEY);
    if (v) {
      const u = new URL(v);
      u.searchParams.delete(AUTH_II_QUERY);
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

/** Full-page `?auth=ii` — mobile / PWA / TV / iframe breakout. Same principal as popup. */
export function beginCanopyAuthRedirect(opts?: {
  /** Open in a new top-level tab (required when currently nested in an iframe). */
  newTab?: boolean;
}): void {
  saveAuthReturnPath();
  const url = `${CANOPY_ORIGIN}/?${AUTH_II_QUERY}=ii`;
  if (opts?.newTab || (typeof window !== "undefined" && window.parent !== window)) {
    // Top-level tab (not iframe). Omit noopener so return/focus paths stay usable.
    window.open(url, "canopy-auth-ii");
    return;
  }
  window.location.assign(url);
}

export function preferCanopyAuthRedirect(): boolean {
  return preferIiAuthRedirect({
    nestedFrame:
      typeof window !== "undefined" && window.parent !== window,
  });
}

export { isIiConnectFailure };

/**
 * Popup first on desktop; on connect/popup failure, fall back to `?auth=ii`.
 * Callers that already redirected should not invoke this.
 */
export async function loginWithIiOrRedirect(): Promise<Identity | "redirected"> {
  if (preferCanopyAuthRedirect()) {
    beginCanopyAuthRedirect();
    return "redirected";
  }
  try {
    return await loginWithIi();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isIiConnectFailure(msg)) {
      beginCanopyAuthRedirect({ newTab: window.parent !== window });
      return "redirected";
    }
    throw e;
  }
}

export async function logoutIi(): Promise<void> {
  const c = await getAuthClient();
  await c.logout();
  restoredSessionPendingStepUp = false;
  lastFreshLoginAt = 0;
}

export function principalText(identity: Identity): string {
  return identity.getPrincipal().toText();
}

export function needsAmountStepUp(
  amount: bigint,
  decimals: number,
  isIcpLedger: boolean,
): boolean {
  if (amount <= 0n) return false;
  if (isIcpLedger) return amount >= STEP_UP_ICP_E8S;
  // Non-ICP: step-up at ≥ 1 whole token
  return amount >= 10n ** BigInt(Math.max(0, decimals));
}

/**
 * Force a fresh II login when amount is large or session was only restored from storage.
 */
export async function ensureStepUpIfNeeded(opts: {
  amount?: bigint;
  decimals?: number;
  isIcpLedger?: boolean;
  force?: boolean;
}): Promise<Identity> {
  const amountNeed =
    opts.amount != null &&
    needsAmountStepUp(
      opts.amount,
      opts.decimals ?? 8,
      opts.isIcpLedger ?? false,
    );
  const need =
    opts.force === true ||
    amountNeed ||
    restoredSessionPendingStepUp;
  if (!need) {
    const c = await getAuthClient();
    if (!(await c.isAuthenticated())) {
      const result = await loginWithIiOrRedirect();
      if (result === "redirected") {
        throw new Error(
          "CANOPY_II_REDIRECT: Complete Internet Identity, then return — Canopy will continue your send.",
        );
      }
      markFreshIiLogin();
      return result;
    }
    return c.getIdentity();
  }
  // Fresh II (popup or mobile AuthIiPage) — skip automatic step-up unless forced.
  // Mobile redirects cannot wait in-place; re-prompting mid-send aborts the transfer.
  if (Date.now() - lastFreshLoginAt < FRESH_II_WINDOW_MS && !opts.force) {
    restoredSessionPendingStepUp = false;
    const c = await getAuthClient();
    return c.getIdentity();
  }
  // Confirmed pending FT send after mobile II return — never bounce into
  // another redirect; resume path will submit with this session.
  if (!opts.force && loadPendingFtSend()?.confirmed) {
    const c = await getAuthClient();
    if (await c.isAuthenticated()) {
      restoredSessionPendingStepUp = false;
      lastFreshLoginAt = Date.now();
      return c.getIdentity();
    }
  }
  const result = await loginWithIiOrRedirect();
  if (result === "redirected") {
    throw new Error(
      "CANOPY_II_REDIRECT: Complete Internet Identity, then return — Canopy will continue your send.",
    );
  }
  markFreshIiLogin();
  return result;
}

export function clearRestoredStepUpFlag(): void {
  restoredSessionPendingStepUp = false;
}
