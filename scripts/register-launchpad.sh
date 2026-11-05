#!/usr/bin/env bash
set -euo pipefail
export DFX_WARNING=-mainnet_plaintext_identity
dfx canister call t76fk-faaaa-aaaau-afpgq-cai register \
  '(principal "7o5gc-syaaa-aaaau-ag6cq-cai", "canopy_fees", "ic")' \
  --network ic
dfx canister call t76fk-faaaa-aaaau-afpgq-cai register \
  '(principal "7h6n6-eqaaa-aaaau-ag6da-cai", "canopy_frontend", "ic")' \
  --network ic
