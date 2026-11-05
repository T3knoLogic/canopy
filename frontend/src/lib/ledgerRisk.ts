/**
 * Whether a ledger / NFT collection is user Manage-added (unverified risk).
 */
import { loadWalletNfts, loadWalletTokens } from "./wallet/registry";

export function isUnverifiedLedger(ledgerId: string): boolean {
  const id = ledgerId.trim().toLowerCase();
  return loadWalletTokens().some((t) => t.id === id && t.source === "manual");
}

export function isUnverifiedNftCollection(collectionId: string): boolean {
  const id = collectionId.trim().toLowerCase();
  return loadWalletNfts().some((n) => n.id === id && n.source === "manual");
}
