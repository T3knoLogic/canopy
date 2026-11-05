import { useCallback, useEffect, useRef, useState } from "react";
import { AuthClient } from "@dfinity/auth-client";
import {
  DEFAULT_II_IDENTITY_PROVIDER,
  isIiConnectFailure,
  isMobileBrowser,
  loginOptionsFromDerivationOrigin,
} from "@bonsai-os-sdk";
import {
  consumeAuthReturnPath,
  getAuthClient,
  markFreshIiLogin,
  SESSION_TTL_NS,
  watchAuthClientCompletion,
} from "../lib/auth";
import { DERIVATION_ORIGIN } from "../lib/constants";

/**
 * Top-level II surface for mobile / PWA / iframe breakout.
 * Require an explicit tap before AuthClient.login (user gesture).
 * Same Registry derivationOrigin as desktop popup → same principal.
 */
export function AuthIiPage() {
  const authClientRef = useRef<AuthClient | null>(null);
  const unwatchRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<
    "checking" | "idle" | "waiting" | "error"
  >("checking");
  const [error, setError] = useState<string | null>(null);

  const finishSuccess = useCallback((client: AuthClient) => {
    unwatchRef.current?.();
    unwatchRef.current = null;
    void client.isAuthenticated().then(() => {
      // Mobile return must not re-trigger step-up (that aborted FT sends).
      markFreshIiLogin();
      window.location.replace(consumeAuthReturnPath("/"));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const authClient = await getAuthClient();
        if (cancelled) return;
        authClientRef.current = authClient;
        if (await authClient.isAuthenticated()) {
          const existing = authClient.getIdentity();
          if (!existing.getPrincipal().isAnonymous()) {
            finishSuccess(authClient);
            return;
          }
        }
        setStatus("idle");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Could not prepare Internet Identity",
        );
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      unwatchRef.current?.();
      unwatchRef.current = null;
    };
  }, [finishSuccess]);

  const handleContinue = useCallback(() => {
    setError(null);
    setStatus("waiting");

    void (async () => {
      try {
        const authClient =
          authClientRef.current ?? (await getAuthClient());
        authClientRef.current = authClient;

        if (await authClient.isAuthenticated()) {
          const existing = authClient.getIdentity();
          if (!existing.getPrincipal().isAnonymous()) {
            finishSuccess(authClient);
            return;
          }
        }

        unwatchRef.current?.();
        unwatchRef.current = watchAuthClientCompletion(authClient, () =>
          finishSuccess(authClient),
        );

        await authClient.login({
          identityProvider: DEFAULT_II_IDENTITY_PROVIDER,
          maxTimeToLive: SESSION_TTL_NS,
          allowPinAuthentication: true,
          ...loginOptionsFromDerivationOrigin(DERIVATION_ORIGIN),
          onSuccess: () => finishSuccess(authClient),
          onError: (message) => {
            unwatchRef.current?.();
            unwatchRef.current = null;
            const msg = message ?? "Internet Identity login failed";
            // Passkey / "Unable to connect" — retry once on identity.ic0.app
            if (isIiConnectFailure(msg)) {
              void (async () => {
                try {
                  unwatchRef.current = watchAuthClientCompletion(authClient, () =>
                    finishSuccess(authClient),
                  );
                  await authClient.login({
                    identityProvider: "https://identity.ic0.app",
                    maxTimeToLive: SESSION_TTL_NS,
                    allowPinAuthentication: true,
                    ...loginOptionsFromDerivationOrigin(DERIVATION_ORIGIN),
                    onSuccess: () => finishSuccess(authClient),
                    onError: (m2) => {
                      unwatchRef.current?.();
                      unwatchRef.current = null;
                      setError(
                        "This browser could not finish Internet Identity. Use Chrome or Edge (not an in-app browser), allow popups, or connect on t3kno-logic.xyz Account first then Sync.",
                      );
                      setStatus("error");
                    },
                  });
                } catch {
                  setError(
                    "This browser could not finish Internet Identity. Use Chrome or Edge, or connect on t3kno-logic.xyz Account first.",
                  );
                  setStatus("error");
                }
              })();
              return;
            }
            setError(msg);
            setStatus("error");
          },
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not start Internet Identity",
        );
        setStatus("error");
      }
    })();
  }, [finishSuccess]);

  return (
    <div className="app canopy-auth-ii">
      <main className="shell" style={{ maxWidth: 420, margin: "4rem auto" }}>
        {status === "error" ? (
          <>
            <p className="muted" style={{ color: "var(--danger, #f87171)" }}>
              {error}
            </p>
            <button type="button" className="btn primary" onClick={handleContinue}>
              Try again
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                window.location.replace(consumeAuthReturnPath("/"))
              }
            >
              Return to Canopy
            </button>
          </>
        ) : status === "waiting" ? (
          <>
            <p className="muted">
              {isMobileBrowser()
                ? "Complete sign-in in the Internet Identity tab (id.ai). Switch back here when done."
                : "Complete sign-in with Internet Identity. This page returns automatically."}
            </p>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                window.location.replace(consumeAuthReturnPath("/"))
              }
            >
              Cancel and return
            </button>
          </>
        ) : status === "checking" ? (
          <p className="muted">Preparing Internet Identity…</p>
        ) : (
          <>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem" }}>
              Sign in with Internet Identity
            </h1>
            <p className="muted">
              Tap below to open id.ai. Use the same passkey as Hub &amp; Bazaar so
              your principal matches.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={handleContinue}
              style={{ marginTop: "1rem", minHeight: 44 }}
            >
              Continue with Internet Identity
            </button>
          </>
        )}
      </main>
    </div>
  );
}
