# Canopy — Agent Guide

- Non-custodial only. Never add hot keys or agent-ic-wallet into this UX.
- II: Registry derivation via `frontend/src/lib/auth.ts`.
- Fees: `backend/src/main.mo` — config + receipts only.
- Images: direct ledger/asset URLs (`preferDirectNftImage`) — no Entrepot primary.
- Deploy: build frontend on Windows; `dfx` on WSL with `DFX_WARNING=-mainnet_plaintext_identity`.
- Hub: widget id `canopy` in Registry `hubRegistry.ts`.
- Bazaar header embeds Canopy via iframe `?embed=os&tab=nfts` (see `ic-nft-marketplace` `WalletCluster` + `lib/canopyEmbed.ts`). Canopy `frame-ancestors` must include Bazaar assets (`iabi6-…`); Bazaar `frame-src` must include Canopy (`7h6n6-…`).

## ICP send (locked — do not regress)

- **Principal** → ICRC-1 `icrc1_transfer` (`ledger.ts` `transferIcrc1`)
- **Account ID** (64-hex, **CRC32 required**; dashes/spaces stripped) → `send_dfx` primary (same as Bazaar EXT) + classic `transfer` fallback (`ledger.ts` `transferIcpToAccountId`, **Nat64** e8s)
- Never use `e8s: Nat` (wrong encoding)
- Validate Account ID checksum in `parseDestination` **before** fee payment
- Gate: `npm run verify:icp-send` (also runs on `npm run build`)
- Confirm live rail: Send sheet shows **Send rail v5**
- Mobile: AuthIiPage marks fresh II; step-up must not redirect mid-send; `pendingFtSend` auto-resumes after II return (Retry send is fallback) + sticky in-sheet error

## Smoke (after Canopy + Bazaar asset deploys)

1. Bazaar header → open Canopy panel → iframe loads (not blank / CSP blocked).
2. Sign in inside Canopy if prompted (same Registry II principal as Bazaar).
3. Tokens → tap ICP → Send: tiny amount to a **principal**, then (if testing) to an **Account ID** — both must complete (SpendReview → II if stepped up → success toast). Do not send user funds unless explicitly ordered.
4. NFTs tab → Bulk send → checkbox one NFT; collection “Select all”; experimental “Select all wallet” shows risk confirm.
5. Fee quote / batch cap `NFT_BULK_SEND_UI_CAP` (50) visible; do not transfer customer funds unless explicitly ordered.
6. Bazaar Log out clears marketplace session; marketplace buy/mint path unchanged.
