# Relay

Relay keeps an engineering investigation alive across two local peers. A local QVAC model reads evidence through tools, requests missing information and saves a cited brief. A collaborator writes an answer into its own persistent tree. When the case owner reconnects, Relay consumes the relevant contribution and resumes unfinished work.

The repository is an assessment implementation. See [testing evidence](docs/TESTING.md) for the distinction between controlled tests, real replication and native inference. Accepted observations are verbatim source quotations. Generated explanations are labelled as unverified in uncertainty and can still be wrong. A quotation establishes what a source reports, not that the source is true.

## Requirements and setup

The verified execution path is Ubuntu 24.04 in WSL2, using CPU inference. Use Linux Node 22.21 or newer on the 22 line, or Node 24.9 or newer. The Windows host used during development has Vulkan 1.3.260. QVAC documents Vulkan 1.4 as necessary on Windows, including CPU mode, so these instructions use Linux. No cloud API key is required.

The repository is private. If you have access, clone it from a Linux terminal:

```sh
git clone https://github.com/da-goat37/prac-sdk.git
cd prac-sdk
```

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

The retained [v6 live demonstration](artifacts/live-demo.json) at source `fd54add` passed with Qwen3 1.7B Q4 in 343463 ms (about 5.7 minutes), using seven cumulative model calls and two repairs. Peer B wrote its contribution into B's own store while A was offline; after reconnecting, A completed the brief citing the health log and deployment configuration. A further restart confirmed deduplication. This historical run predates passage retrieval and is separate from current long-record verification. It is one successful demonstration, not a measured success rate.

The [long-record native handoff](artifacts/passage-demo-2f23582.json) passed at source `2f23582` with deterministic lexical selection in 711784.744 ms, about 11.9 minutes. A saved pending work, B contributed from its own store while A was offline, and A restarted, replicated the contribution and completed a brief with exact late quotations from both records. The run used 11 cumulative calls and two repairs, verified cleanup and restart deduplication, and stopped both peers cleanly. This is one development demonstration, not an accuracy estimate; earlier failed runs remain recorded.

`npm run demo` runs a live-only handoff in two child processes, retains separate stores under `.relay/demo-*`, and writes a report. For the long-record variant use:

```sh
RELAY_DEMO_LONG=1 RELAY_SELECTOR=deterministic npm run demo
```

It fails visibly if the local model cannot create pending work or use the contribution. It never substitutes scripted output.

Cases may declare up to eight structured information needs at creation with `--needs '<JSON array>'`. Each item has a stable `id` and canonical `question`. When the model requests one, it supplies its `needId`; Relay attaches the declared question and stable ID to the request. Undeclared need IDs are rejected. A required need without a matching request prevents acceptance even when the model submits an empty missing list. A brief with unanswered requests is pending. Contributed answers must be read and cited before completion. Context and tool results distinguish unrequested, awaiting-response and answered questions. Free-text tasks do not provide deterministic semantic coverage checks for required missing information. Declare required gaps with `--needs` when that coverage matters, as the checkout example does for deployment configuration.

## Retrieval and context

Relay derives rebuildable passages from accepted original evidence. Passage text is an exact UTF-16 slice with source ID, revision and offsets. The original records remain intact and their tails are searchable, although retrieval and model recovery are not guaranteed. A deterministic BM25-like lexical search supplies up to twelve candidates to the optional reranker. Required contributions and protocol are protected in the default 7000 estimated-token context budget before QVAC uses the evidence tools. The estimate is conservative and is not an exact tokenizer. Read progress records that excerpts were delivered, not that a whole source was read. Ranking is not proof of relevance or source truth.

## Model and selector controls

```sh
RELAY_MODEL=1.7b RELAY_SELECTOR=deterministic npm run relay -- peer --dir .relay/a --port 7001
RELAY_MODEL=1.7b RELAY_SELECTOR=laya npm run demo
RELAY_MODEL=1.7b RELAY_SELECTOR=minilm npm run demo
```

