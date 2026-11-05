# Canopy — Security audit (2026-09-03 → A+ path)

## Grade

| Claim | Status |
|-------|--------|
| In-house **A / A−** | Shipped Phases 1–4 |
| Marketed **A+** | Blocked on [EXTERNAL_AUDIT.md](./EXTERNAL_AUDIT.md) |

## Debug

- `npm run build`: pass (code-split: index ~89kB gz, three/nft lazy)
- Smoke: CSP + SW checks added

## Phases shipped

1. **SpendReview** modal + II step-up (large / restored session)  
2. ICPSwap multi-gateway + **pool metadata** verify + session fingerprint + **always revoke** allowance  
3. ~~**OISY** host-origin connect + allowlisted ICRC transfer~~ → **superseded:** Canopy is II-only; OISY inbound migration only in `ic-nft-migrator`  
4. Unverified Manage ack, **EXT** send, vite chunks, smoke CSP/SW  
5. Docs + EXTERNAL_AUDIT brief; Bugbot/security-review agents could not diff monorepo root — manual review documented

## Live

- Frontend `7h6n6…` · Fees `7o5gc…` · Owner locked · micro fees
