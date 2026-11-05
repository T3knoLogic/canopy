#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/dfx/bin:$PATH"
export DFX_WARNING=-mainnet_plaintext_identity
cd /mnt/r/REPOSITORIES/canopy
dfx deploy canopy_frontend --network ic --yes
