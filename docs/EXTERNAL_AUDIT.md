# Canopy — External audit brief (A+ marketing gate)

**Status:** Required before Press Desk “hardened / A+” claim.  
**In-house grade after Phases 1–4:** **A / A−**

## Scope

1. **Motoko** `canopy/backend/src/main.mo` — owner, fee caps, receipt/LP DoS, upgrade safety  
2. **Frontend spend paths** — allowlist, treasury pin, SpendReview, step-up, ICPSwap consensus + metadata, II-only sends, CSP/SW  
3. **Threat model** vs live mainnet (`7h6n6…` / `7o5gc…`)

## Deliverables from auditor

- Severity-ranked findings  
- Fix verification pass  
- Written attestation suitable for Hub / Press Desk

## Ops when ready

1. Engage IC-experienced wallet/Motoko auditor  
2. Fix findings in `canopy/`  
3. Re-run `npm run build` + `node scripts/smoke-canopy.mjs`  
4. Tick remaining boxes in [SECURITY_REVIEW.md](./SECURITY_REVIEW.md)  
5. Then Bonsai Press Desk “Canopy hardened” package

Until then: **do not** market “A+” or “unhackable.”
