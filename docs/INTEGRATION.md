# Integrate Canopy

Canopy is a non-custodial ICP wallet. The user signs with Internet Identity. Apps do not receive a session that can spend in the background.

Live wallet: https://7h6n6-eqaaa-aaaau-ag6da-cai.icp0.io/

Helper (no install required): [`sdk/canopy.js`](../sdk/canopy.js)

## What you can do

| Need | Do this |
|------|---------|
| Ask the user to send ICP or an ICRC token | `openCanopy({ tab: "tokens" })` — they paste your principal and confirm in Canopy |
| Ask the user to send an NFT | `openCanopy({ tab: "nfts" })` — ICRC-7 and EXT |
| Same principal as Hub, Bazaar, Radio, Works | Set Internet Identity `derivationOrigin` to `https://u2jsa-baaaa-aaaau-aghea-cai.icp0.io` |
| Embed Canopy in an iframe | Only from a host already in Canopy `frame-ancestors` (Bonsai OS, Registry, Bazaar, bonsaios.app). Other origins are refused so the wallet cannot be clickjacked |

## What this is not

Canopy does not implement a public ICRC-25 / ICRC-49 signer popup. Do not point `@dfinity/oisy-wallet-signer` at the Canopy origin. A connect call there will not approve transfers.

There is no API key. There is no custodial send endpoint.

## Open the wallet

```js
import { openCanopy } from "./sdk/canopy.js";

document.querySelector("#fund").onclick = () => {
  openCanopy({ tab: "tokens" });
};
```

`openCanopy` uses `window.open` with `noopener`. Pass the destination principal in your own UI and tell the user to paste it into Canopy Send. Canopy does not accept a `to=` query that could pre-fill a payee from an untrusted site.

## Same principal (Bonsai apps)

Bonsai apps that must pay as the Canopy user use Internet Identity with:

```txt
identityProvider: https://id.ai
derivationOrigin: https://u2jsa-baaaa-aaaau-aghea-cai.icp0.io
```

That principal is the Canopy account. The app still builds its own agent and the user still approves each Internet Identity prompt. Canopy’s spend allowlist does not apply inside your app — your app is the signer for its own calls.

## Embed (Bonsai hosts only)

```txt
https://7h6n6-eqaaa-aaaau-ag6da-cai.icp0.io/?embed=os&tab=nfts
```

The parent must already be signed in with the Registry derivation and must relay the Bonsai OS wallet-sync message. A foreign iframe is blocked by `frame-ancestors` in `frontend/public/.ic-assets.json5`.

To add a host, the origin has to be added there and the frontend assets canister redeployed. Do not set `frame-ancestors` to `*`.

## Build from this repo

Canopy’s UI imports `@bonsai-os-sdk` and `@t3kno/ic-nft-aggregator` from the Bonsai monorepo (`shared/` and `packages/` next to `canopy/`). A clone of this folder alone will not `npm install` until those paths exist.

Integrators do not need that build. Use the hosted wallet and `sdk/canopy.js`.

## Send rails (so you tell users the right destination)

| Asset | Destination |
|-------|-------------|
| ICP | Principal, ICRC-1 account (`principal-<base32 checksum>.<subaccount>`), **or** 64-character Account ID (checksum checked) |
| Other ICRC-1 tokens | Principal or ICRC account |
| ICRC-7 NFTs | Principal or ICRC account |
| EXT NFTs | Principal only |
| DIP721 | Not sent inside Canopy — [IC NFT Migrator](https://cy2qi-siaaa-aaaau-ag32a-cai.icp0.io) |

Sends **to** a non-default subaccount use the ICRC account text. Balances Canopy shows, and sends **from** this wallet, are still the default subaccount.
