#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/dfx/bin:$PATH"
export DFX_WARNING=-mainnet_plaintext_identity
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
nvm use 20 2>/dev/null || true

cd /mnt/r/REPOSITORIES/canopy/frontend
echo "=== canopy vite build ==="
npx vite build

cd /mnt/r/REPOSITORIES/canopy
echo "=== dfx deploy canopy_frontend ==="
dfx deploy canopy_frontend --network ic --yes

echo "Live: https://7h6n6-eqaaa-aaaau-ag6da-cai.icp0.io/"
