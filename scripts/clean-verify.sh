#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
export PATH="$project_dir/.tools/node-v22.21.1-linux-x64/bin:$PATH"
verify_dir="$(mktemp -d /tmp/relay-clean.XXXXXX)"
printf '%s\n' "$verify_dir" > .tools/clean-directory.txt
tar -xf .tools/clean-source.tar -C "$verify_dir"
cd "$verify_dir"
NODE_OPTIONS=--max-old-space-size=384 npm ci --maxsockets=2
npm run bundle:qvac
npm run build
npm test
printf 'Clean source installation, build and tests passed: %s\n' "$verify_dir"
