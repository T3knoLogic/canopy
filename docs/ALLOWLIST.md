# Canopy — Allowlisted call targets

Frontend spend paths must only target these principals. Discovery queries may hit additional public APIs (e.g. ICPSwap info HTTP).

> **OISY exception:** Live OISY signing is not used in Canopy. Inbound NFT migration from OISY → Canopy/II stays in `ic-nft-migrator` only.

## System / NNS

| Role | Canister |
|------|----------|
| ICP ledger | `ryjl3-tyaaa-aaaaa-aaaba-cai` |
| CMC | `rkp4c-7iaaa-aaaaa-aaaca-cai` |
| Cycles ledger | `um5iw-rqaaa-aaaaq-qaaba-cai` |
| Management | `aaaaa-aa` (deposit_cycles via cycles ledger withdraw only) |

## Bonsai ecosystem

| Role | Canister |
|------|----------|
| Canopy fees | *(deployed `canopy_fees` id — see canister_ids.json)* |
| Bazaar treasury (default fee sink) | `j7j3j-2iaaa-aaaau-agwla-cai` |
| Bazaar shared ICRC-7 | `ivgzt-yyaaa-aaaau-agwma-cai` |
| Collection assets | `n42s3-syaaa-aaaau-agwqa-cai` |
| Market registry | `jyi55-xqaaa-aaaau-agwlq-cai` |
| II derivation (Registry assets) | `u2jsa-baaaa-aaaau-aghea-cai` |

## NFT collections (session)

Owned NFT collection canisters are **session-allowlisted** when discovered in holdings, restored from snapshot, added in Manage, or sent after SpendReview (`allowLedgerSpend`).

| Standard | Rule |
|----------|------|
| ICRC-7 | Allow on holdings load + send |
| EXT / index | Allow on holdings load + send — **no static EXT catalog**; partner cans (GNight `lisfk-…`, Pokedbots, RW, …) must transfer without a hardcoded allowlist entry |
| DIP721 | Allow when sensed in Manage |

Static `SPEND_ALLOWLIST` does **not** need every EXT canister id. FT / swap / cycles targets stay tightly seeded; NFT transfer targets widen only for cans the user already holds or explicitly sends.

## DEX

| Venue | Canister / note |
|-------|-----------------|
| ICPSwap SwapFactory | `4mmnk-kiaaa-aaaag-qbllq-cai` |
| ICPSwap TokenList | `k37c6-riaaa-aaaag-qcyza-cai` |
| ICPSwap PasscodeManager | `7eikv-2iaaa-aaaag-qdgwa-cai` |
| ICPSwap SwapCalculator | `phr2m-oyaaa-aaaag-qjuoq-cai` |
| ICPSwap pools | Resolved via factory `getPool` — **≥2 IC gateways must agree** + pool `metadata` verify; session fingerprint refuses mid-flow pool id change |
| Canopy fees | `7o5gc-syaaa-aaaau-ag6cq-cai` |
| Canopy frontend | `7h6n6-eqaaa-aaaau-ag6da-cai` |
| KongSwap | **Deep-link only** until multi-gateway + metadata consensus matches ICPSwap |
| ICLighthouse | **Deep-link only** (verified candid later) |

## Auth / signer origins

| Service | Origin |
|---------|--------|
| Internet Identity | `https://identity.ic0.app` / `https://id.ai` |
| Canopy frontend | Deployed `*.icp0.io` assets canister |

## HTTP (read-only)

- `https://api.icpswap.com/` — token/pool info
- `https://*.raw.icp0.io/` / `https://*.raw.ic0.app/` — NFT / asset media (`img-src` + `connect-src`; `*.icp0.io` alone does **not** match `canister.raw.icp0.io`)
