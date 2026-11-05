# Canopy — Threat Model

**Product:** Canopy (Bonsai OS Wallet)  
**Custody:** Non-custodial. Keys live in Internet Identity (passkey). Canopy never stores private keys or seed phrases. OISY remains only in `ic-nft-migrator` for inbound NFT migration into a Canopy/II principal.

## Assets we protect

| Asset | Sensitivity |
|-------|-------------|
| User ICP / ICRC-1 balances | Critical — user signs every move |
| User NFTs (ICRC-7 / EXT / DIP721) | Critical — user signs transfers |
| II session delegation (**≤8h**, idle **15m**) | High — browser storage |
| Fee config / treasury routing | Medium — owner-gated Motoko |

## Trust boundaries

```
[User device] --II--> [Canopy frontend assets] --query--> [Ledgers / DEX / CMC]
                              | signed updates only from user
                              v
                         [canopy_fees]  (config + receipts; no token custody)
```

Compromise of `canopy_fees` or frontend **cannot** move user funds without a fresh II signature on a ledger/DEX call.

## Threats & mitigations

| Threat | Mitigation |
|--------|------------|
| Phishing fake Canopy / fake II | Canonical Hub tile + `*.icp0.io`; Registry II derivation; educate users |
| Malicious DEX pool / token | Allowlisted factories (ICPSwap); multi-gateway consensus + pool metadata verify; session fingerprint; refuse arbitrary `icrc49` targets |
| Frontend supply-chain XSS | Tight CSP / `.ic-assets.json5`; no remote script hosts |
| Clickjacking in Hub iframe | `frame-ancestors` for Registry + bonsaios.app; spend signing only via II on Canopy |
| Fee rug / excessive bps | Hard caps in Motoko; treasury allowlist in frontend; transparent SpendReview |
| Agent hot-wallet mix-up | Canopy UX never imports Eliza `agent-ic-wallet` |
| Oversize swaps / cycle drain | Step-up II on large notional / restored session; SpendReview; Motoko max caps |
| Stale PWA shell | SW network-only HTML (`canopy-shell-v3`) |
| Marketplace CDN wrong art | Direct ledger/asset URLs first |

## Explicit non-claims

We do **not** claim “unhackable.” We claim: non-custodial, no server keys, allowlisted sign targets, preview/confirm spends, audited fee paths after security review + external audit before “A+ / hardened” marketing.

## Related

- [ALLOWLIST.md](./ALLOWLIST.md) — call targets
- [SECURITY_AUDIT_2026-09-03.md](./SECURITY_AUDIT_2026-09-03.md)
- Bonsai OS II: `shared/bonsai-os-sdk/iiDerivation.ts`
