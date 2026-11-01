#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d .tools/node-v22.21.1-linux-x64/bin ]; then
  export PATH="$PWD/.tools/node-v22.21.1-linux-x64/bin:$PATH"
fi
exec "$@"
