import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setDgdgProxyCanisterId } from "@t3kno/ic-nft-aggregator";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import { App } from "./App";
import { AuthIiPage } from "./pages/AuthIiPage";
import { isCanopyAuthIiPath } from "./lib/auth";
import { SpendReviewProvider } from "./lib/spendReview";
import { NotifyProvider } from "./lib/notify";
import "./styles.css";
import { PlatformAgeGate } from "@bonsai-os-sdk";

const holdingsProxy =
  (
    import.meta as ImportMeta & { env?: Record<string, string> }
  ).env?.VITE_HOLDINGS_PROXY_CANISTER_ID?.trim() ||
  (
    import.meta as ImportMeta & { env?: Record<string, string> }
  ).env?.VITE_DGDG_PROXY_CANISTER_ID?.trim() ||
  "cb7jx-baaaa-aaaau-agxuq-cai";
setDgdgProxyCanisterId(holdingsProxy);

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(
  <StrictMode>
    {isCanopyAuthIiPath() ? (
      <AuthIiPage />
    ) : (
      <PlatformAgeGate>
        <NotifyProvider>
          <SpendReviewProvider>
            <App />
          </SpendReviewProvider>
        </NotifyProvider>
      </PlatformAgeGate>
    )}
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  const isProd = !(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env
    ?.DEV;
  if (isProd) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installable shell is best-effort */
      });
    });
  }
}