The default generator is Qwen3 1.7B Q4 through `@qvac/sdk` 0.22.0. The default `RELAY_SELECTOR=deterministic` uses lexical ranking. `minilm` and `laya` are optional rerankers of the same lexical candidates, not evidence writers. They do not authorize actions. A selector error or truncation produces a visible lexical fallback only after successful cleanup; cleanup failure quarantines the runtime and stops the run.

To use MiniLM, explicitly prepare its four pinned, SHA-256-verified files before selecting it:

```sh
npm run ranker:prepare
RELAY_SELECTOR=minilm npm run relay -- peer --dir .relay/a --port 7001
```

The INT8 ONNX model is pinned to revision `a09144355adeed5f58c8ed011d209bf8ee5a1fec` and runs with `@huggingface/transformers` 4.3.2. Preparation needs network access. Inference uses only the local cache at `.relay/reranker-cache`, or the path in `RELAY_RANKER_CACHE`; model weights are not committed to Git. Cancellation is cooperative and waits for the active ONNX batch to settle.

Laya classifies each full passage as directly relevant, background or unrelated, using bounded batches and optional order probes. It ranks all candidates by class and lexical order, without using confidence or `actProbability` to authorize actions. The native [MiniLM probe](artifacts/minilm-native-probe.json) recorded nonconstant scores, stable reordered results and refusal of overlong input. It is an integration probe, not a held-out quality result. In the measured [passage selection comparison](docs/RETRIEVAL_EVALUATION.md), all three arms achieved 7/9 held-out annotated spans and the optional rankers did not reduce total distractors. Deterministic lexical selection remains the recommended default for this small synthetic set.

The [v5 selector matrix](docs/EVALUATION.md) used source snapshot `872df5c`: both deterministic and Laya arms passed 6/6 automated state checks. Laya made six valid decisions without fallback or truncation, but selected all six candidates, including five irrelevant records, on every task. No filtering benefit was observed, so deterministic selection remains the default. This matrix predates the v6 handoff snapshot and does not establish semantic truth or general selector performance.

The selected [Qwen3 1.7B probe](artifacts/live-smoke-1.7b.json) passed in two calls with exact output formatting in 28.56 seconds. The [cancellation probe](artifacts/live-cancellation-1.7b.json) requested cancellation after native output began; cancel() returned in 32.77 ms and the completion rejected as INFERENCE_CANCELLED. These probes are separate from the complete handoff.

Application work uses native required-tool mode because its completion contract is a saved brief. The model selects tools, read locations and quotations; the harness does not prescribe a successful sequence. The native save input maps source IDs to one exact contiguous quote each, alongside `uncertainty` and `missing`. Its schema requires protected source IDs and permits 1 to 32 read-source keys, each quote at most 1000 characters. Trusted code independently checks coverage, delivered text and current revisions; schema constraints do not guarantee valid model output. Repeating an identical action twice against unchanged data triggers bounded no-progress feedback. The separate probe permits ordinary text so it can verify that a tool result influenced the next model turn.

One peer permits one inference at a time. This is a per-process limit. Running work on both peers simultaneously can exceed this machine's resources; use one active owner in the demonstration. No machine-wide inference service is claimed.

## Evaluations and replay

```sh
npm run evaluate -- --mode replay --trials 3 --output artifacts/replay.json
npm run evaluate -- --mode live --selector deterministic --trials 3 --output artifacts/baseline.json
npm run evaluate -- --mode live --selector laya --trials 3 --output artifacts/laya.json
npm run evaluate -- --compare artifacts/baseline.json artifacts/laya.json --output artifacts/comparison.json
npm run regrade -- artifacts/live-deterministic.json
npm run evaluate:retrieval -- --mode retrieval --trials 2
npm run evaluate:retrieval -- --mode agent --split heldout --cases held-cold-1,held-charge-1 --trials 1
bash scripts/clean-verify.sh --retrieval
```

