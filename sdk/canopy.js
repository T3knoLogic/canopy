/**
 * Open the hosted Canopy wallet from another app.
 * No dependency on the Bonsai monorepo. This does not sign or move funds.
 *
 * @example
 * import { openCanopy, canopyUrl } from "./canopy.js";
 * openCanopy({ tab: "tokens" });
 */

export const CANOPY_ORIGIN = "https://7h6n6-eqaaa-aaaau-ag6da-cai.icp0.io";

/** Registry assets origin. Bonsai apps that use this derivation share the Canopy principal. */
export const CANOPY_DERIVATION_ORIGIN =
  "https://u2jsa-baaaa-aaaau-aghea-cai.icp0.io";

/**
 * @param {{ embed?: boolean, tab?: "tokens" | "nfts" | "manage" | "cycles" }} [opts]
 */
export function canopyUrl(opts = {}) {
  const url = new URL(`${CANOPY_ORIGIN}/`);
  if (opts.embed) url.searchParams.set("embed", "os");
  if (opts.tab) url.searchParams.set("tab", opts.tab);
  return url.toString();
}

/**
 * Open Canopy in a new tab. Third-party sites must not iframe Canopy:
 * `frame-ancestors` only allows Bonsai hosts.
 *
 * @param {{ embed?: boolean, tab?: "tokens" | "nfts" | "manage" | "cycles" }} [opts]
 * @returns {string}
 */
export function openCanopy(opts = {}) {
  const url = canopyUrl({ ...opts, embed: false });
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return url;
}
