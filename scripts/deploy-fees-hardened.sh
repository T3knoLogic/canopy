#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/dfx/bin:$PATH"
export DFX_WARNING=-mainnet_plaintext_identity
cd /mnt/r/REPOSITORIES/canopy
dfx deploy canopy_fees --network ic --yes
dfx canister call 7o5gc-syaaa-aaaau-ag6cq-cai getOwner --network ic --query