Replay is a scripted harness regression using actual tool results and temporary stores. It is not a model-quality result. `regrade` reads captured version 2 case state and recomputes checks without inference or store writes. It refuses missing state and mismatched identities, and labels its output as recorded-state-regrade. Reports validate exact case and trial identities before comparison. Missing cases, duplicates and incompatible configurations fail. Each task includes five irrelevant evidence records. Expected source IDs belong to the grader and are not supplied as mandatory selector context. Version 2 reports check the quoted-observation policy and uncertainty notice; historical version 1 reports are not comparable. Measurements and limitations are included in each report. See [the recorded selector evaluation](docs/EVALUATION.md). The small synthetic suite does not establish general accuracy or statistical significance.

The passage evaluation uses nine frozen version 2 synthetic fixtures, approximately 19,000 characters per case, with disjoint development and held-out families. Expected spans are grader-only and are not forced into context. The 54-row selection comparison and six failed native agent runs are documented in [passage retrieval evaluation](docs/RETRIEVAL_EVALUATION.md); the later long-record native handoff is a separate measurement. The later [cc543bd](artifacts/passage-demo-cc543bd-failed.json) and [cf3b330](artifacts/passage-demo-cf3b330-failed.json) long-record runs failed after pending work and replication; neither is a successful handoff. The [ae3a53f run](artifacts/passage-demo-ae3a53f-failed.json) failed during initial work after quotation validation errors, before a request or replication. The [89f9f10 run](artifacts/passage-demo-89f9f10-failed.json) stopped without the required health-log citation after 12 calls and two repairs; cleanup and resumption reported no error. Current source `2f23582` passed build, formatting and 168 controlled tests. Its native long-record handoff passed once with the new save format, as described above. These synthetic checks do not establish semantic truth or general quality.

Before running `clean-verify.sh --retrieval`, run `npm run ranker:prepare` with the default cache path. The script sets `RELAY_RANKER_CACHE` to this checkout's `.relay/reranker-cache` and does not prepare the model itself; a model prepared only in a custom cache is insufficient.

## Boundaries and limitations

- Each peer has one owned Hyperbee2 tree. Paired trees are read-only. Corestore replicates signed blocks over an encrypted protocol stream carried by loopback TCP. This implementation targets two peers on one machine and does not implement internet discovery.
- Freshness means the latest information locally available at validation. A serialized write guard catches prior queued local writes. This is not global consensus or a claim of exactly-once distributed effects.
- Brief facts are exact source quotations under `quoted-observations-v1`; generated explanations are labelled as unverified uncertainty. The grader checks quotation text, source revisions, required contribution coverage and the root-cause uncertainty notice. These checks do not prove that a source is true or establish semantic entailment.
- Context uses field projection and a conservative UTF-8 byte estimate with template allowance. This is not an exact tokenizer. Mandatory state and unresolved protocol are protected. Older resolved groups can leave together; an oversized rejected save draft can also leave as a complete group while specific feedback remains. Successful effects stay committed. Exact matching feedback is referenced from a retained failed tool result and restored if that result leaves context. Overflow stops visibly when protected context still cannot fit.
- `find_evidence` accepts `skip` and `limit`, defaulting to three results and allowing up to twelve. It returns navigation metadata including source IDs and offsets, not source text. The native `read_record` tool accepts a source ID and UTF-16 offset. Trusted code returns up to 1000 characters, possibly less to fit the context, with `nextOffset` for further reads. The library validator retains an optional length for controlled callers. Packing projects the next protected context and can reduce search rows or read pages. At the default budget ordinary results share a soft 1000-byte allowance; a single required read can exceed it when the full requested page fits with duplicate passage text removed. Future changes or tool errors can still cause explicit overflow. Quote validation checks each actually read excerpt separately; the model cannot cite unread text or bridge gaps between reads. Tree scans and remote block waits are bounded. An unreadable paired tree can fail a case read instead of silently hiding evidence.
- Local control uses a random bearer token in each peer's data directory. Do not share that directory or commit it. Source record IDs and tool names appear in traces; unnecessary source content is not logged there.

See [architecture](docs/ARCHITECTURE.md), [decisions](docs/DECISIONS.md) and [current state](docs/STATE.md).

## Personal design section

Suyash must add the assessment's required personal design section himself. No AI-written personal design prose is supplied here.
