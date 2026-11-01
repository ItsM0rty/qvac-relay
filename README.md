# Relay

Relay keeps an engineering investigation alive across two local peers. A local QVAC model reads evidence through tools, requests missing information and saves a cited brief. A collaborator writes an answer into its own persistent tree. When the case owner reconnects, Relay consumes the relevant contribution and resumes unfinished work.

The repository is an assessment implementation. See [testing evidence](docs/TESTING.md) for the distinction between controlled tests, real replication and native inference. Accepted observations are verbatim source quotations. Generated explanations are labelled as unverified in uncertainty and can still be wrong. A quotation establishes what a source reports, not that the source is true.

## Requirements and setup

The verified execution path is Ubuntu 24.04 in WSL2, using CPU inference. Use Linux Node 22.21 or newer on the 22 line, or Node 24.9 or newer. The Windows host used during development has Vulkan 1.3.260. QVAC documents Vulkan 1.4 as necessary on Windows, including CPU mode, so these instructions use Linux. No cloud API key is required.

From a Linux terminal inside this checkout:

```sh
node --version
npm ci
npm run bundle:qvac
npm run build
npm test
npm run smoke
```

The bundle command targets linux-x64 and includes only text generation and decisions. `qvac.config.mjs` computes an absolute model cache path in `.qvac/models`. The initial model load downloads a GGUF through QVAC's registry. A later cached load does not establish that a fresh install can work without network access. The development machine needed a 120 second worker startup allowance on WSL's Windows filesystem mount. Prefer a Linux filesystem checkout if startup I/O is slow.

On this development checkout, an ignored Linux Node 22.21.1 runtime is available through `scripts/linux.sh`. It is a convenience for this machine, not a downloaded binary committed to Git. In PowerShell:

```powershell
wsl -d Ubuntu-24.04 -- bash '/mnt/c/Users/m0rty/Desktop/Programming/Research/New folder/byteask/relay-agent/scripts/linux.sh' npm test
```

## Two peers locally

Run each peer in its own terminal and directory. These processes can replicate data without loading a language model. Model weights load only when work starts and unload after each run.

```sh
npm run relay -- peer --dir .relay/a --port 7001 --api 7101
npm run relay -- peer --dir .relay/b --port 7002 --api 7102
```

Each prints an `owner` public key. In a third terminal, substitute those keys:

```sh
npm run relay -- pair --dir .relay/a --key B_OWNER_KEY
npm run relay -- pair --dir .relay/b --key A_OWNER_KEY
npm run relay -- connect --dir .relay/a --port 7002
npm run relay -- create --dir .relay/a --id checkout --title 'Checkout errors' --task 'Investigate checkout errors. Read the health log and deployment configuration. Request configuration if missing and save a pending brief. Distinguish observations from uncertain root cause.' --needs '[{"id":"deployment-config","question":"What timeout changed in deployment 42, and what value did rollback restore?"}]'
npm run relay -- evidence --dir .relay/a --case checkout --id health-log --title 'Health log' --text 'Errors rose to 8% after deployment 42. Rollback restored errors to 0.2%. Configuration is absent from this log.'
npm run relay -- work --dir .relay/a --case checkout
npm run relay -- inspect --dir .relay/a --case checkout
```

Inspect the persisted request and its ID. Let B finish replicating it before stopping A with Ctrl+C. B writes its answer to B's own tree:

```sh
npm run relay -- inspect --dir .relay/b --case checkout
npm run relay -- evidence --dir .relay/b --case checkout --id deployment-config --request REQUEST_ID --title 'Deployment configuration' --text 'Deployment 42 changed the database timeout from 3000 ms to 100 ms. Rollback restored 3000 ms. Causality requires verification.'
```

Restart A with the same directory, then reconnect:

```sh
npm run relay -- peer --dir .relay/a --port 7001 --api 7101
# In the control terminal:
npm run relay -- connect --dir .relay/a --port 7002
npm run relay -- status --dir .relay/a
npm run relay -- inspect --dir .relay/a --case checkout
```

The owner resumes pending work when it sees an unconsumed remote contribution linked to its request. Status includes checkpoints and failures. Repeated notifications and restart do not restart completed work. `scan` requests an immediate check; a periodic check also runs. A failed run remains visible and requires an explicit `work` command to retry.

```sh
npm run relay -- cancel --dir .relay/a
npm run relay -- disconnect --dir .relay/a
npm run relay -- scan --dir .relay/a
```

`cancel` requests cancellation of the active decode and waits for native settlement through the running operation. Ctrl+C cleans up the peer. To add a UTF-8 evidence file, use `--file path` instead of `--text`. A stable `--id` makes equal evidence retries safe; conflicting content under the same ID is rejected.

