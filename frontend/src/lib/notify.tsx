/**
 * Canopy toast + top status bar — UX only; never initiates transfers.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "info" | "progress";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  /** 0–1 for progress toasts */
  progress?: number;
  sticky?: boolean;
};

export type StatusBarState = {
  label: string;
  /** 0–1 indeterminate when omitted */
  progress?: number;
} | null;

type NotifyApi = {
  toast: (opts: {
    kind: ToastKind;
    title: string;
    detail?: string;
    progress?: number;
    sticky?: boolean;
    ttlMs?: number;
  }) => string;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
  dismiss: (id: string) => void;
  clearToasts: () => void;
  setStatusBar: (bar: StatusBarState) => void;
};

const NotifyContext = createContext<NotifyApi | null>(null);

let toastSeq = 0;
function nextId(): string {
  toastSeq += 1;
  return `t${Date.now()}-${toastSeq}`;
}

const DEFAULT_TTL: Record<ToastKind, number> = {
  success: 5200,
  info: 4200,
  error: 0, // sticky unless ttl set
  progress: 0,
};

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [bar, setBar] = useState<StatusBarState>(null);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    for (const t of timers.current.values()) window.clearTimeout(t);
    timers.current.clear();
    setToasts([]);
  }, []);

  const toast = useCallback(
    (opts: {
      kind: ToastKind;
      title: string;
      detail?: string;
      progress?: number;
      sticky?: boolean;
      ttlMs?: number;
    }) => {
      const id = nextId();
      const sticky =
        opts.sticky ??
        (opts.kind === "error" || opts.kind === "progress");
      const item: ToastItem = {
        id,
        kind: opts.kind,
        title: opts.title,
        detail: opts.detail,
        progress: opts.progress,
        sticky,
      };
      setToasts((prev) => [...prev.slice(-4), item]);
      const ttl =
        opts.ttlMs ??
        (sticky ? 0 : DEFAULT_TTL[opts.kind]);
      if (ttl > 0) {
        const handle = window.setTimeout(() => dismiss(id), ttl);
        timers.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
  );

  const success = useCallback(
    (title: string, detail?: string) => {
      toast({ kind: "success", title, detail });
    },
    [toast],
  );

  const error = useCallback(
    (title: string, detail?: string) => {
      toast({ kind: "error", title, detail, sticky: true });
    },
    [toast],
  );

  const info = useCallback(
    (title: string, detail?: string) => {
      toast({ kind: "info", title, detail });
    },
    [toast],
  );

  const setStatusBar = useCallback((next: StatusBarState) => {
    setBar(next);
  }, []);

  const api = useMemo(
    () => ({
      toast,
      success,
      error,
      info,
      dismiss,
      clearToasts,
      setStatusBar,
    }),
    [toast, success, error, info, dismiss, clearToasts, setStatusBar],
  );

  return (
    <NotifyContext.Provider value={api}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <>
              <StatusBar bar={bar} />
              <ToastStack toasts={toasts} onDismiss={dismiss} />
            </>,
            document.body,
          )
        : null}
    </NotifyContext.Provider>
  );
}

export function useNotify(): NotifyApi {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error("useNotify must be used within NotifyProvider");
  return ctx;
}

function StatusBar({ bar }: { bar: StatusBarState }) {
  if (!bar) return null;
  const pct =
    bar.progress != null && Number.isFinite(bar.progress)
      ? Math.max(0, Math.min(1, bar.progress))
      : null;
  return (
    <div
      className="canopy-status-bar"
      role="status"
      aria-live="polite"
      aria-busy={pct == null || pct < 1}
    >
      <div className="canopy-status-bar__track">
        <div
          className={
            pct == null
              ? "canopy-status-bar__fill canopy-status-bar__fill--indeterminate"
              : "canopy-status-bar__fill"
          }
          style={pct != null ? { width: `${pct * 100}%` } : undefined}
        />
      </div>
      <p className="canopy-status-bar__label">{bar.label}</p>
    </div>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="canopy-toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`canopy-toast canopy-toast--${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
        >
          <div className="canopy-toast__body">
            <strong className="canopy-toast__title">{t.title}</strong>
            {t.detail ? (
              <p className="canopy-toast__detail">{t.detail}</p>
            ) : null}
            {t.kind === "progress" && t.progress != null ? (
              <div className="canopy-toast__progress">
                <div
                  className="canopy-toast__progress-fill"
                  style={{
                    width: `${Math.max(0, Math.min(1, t.progress)) * 100}%`,
                  }}
                />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="canopy-toast__close"
            aria-label="Dismiss"
            onClick={() => onDismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
