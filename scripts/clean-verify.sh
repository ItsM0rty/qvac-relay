#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
if [ -d "$project_dir/.tools/node-v22.21.1-linux-x64/bin" ]; then
  export PATH="$project_dir/.tools/node-v22.21.1-linux-x64/bin:$PATH"
fi
verify_dir="$(mktemp -d /tmp/relay-clean.XXXXXX)"
case "$verify_dir" in /tmp/relay-clean.*) ;; *) exit 1;; esac
trap 'case "$verify_dir" in /tmp/relay-clean.*) rm -rf -- "$verify_dir";; esac' EXIT
source_commit="$(git -c safe.directory="$project_dir" rev-parse HEAD)"
git -c safe.directory="$project_dir" archive HEAD | tar -xf - -C "$verify_dir"
cd "$verify_dir"
NODE_OPTIONS=--max-old-space-size=384 npm ci --maxsockets=2
npm run bundle:qvac
npm run build
npm test
printf 'Clean source installation, build and tests passed for commit %s\n' "$source_commit"