CPU work can take several minutes. The `work` command waits for its checkpoint; use another terminal for `status` or `cancel`. CLI runs allow at most 20 model calls, two corrective attempts and ten minutes per run. Automatic resumption carries call and repair counts from prior work. These are cooperative execution limits, and cancellation waits for native settlement.

The retained [live demonstration](artifacts/live-demo.json) passed with Qwen3 1.7B Q4 in 358177 ms, using five cumulative calls and zero repairs. It includes offline contribution, automatic resumption and restart deduplication. This is one successful demonstration, not a measured success rate.

`npm run demo` runs the complete live-only handoff in two child processes, retains separate stores under `.relay/demo-*`, and writes a report. It fails visibly if the local model cannot create pending work or use the contribution. It never substitutes scripted output.

Cases may declare up to eight structured information needs at creation with `--needs '<JSON array>'`. Each item has a stable `id` and canonical `question`. When the model requests one, it supplies its `needId`; Relay attaches the declared question and stable ID to the request. Undeclared need IDs are rejected. A required need without a matching request prevents acceptance even when the model submits an empty missing list. A brief with unanswered requests is pending. Contributed answers must be read and cited before completion. Context and tool results distinguish unrequested, awaiting-response and answered questions. Free-text tasks do not provide deterministic semantic coverage checks for required missing information. Declare required gaps with `--needs` when that coverage matters, as the checkout example does for deployment configuration.

## Model and selector controls

```sh
RELAY_MODEL=1.7b RELAY_SELECTOR=deterministic npm run relay -- peer --dir .relay/a --port 7001
RELAY_MODEL=1.7b RELAY_SELECTOR=laya npm run demo
```

The default generator is Qwen3 1.7B Q4 through `@qvac/sdk` 0.22.0. It completed the native handoff on this machine. Qwen3 0.6B Q4 remains available for experiments, but its full-task attempts exposed repeated searches, source-ID confusion and output-budget failures. The default selector is deterministic. Laya typed decisions Q8 is optional and never rewrites evidence. Its bounded `decide()` call can omit optional snippets; mandatory contribution context is protected. Truncation and malformed selector results produce a visible deterministic fallback. A native selector call failure falls back only when cleanup succeeds; cleanup failure is an infrastructure failure that stops the run and is quarantined. Confidence values do not authorize actions. Live Laya and repeated selector evaluations are being verified; no performance or token savings are claimed yet.

Application work uses native required-tool mode because its completion contract is a saved brief. The model selects among the declared tools; the harness does not prescribe a successful sequence. Repeating an identical action twice against unchanged data triggers bounded no-progress feedback. The separate probe permits ordinary text so it can verify that a tool result influenced the next model turn.

One peer permits one inference at a time. This is a per-process limit. Running work on both peers simultaneously can exceed this machine's resources; use one active owner in the demonstration. No machine-wide inference service is claimed.

## Evaluations and replay

```sh
npm run evaluate -- --mode replay --trials 3 --output artifacts/replay.json
npm run evaluate -- --mode live --selector deterministic --trials 3 --output artifacts/baseline.json
npm run evaluate -- --mode live --selector laya --trials 3 --output artifacts/laya.json
npm run evaluate -- --compare artifacts/baseline.json artifacts/laya.json --output artifacts/comparison.json
```

Replay is a scripted harness regression using actual tool results and temporary stores. It is not a model-quality result. Reports validate exact case and trial identities before comparison. Missing cases, duplicates and incompatible configurations fail. Each task includes five irrelevant evidence records. Expected source IDs belong to the grader and are not supplied as mandatory selector context. Measurements and limitations are included in each report. The small synthetic suite does not establish general accuracy or statistical significance.

## Boundaries and limitations

- Each peer has one owned Hyperbee2 tree. Paired trees are read-only. Corestore replicates signed blocks over an encrypted protocol stream carried by loopback TCP. This implementation targets two peers on one machine and does not implement internet discovery.
- Freshness means the latest information locally available at validation. A serialized write guard catches prior queued local writes. This is not global consensus or a claim of exactly-once distributed effects.
- Quotes, revisions, source existence and required contribution coverage are checked. Those checks do not prove a generated interpretation follows from the quotation.
- Context uses field projection and a conservative UTF-8 byte estimate with template allowance. This is not an exact tokenizer. Required protocol is never silently removed to fit. Overflow stops visibly.
- Evidence reads return at most 1000 characters and mark truncation. The model must not cite unread text. Tree scans and remote block waits are bounded. An unreadable paired tree can fail a case read instead of silently hiding evidence.
- Local control uses a random bearer token in each peer's data directory. Do not share that directory or commit it. Source record IDs and tool names appear in traces; unnecessary source content is not logged there.

See [architecture](docs/ARCHITECTURE.md), [decisions](docs/DECISIONS.md) and [current state](docs/STATE.md).

## Personal design section

Suyash must add the assessment's required personal design section himself. No AI-written personal design prose is supplied here.
