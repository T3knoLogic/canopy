# Canopy — Bonsai OS Wallet

Non-custodial ICP wallet for Bonsai OS. Tagline: **Hold the grove.**

## Mainnet

| Canister | Role |
|----------|------|
| `canopy_fees` | Fee config + receipts (no custody) |
| `canopy_frontend` | Assets UI |

II derivation: Registry `https://u2jsa-baaaa-aaaau-aghea-cai.icp0.io` (same principal as Hub / Bazaar).

## Develop

```bash
# Windows recommended for Vite
cd canopy/frontend && npm install && npm run build

# Smoke (after deploy or against local preview origin)
node scripts/smoke-canopy.mjs
# CANOPY_ORIGIN=http://127.0.0.1:5188 node scripts/smoke-canopy.mjs

# WSL for dfx
export DFX_WARNING=-mainnet_plaintext_identity
cd /mnt/r/REPOSITORIES/canopy
dfx deploy canopy_fees --network ic
dfx deploy canopy_frontend --network ic --mode upgrade
```

PWA: `manifest.webmanifest` + `sw.js`, custom favicons under `/brand/`, OG card at `/brand/og-image.png`.

Set `VITE_CANOPY_FEES_CANISTER=<id>` before frontend build, or `localStorage.canopy_fees_canister`.

## Integrate

Other apps open the hosted wallet. They do not get a signing key.

- [Integration guide](docs/INTEGRATION.md)
- Zero-dependency helper: `sdk/canopy.js` (`openCanopy({ tab: "tokens" })`)
- License: MIT

Do not iframe Canopy from a site that is not already in `frame-ancestors`. Do not point an ICRC signer library at this origin.

## Docs

- [Integration](docs/INTEGRATION.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Allowlist](docs/ALLOWLIST.md)
