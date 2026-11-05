/**
 * Promise bridge for SpendReviewModal — call requestSpendReview() from async flows.
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
import {
  SpendReviewModal,
  type SpendReviewRequest,
} from "../components/SpendReviewModal";

type SpendReviewApi = {
  requestSpendReview: (req: SpendReviewRequest) => Promise<boolean>;
};

const SpendReviewContext = createContext<SpendReviewApi | null>(null);

export function SpendReviewProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<SpendReviewRequest | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const close = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOpen(false);
    setRequest(null);
  }, []);

  const requestSpendReview = useCallback((req: SpendReviewRequest) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setRequest(req);
      setOpen(true);
    });
  }, []);

  const api = useMemo(() => ({ requestSpendReview }), [requestSpendReview]);

  return (
    <SpendReviewContext.Provider value={api}>
      {children}
      <SpendReviewModal
        open={open}
        request={request}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    </SpendReviewContext.Provider>
  );
}

export function useSpendReview(): SpendReviewApi {
  const ctx = useContext(SpendReviewContext);
  if (!ctx) {
    throw new Error("useSpendReview must be used within SpendReviewProvider");
  }
  return ctx;
}
