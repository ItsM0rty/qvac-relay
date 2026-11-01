#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
if [ -d "$project_dir/.tools/node-v22.21.1-linux-x64/bin" ]; then
  export PATH="$project_dir/.tools/node-v22.21.1-linux-x64/bin:$PATH"
fi
source_commit="$(git -c safe.directory="$project_dir" rev-parse HEAD)"
source_short="${source_commit:0:8}"
report_dir="$project_dir/artifacts/reviewer-check-$source_short-$(date +%s)"
mkdir -p "$report_dir"
printf '%s\n' "$report_dir" > "$project_dir/artifacts/local/latest-reviewer-check.txt"
verify_dir="$(mktemp -d /tmp/relay-review.XXXXXX)"
case "$verify_dir" in /tmp/relay-review.*) ;; *) exit 1;; esac
cleanup() {
  local outcome=$?
  printf 'Verification exit=%s; retained evidence: %s\n' "$outcome" "$report_dir"
  case "$verify_dir" in /tmp/relay-review.*) rm -rf -- "$verify_dir";; esac
  exit "$outcome"
}
trap cleanup EXIT
git -c safe.directory="$project_dir" archive "$source_commit" | tar -xf - -C "$verify_dir"
cd "$verify_dir"
export RELAY_SOURCE_COMMIT="$source_commit"
export RELAY_REVIEW_REPORT_DIR="$report_dir"
printf 'Fresh source %s. Existing Node runtime; fresh node_modules; npm and model caches may be reused.\n' "$source_commit"
printf 'Installing pinned dependencies. No inference runs during installation.\n'
NODE_OPTIONS=--max-old-space-size=384 npm ci --maxsockets=2 2>&1 | tee "$report_dir/install.log"
printf 'Bundling Linux QVAC workers, building, checking formatting and tests.\n'
npm run bundle:qvac 2>&1 | tee "$report_dir/bundle.log"
npm run build 2>&1 | tee "$report_dir/build.log"
npm run format:check 2>&1 | tee "$report_dir/format.log"
npm test 2>&1 | tee "$report_dir/tests.tap"
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const dir=process.env.RELAY_REVIEW_REPORT_DIR;
const tap=await readFile(join(dir,'tests.tap'),'utf8');
const count=name=>Number(tap.match(new RegExp(`^# ${name} (\\d+)$`,'m'))?.[1]??NaN);
if(count('fail')!==0||!Number.isSafeInteger(count('pass'))) throw new Error('Invalid test summary');
await writeFile(join(dir,'setup.json'),JSON.stringify({mode:'fresh-reviewer-source-install',passed:true,sourceCommit:process.env.RELAY_SOURCE_COMMIT,node:process.versions.node,platform:process.platform,arch:process.arch,lockSha256:createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),tests:{passed:count('pass'),failed:count('fail')},scope:'Fresh git archive and fresh npm ci on Linux filesystem. Existing supported Node binary and npm download cache. Model weights may be reused through a persistent cache link; first-download/offline installation not established.'},null,2)+'\n');
JS
printf 'Running controlled frozen diagnostics, without native inference.\n'
node --import tsx scripts/review-diagnostics.ts "$report_dir/controlled.json" 2>&1 | tee "$report_dir/controlled.log"
mkdir -p .qvac "$project_dir/.qvac/models"
ln -s "$project_dir/.qvac/models" .qvac/models
printf 'Running README native smoke test with persistent cached weights.\n'
npm run smoke 2>&1 | tee "$report_dir/smoke.log"
cp -- artifacts/live-smoke.json "$report_dir/smoke.json"
printf 'Running frozen new native handoff. Peer stores remain in the original checkout.\n'
demo_dir="$project_dir/.relay/review-native-$source_short-$(date +%s)"
set +e
RELAY_SELECTOR=deterministic RELAY_DEMO_SCENARIO_FILE=data/review-handoff-v1.json npm run demo -- "$demo_dir" 2>&1 | tee "$report_dir/demo.log"
demo_exit=${PIPESTATUS[0]}
set -e
if [ -f "$demo_dir/report.json" ]; then cp -- "$demo_dir/report.json" "$report_dir/native-handoff.json"; fi
if [ -d "$demo_dir/a/traces" ]; then mkdir -p "$report_dir/traces"; cp -- "$demo_dir/a/traces/"*.jsonl "$report_dir/traces/"; fi
exit "$demo_exit"
