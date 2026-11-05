# Canopy — Security review checklist (pre–public hardened / A+ claim)

Use before marketing “hardened” or A+ Canopy.

- [x] Threat model reviewed: [THREAT_MODEL.md](./THREAT_MODEL.md) (8h II / 15m idle)
- [x] Spend allowlist matches [ALLOWLIST.md](./ALLOWLIST.md) + live DEX factory pools only (Kong/ICLighthouse deep-link)
- [x] CSP / `.ic-assets.json5` frame-ancestors limited to Hub + bonsaios.app (no `*.icp0.io` wildcard)
- [x] No Transfer secrets in repo or chat
- [x] Fee bps caps verified on-chain (`getConfig`) — owner locked
- [x] SpendReview modal → confirm on send / swap / cycles / LP (full principals)
- [x] Step-up II on large notional / restored session
- [x] ICPSwap multi-gateway + pool metadata verify + revoke allowance
- [x] Spend paths II-only (`executeFtSend` / related); OISY quarantined — live OISY only in `ic-nft-migrator` (inbound)
- [x] II derivation = Registry; alt-origins includes Canopy frontend
- [ ] Bugbot / security-review pass on `canopy/` + Hub embed *(agents need git-diffable branch; run manually before A+ claim)*
- [ ] **External** Motoko + frontend wallet audit clean — see [EXTERNAL_AUDIT.md](./EXTERNAL_AUDIT.md)
- [x] Separate from Eliza agent-ic-wallet
- [x] SW network-only HTML (v3+)
- [x] Custom Manage ledgers require unverified ack in SpendReview

**Live:** https://7h6n6-eqaaa-aaaau-ag6da-cai.icp0.io/  
**Fees:** `7o5gc-syaaa-aaaau-ag6cq-cai`

**Grade claim:** In-house path targets **A / A−**. Marketing **A+ / hardened** only after external audit boxes above.
