import { useCallback, useEffect, useState } from "react";
import {
  activityKindLabel,
  formatActivityTime,
  type ActivityEntry,
} from "../lib/activity";
import {
  disconnectConnectedApp,
  formatConnectedTime,
  KNOWN_APP_CATALOG,
  loadConnectedApps,
  loadDeniedOrigins,
  reconnectKnownApp,
  type ConnectedApp,
} from "../lib/connectedApps";

type Props = {
  entries: ActivityEntry[];
  onClear?: () => void;
  /** Fired after connect/disconnect so parent can log activity. */
  onAppsChanged?: (info: {
    action: "disconnect" | "reconnect";
    name: string;
    origin: string;
  }) => void;
};

type Pane = "activity" | "apps";

export function ActivityStrip({ entries, onClear, onAppsChanged }: Props) {
  const [pane, setPane] = useState<Pane>("activity");
  const [apps, setApps] = useState<ConnectedApp[]>(() =>
    typeof window !== "undefined" ? loadConnectedApps() : [],
  );
  const [denied, setDenied] = useState<string[]>(() =>
    typeof window !== "undefined" ? loadDeniedOrigins() : [],
  );

  const reloadApps = useCallback(() => {
    setApps(loadConnectedApps());
    setDenied(loadDeniedOrigins());
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") reloadApps();
    };
    window.addEventListener("focus", reloadApps);
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(reloadApps, 8_000);
    return () => {
      window.removeEventListener("focus", reloadApps);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, [reloadApps]);

  const top = entries.slice(0, 12);
  const deniedKnown = KNOWN_APP_CATALOG.filter((k) =>
    k.origins.some((o) => denied.includes(o)),
  );

  return (
    <section className="activity-strip glass-panel" aria-label="Activity and connections">
      <div className="activity-strip__head">
        <div className="activity-strip__tabs" role="tablist" aria-label="Activity panes">
          <button
            type="button"
            role="tab"
            aria-selected={pane === "activity"}
            className={`activity-strip__tab${pane === "activity" ? " is-active" : ""}`}
            onClick={() => setPane("activity")}
          >
            Activity
            {entries.length ? (
              <span className="activity-strip__count">{Math.min(entries.length, 99)}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === "apps"}
            className={`activity-strip__tab${pane === "apps" ? " is-active" : ""}`}
            onClick={() => setPane("apps")}
          >
            Apps
            {apps.length ? (
              <span className="activity-strip__count">{apps.length}</span>
            ) : null}
          </button>
        </div>
        {pane === "activity" && onClear && entries.length > 0 ? (
          <button type="button" className="btn activity-strip__clear" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>

      {pane === "activity" ? (
        top.length === 0 ? (
          <p className="muted activity-strip__empty">
            Sends, receives, NFT transfers, listings, and cycles ops show up here.
          </p>
        ) : (
          <ul className="activity-strip__list">
            {top.map((e) => (
              <li key={e.id} className={`activity-strip__item activity-strip__item--${e.kind}`}>
                <div className="activity-strip__main">
                  <div className="activity-strip__title-row">
                    <span className="activity-strip__kind">{activityKindLabel(e.kind)}</span>
                    <strong>{e.title}</strong>
                  </div>
                  <span className="muted activity-strip__time">
                    {formatActivityTime(e.at)}
                  </span>
                </div>
                <p className="muted activity-strip__detail">{e.detail}</p>
                {e.href ? (
                  <a
                    className="activity-strip__link"
                    href={e.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on dashboard
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="activity-apps">
          <p className="muted activity-strip__lead">
            Surfaces that synced or embedded Canopy. Disconnect stops wallet-sync
            from that origin inside Canopy — Internet Identity on the app itself is
            unchanged (manage at{" "}
            <a href="https://id.ai" target="_blank" rel="noreferrer">
              id.ai
            </a>
            ).
          </p>

          {apps.length === 0 ? (
            <p className="muted activity-strip__empty">
              No connected surfaces yet. Open Canopy from Hub, Bazaar, or Radio to
              register a sync.
            </p>
          ) : (
            <ul className="activity-apps__list">
              {apps.map((app) => (
                <li key={app.id} className="activity-apps__row">
                  <div className="activity-apps__meta">
                    <strong>{app.name}</strong>
                    <span className="muted mono activity-apps__origin">{app.origin}</span>
                    <span className="muted activity-apps__seen">
                      Last sync {formatConnectedTime(app.lastSeenAt)}
                    </span>
                  </div>
                  <div className="activity-apps__ops">
                    <a
                      className="btn btn--slim"
                      href={app.origin}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      className="btn btn--slim activity-apps__disconnect"
                      onClick={() => {
                        const removed = disconnectConnectedApp(app.id);
                        reloadApps();
                        if (removed) {
                          onAppsChanged?.({
                            action: "disconnect",
                            name: removed.name,
                            origin: removed.origin,
                          });
                        }
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {deniedKnown.length > 0 ? (
            <div className="activity-apps__denied">
              <h3 className="activity-apps__denied-title">Blocked sync</h3>
              <ul className="activity-apps__list">
                {deniedKnown.map((k) => (
                  <li key={k.id} className="activity-apps__row">
                    <div className="activity-apps__meta">
                      <strong>{k.name}</strong>
                      <span className="muted">Wallet-sync denied</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn--slim"
                      onClick={() => {
                        reconnectKnownApp(k.id);
                        reloadApps();
                        onAppsChanged?.({
                          action: "reconnect",
                          name: k.name,
                          origin: k.origins[0]!,
                        });
                      }}
                    >
                      Allow again
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
