# Reviewer guide

Relay runs a live, local two-peer handoff. Peer A owns the investigation; peer B contributes from its own store while A is offline. The model chooses its tools and quotations. Automated checks verify recorded quotations and protocol state; they do not establish source truth or semantic correctness.

## Setup

Use Ubuntu 24.04 in WSL2 on CPU with Linux Node `^22.21.0 || >=24.9.0`. Install `libatomic1` as described in the [QVAC system requirements](https://docs.qvac.tether.io/sdk/system-requirements/). Clone the private repository into the Linux home filesystem when possible, then install and build:

```sh
sudo apt-get update && sudo apt-get install -y git ca-certificates libatomic1
cd ~
git clone https://github.com/ItsM0rty/qvac-relay.git
cd qvac-relay
node --version
npm ci --maxsockets=2
npm run bundle:qvac
npm run build
npm test
```

If memory is constrained, `NODE_OPTIONS=--max-old-space-size=384 npm ci --maxsockets=2` bounds the install's Node heap. Run installation and inference sequentially. The Linux bundle provides the QVAC workers. Dependency installation and the first uncached model load require network access; QVAC then uses the local `.qvac/models` cache. Cache reuse is not evidence that a fresh offline installation or download works. No cloud API key is needed.

## Watch a live handoff

```sh
demo_dir=".relay/reviewer-$(date +%s)"
printf 'Peer directories: %s/a and %s/b\n' "$demo_dir" "$demo_dir"
RELAY_MODEL=1.7b RELAY_SELECTOR=deterministic npm run demo -- "$demo_dir"
```

The demo runs the model and two real peer processes, with no scripted substitute. Concise progress goes to stderr: peer startup and connection, initial work, checkpoint and request replication, offline contribution, resumption, and cleanup. Status changes include call and repair counts, with periodic waiting messages during long operations. The final JSON report goes to stdout and to `report.json` in the chosen demo directory (or an automatic `.relay/demo-*` directory when none is supplied). On completion it includes the final brief; source stores and traces remain there for inspection. A failed run is reported as a failure, with its available events retained.

During a run, use another terminal and substitute the printed directory below:

```sh
npm run relay -- status --dir .relay/demo-EXAMPLE/a
npm run relay -- inspect --dir .relay/demo-EXAMPLE/a --case rollback-investigation
npm run relay -- inspect --dir .relay/demo-EXAMPLE/b --case rollback-investigation
```

A `pending` checkpoint means work still awaits a contribution or a refresh of a brief that does not yet cite a locally known linked answer. The answer may come from either peer, including the case owner. It is not a completed handoff. `status` shows whether work is active, checkpoints, and cleanup or resumption errors. The `work` command waits for its checkpoint; a separate terminal can request cancellation:

```sh
npm run relay -- cancel --dir .relay/demo-EXAMPLE/a
npm run relay -- status --dir .relay/demo-EXAMPLE/a
```

The cancel command acknowledges the request promptly. Continue checking until `active` is false and examine `cleanupError`; the acknowledgment alone does not mean native work or cleanup has settled. Avoid running inference on both peers at once on a constrained machine.

## New incident variation

For the separately recorded new Atlas incident, use a fresh directory and the frozen scenario file:

```sh
RELAY_MODEL=1.7b RELAY_SELECTOR=deterministic RELAY_DEMO_SCENARIO_FILE=data/review-handoff-v1.json npm run demo -- ".relay/atlas-review-$(date +%s)"
```

Its case ID is `atlas-export-investigation`. Read the [individual results](REVIEW_RESULTS.md); a default-workflow pass does not establish a pass for this variation.

## Fresh reviewer verification

```sh
npm run verify:review
```

For the longer consistency check, run `RELAY_REVIEW_REPEAT=3 npm run verify:review`. It runs the default short-record handoff three times in fresh stores on one committed source and configuration, then runs the Atlas variation separately. The model is pinned to Qwen3 1.7B Q4 on CPU and selection to deterministic. All attempts, including failures, remain under the report directory with calls, repairs, latency, exposed token counters and cleanup status in `native-summary.json`. Runs are serial and there are no automatic retries. Three passes would support the demo, not establish broad reliability.

This command archives the current committed Git source into a fresh temporary Linux directory, installs fresh `node_modules` with `npm ci --maxsockets=2`, and runs the bundle, build, formatting, full tests, controlled diagnostics, native smoke, and frozen reviewer handoff serially. Uncommitted edits are not in the archive. It uses the existing supported Node runtime; npm download and model caches may be reused. An uncached model still needs network access. The command retains logs and reports under a unique `artifacts/reviewer-check-<commit>-<timestamp>` directory and peer stores under `.relay/review-native-*`; `artifacts/local/latest-reviewer-check.txt` points to the report directory. The temporary source archive is cleaned up. Review the actual result and logs; a script's existence does not establish a native pass.

The older `scripts/clean-verify.sh` may overwrite historical artifact filenames. Preserve existing artifacts before running it, or use `verify:review` for the uniquely named reviewer run. Evaluation commands that write an explicit output file should likewise use a fresh filename; see the timestamped examples in the README.

## Troubleshooting and retained data

| Symptom | Check or next action |
| --- | --- |
| Unsupported Node or platform error | Run `node --version` and `node -p process.platform` in the WSL terminal. The latter must print `linux`. Windows Node is a different runtime. |
| Missing native worker or `libatomic.so.1` | Run the Linux bundle command after installing dependencies. Install Ubuntu `libatomic1` if its library is missing. Do not copy a Windows bundle into Linux. |
| Slow first load or download | Keep the model cache and check network access. Native startup and CPU inference can take minutes. The waiting heartbeat reports liveness, not a throughput guarantee. |
| Connection refused or missing control.json | Status needs a running peer. The demo stops both peers at the end; read its retained report and trace files then, or restart only that peer with its original directory. |
| Store locked or port already used | One process owns each data directory. Stop that process cleanly or use a fresh directory and free ports. Do not delete existing stores to clear a lock. |
| Failed checkpoint or cleanup error | Inspect the reason and trace before retrying. A manual `work` explicitly starts a new bounded run; automatic resumption and recovery carry prior call and repair counts. Preserve failed reports and choose a new demo directory for a new diagnostic attempt. |

The guided demo stops its peers automatically. For manually started peers, cancel active work, wait for settlement, then use Ctrl+C in each peer terminal. Keep `.qvac/models` for cached weights and `.relay` for identities and cases. Delete only a specifically chosen disposable run directory after all its processes stop. Traces and reports can be read without loading a model; do not share `control.json` bearer tokens.

## Retrieval limits

The optional MiniLM and Laya selectors rerank lexical candidates. A relevant passage with zero lexical overlap is absent from their candidate set, so reranking cannot recover it. An empty query can navigate passage metadata and broader query terms can help the model find sources, but neither guarantees retrieval. Read results contain bounded original excerpts with offsets; a model may cite only text actually delivered from the current source revision. The [retrieval evaluation](RETRIEVAL_EVALUATION.md) separates selection coverage, distractors, and native agent outcomes.
