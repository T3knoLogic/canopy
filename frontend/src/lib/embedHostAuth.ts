/**
 * Embed SSO: when Canopy runs in a Bazaar/Hub iframe (`?embed=os`), request a
 * sub-delegation from the parent II session instead of a second login popup.
 */
import type { Identity } from "@dfinity/agent";
import {
  DelegationChain,
  DelegationIdentity,
  Ed25519KeyIdentity,
} from "@dfinity/identity";
import {
  HUB_EMBED_REQUEST,
  OS_GUEST_READY,
  OS_II_DELEGATION_REQUEST,
  OS_WALLET_SYNC,
  derBytesToBase64,
  isOsMessage,
  postOsMessageToParent,
  osHostRelayTarget,
} from "@bonsai-os-sdk";
import {
  isOriginDenied,
  touchConnectedApp,
} from "./connectedApps";

const CANOPY_APP_ID = "canopy";

/** Register with Hub/Bazaar host so wallet-sync broadcasts reach this iframe. */
function announceCanopyGuestReady(): void {
  const target = osHostRelayTarget();
  if (!target) return;
  postOsMessageToParent(
    { type: OS_GUEST_READY, appId: CANOPY_APP_ID, embedMode: "os" },
    target,
  );
}

let embedSessionKey: Ed25519KeyIdentity | null = null;

export async function ensureCanopyEmbedSessionKey(): Promise<Ed25519KeyIdentity> {
  if (!embedSessionKey) {
    embedSessionKey = await Ed25519KeyIdentity.generate();
  }
  return embedSessionKey;
}

export function identityFromHostDelegation(
  delegationChainJson: string,
): Identity | null {
  if (!embedSessionKey || !delegationChainJson) return null;
  try {
    const chain = DelegationChain.fromJSON(delegationChainJson);
    return DelegationIdentity.fromDelegation(embedSessionKey, chain);
  } catch {
    return null;
  }
}

export function requestCanopyHostDelegation(appId = CANOPY_APP_ID): void {
  void ensureCanopyEmbedSessionKey().then((key) => {
    const target = osHostRelayTarget();
    if (!target) return;
    postOsMessageToParent(
      {
        type: OS_II_DELEGATION_REQUEST,
        publicKeyDerBase64: derBytesToBase64(key.getPublicKey().toDer()),
        appId,
      },
      target,
    );
  });
}

export type HostWalletSyncHandler = (opts: {
  principal: string;
  identity: Identity | null;
}) => void;

/**
 * Listen for host wallet-sync and request sub-delegation. Returns cleanup.
 */
export function installCanopyHostAuthSync(
  onSync: HostWalletSyncHandler,
): () => void {
  if (typeof window === "undefined") return () => {};

  void ensureCanopyEmbedSessionKey();

  function onMessage(event: MessageEvent) {
    if (event.data?.type === HUB_EMBED_REQUEST) {
      announceCanopyGuestReady();
      requestCanopyHostDelegation();
      return;
    }
    if (!isOsMessage(event.data) || event.data.type !== OS_WALLET_SYNC) return;
    if (!("session" in event.data) || !event.data.session) return;

    const origin = typeof event.origin === "string" ? event.origin : "";
    if (origin && isOriginDenied(origin)) return;

    const session = event.data.session as {
      principal?: string | null;
      delegationChainJson?: string | null;
      hostOrigin?: string | null;
    };
    const principal = session.principal?.trim() ?? "";
    if (!principal || principal === "aaaaa-aa") return;

    const hostOrigin =
      (typeof session.hostOrigin === "string" && session.hostOrigin) || origin;
    if (hostOrigin) touchConnectedApp(hostOrigin, "embed");

    const chainJson = session.delegationChainJson?.trim() || "";
    const identity = chainJson ? identityFromHostDelegation(chainJson) : null;
    onSync({ principal, identity });

    if (!identity) {
      requestCanopyHostDelegation();
    }
  }

  window.addEventListener("message", onMessage);
  announceCanopyGuestReady();
  requestCanopyHostDelegation();
  const t1 = window.setTimeout(() => requestCanopyHostDelegation(), 1500);
  const t2 = window.setTimeout(() => requestCanopyHostDelegation(), 4000);

  return () => {
    window.removeEventListener("message", onMessage);
    window.clearTimeout(t1);
    window.clearTimeout(t2);
  };
}
