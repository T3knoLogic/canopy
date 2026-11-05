/**
 * DEPRECATED — use Internet Identity in Canopy.
 * OISY is only retained in `ic-nft-migrator` for inbound NFT migration (OISY → Canopy / II).
 * Do not import this module from App or spend paths.
 */

const DEAD =
  "OISY is removed from Canopy. Sign in with Internet Identity. For migrating NFTs from OISY into Canopy, use ic-nft-migrator.";

function dead(): never {
  throw new Error(DEAD);
}

/** @deprecated Removed from Canopy — throws if called. */
export const OISY_SIGNER_URL = "https://signer.oisy.com";

/** @deprecated Removed from Canopy — throws if called. */
export function getOisyPrincipal(): string | null {
  return dead();
}

/** @deprecated Removed from Canopy — throws if called. */
export function disconnectOisy(): void {
  dead();
}

/** @deprecated Removed from Canopy — throws if called. */
export async function connectOisy(): Promise<string> {
  return dead();
}

/** @deprecated Removed from Canopy — throws if called. */
export async function oisyTransferIcrc1(_opts: {
  ledgerId: string;
  to: string;
  amount: bigint;
  toMustBeTreasury?: boolean;
}): Promise<bigint> {
  return dead();
}
