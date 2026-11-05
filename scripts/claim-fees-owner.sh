#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/dfx/bin:$PATH"
cd /mnt/r/REPOSITORIES/canopy
export DFX_WARNING=-mainnet_plaintext_identity

dfx canister call 7o5gc-syaaa-aaaau-ag6cq-cai setConfig "$(cat scripts/claim-fees-owner.args)" --network ic
dfx canister call 7o5gc-syaaa-aaaau-ag6cq-cai setFtSendFeeBps '(15 : nat)' --network ic
echo "--- owner ---"
dfx canister call 7o5gc-syaaa-aaaau-ag6cq-cai getOwner --network ic --query
echo "--- config ---"
dfx canister call 7o5gc-syaaa-aaaau-ag6cq-cai getConfig --network ic --query
echo "--- ft bps ---"
dfx canister call 7o5gc-syaaa-aaaau-ag6cq-cai getFtSendFeeBps --network ic --query
