#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
verify_mode="${1:-}"
if [ -n "$verify_mode" ] && [ "$verify_mode" != --live ]; then
  printf 'Usage: bash scripts/clean-verify.sh [--live]\n' >&2
  exit 1
fi
if [ -d "$project_dir/.tools/node-v22.21.1-linux-x64/bin" ]; then
  export PATH="$project_dir/.tools/node-v22.21.1-linux-x64/bin:$PATH"
fi
verify_dir="$(mktemp -d /tmp/relay-clean.XXXXXX)"
case "$verify_dir" in /tmp/relay-clean.*) ;; *) exit 1;; esac
cleanup() {
  local outcome=$?
  for probe in live-smoke live-cancellation; do
    if [ -f "$verify_dir/artifacts/$probe.json" ]; then
      cp -- "$verify_dir/artifacts/$probe.json" "$project_dir/artifacts/$probe-1.7b.json"
    fi
  done
  case "$verify_dir" in /tmp/relay-clean.*) rm -rf -- "$verify_dir";; esac
  exit "$outcome"
}
trap cleanup EXIT
source_commit="$(git -c safe.directory="$project_dir" rev-parse HEAD)"
git -c safe.directory="$project_dir" archive HEAD | tar -xf - -C "$verify_dir"
cd "$verify_dir"
rm -f -- artifacts/live-smoke.json artifacts/live-cancellation.json
mkdir -p "$project_dir/artifacts/local"
NODE_OPTIONS=--max-old-space-size=384 npm ci --maxsockets=2
npm run bundle:qvac
npm run build
npm test | tee "$project_dir/artifacts/local/clean-tests.tap"
RELAY_VERIFIED_COMMIT="$source_commit" RELAY_REPORT_DIRECTORY="$project_dir/artifacts" node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.env.RELAY_REPORT_DIRECTORY;
const tap = await readFile(join(directory, 'local/clean-tests.tap'), 'utf8');
const count = name => Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
if (count('fail') !== 0 || !Number.isSafeInteger(count('pass'))) throw new Error('Unrecognized test summary');
await writeFile(join(directory, 'clean-install.json'), JSON.stringify({
  mode: 'clean-source-installation', passed: true, sourceCommit: process.env.RELAY_VERIFIED_COMMIT,
  platform: 'Ubuntu 24.04 WSL2 x64; fresh source and node_modules on Linux filesystem', node: process.versions.node,
  commands: ['npm ci --maxsockets=2', 'npm run bundle:qvac', 'npm run build', 'npm test'],
  environment: { NODE_OPTIONS_during_npm_ci: '--max-old-space-size=384' },
  tests: { passed: count('pass'), failed: count('fail') },
  scope: 'Fresh git archive of the named commit and fresh node_modules. npm download cache available. No global toolchain changed. This report covers installation/build/tests; separate artifacts cover live inference.',
}, null, 2) + '\n');
JS
printf 'Clean source installation, build and tests passed for commit %s\n' "$source_commit"
if [ "$verify_mode" = --live ]; then
  # Reuse only cached model downloads, never node_modules or peer stores.
  if [ -d "$project_dir/.qvac/models" ] && [ ! -e .qvac/models ]; then
    mkdir -p .qvac
    ln -s "$project_dir/.qvac/models" .qvac/models
  fi
  export RELAY_MODEL=1.7b
  export RELAY_SELECTOR=deterministic
  npm run evaluate -- --mode replay --trials 3 --output "$project_dir/artifacts/replay.json"
  npm run evaluate -- --mode live --selector deterministic --trials 2 --output "$project_dir/artifacts/live-deterministic.json"
  npm run evaluate -- --mode live --selector laya --trials 2 --output "$project_dir/artifacts/live-laya.json"
  npm run evaluate -- --compare "$project_dir/artifacts/live-deterministic.json" "$project_dir/artifacts/live-laya.json" --output "$project_dir/artifacts/live-comparison.json"
  npm run smoke
  cp -- artifacts/live-smoke.json "$project_dir/artifacts/live-smoke-1.7b.json"
  node --import tsx scripts/cancel-smoke.ts
  cp -- artifacts/live-cancellation.json "$project_dir/artifacts/live-cancellation-1.7b.json"
  npm run demo -- "$project_dir/.relay/clean-demo-$source_commit-$(date +%s)"
fi
