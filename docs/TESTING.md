# Verification record

Commands run under Ubuntu 24.04 WSL2 with project-local Linux Node 22.21.1. Native CPU inference is verified on this path. Windows Node 22.20.0 and Vulkan 1.3 do not meet the documented Windows execution requirements.

## Build and controlled tests

```sh
npm run build
npm test
npm run evaluate -- --mode replay --trials 3 --output artifacts/replay.json
```

`bash scripts/clean-verify.sh` archives the current committed source into a fresh Linux temporary directory, installs dependencies, bundles workers and runs the build and full tests. It writes artifacts/clean-install.json with the exact source commit. `bash scripts/clean-verify.sh --live` then runs both selectors with two trials, their comparison, the selected-model probe, cancellation and the two-peer demo sequentially. It reuses cached model downloads when available and does not reuse node_modules. Installation and inference do not overlap. Live results are written back to this checkout; temporary source and dependencies are removed at exit. The demo stores remain under .relay for inspection.

A clean archive of commit 27edb4a passed fresh npm installation, QVAC worker bundling, strict compilation and all 102 tests. npm reported zero audit findings. See artifacts/clean-install.json. The source and node_modules were fresh in a Linux temporary directory, with the npm download cache available. Earlier clean evidence for commit 461bf93 is retained separately in artifacts/clean-install-461bf93.json. Live checks are separate from this build and test result.

Tests cover runtime schemas, argument and permission rejection, tool-call/result IDs, context protection, overflow, selector fallback, bounded repair, cancellation, stored outcomes, immutable writes and crash recovery. Separate-process P2P tests exercise real signed replication, offline contribution, reconnect, persistence, cached blocks and missing-block deadlines. CLI tests start a real peer and check authenticated control, persisted records and shutdown.

Scripted model tests inspect actual histories and tool results. Resumption tests use real stores and replication with controlled runners. These tests establish harness and store behavior, not live model quality.

## Native inference

```sh
npm run smoke
node --import tsx scripts/cancel-smoke.ts
npm run demo
```

artifacts/live-smoke.json records a real Qwen3 0.6B model tool call and a subsequent answer containing a dynamic token supplied only by the tool result. The model added prose and Markdown, so exact-format compliance is recorded separately as false. artifacts/live-cancellation.json records cancellation after native decoding began and native settlement as INFERENCE_CANCELLED.

artifacts/live-demo.json records a complete Qwen3 1.7B Q4 handoff across two separate peer processes and directories. A saved pending brief preceded A's shutdown. B wrote linked evidence while A was offline. A reconnected, consumed the contribution and saved a completed brief citing both evidence records. Restart deduplication was checked afterward. The report passed in 358177 ms with five cumulative calls and zero repairs. This is one live demonstration, not a repeated-trial accuracy claim.

Earlier failed native reports remain in artifacts. They show ordinary prose, repeated searches, source-ID confusion, repeated draft facts, invalid SDK parameters, output-budget limits and read-permission failures. An ENOMEM failure occurred while installation competed with a model download checksum. It does not establish the model's standalone memory requirement. Installation and native inference must run sequentially on this machine.

Native startup on /mnt/c required a 120 second RPC allowance. The worker also required an absolute model-cache path. Both settings are recorded in qvac.config.mjs and the decision notes.

## Evaluation and ablation

```sh
npm run evaluate -- --mode live --selector deterministic --trials 3 --output artifacts/baseline.json
npm run evaluate -- --mode live --selector laya --trials 3 --output artifacts/laya.json
npm run evaluate -- --compare artifacts/baseline.json artifacts/laya.json --output artifacts/comparison.json
```

The suite uses three synthetic tasks and five irrelevant evidence records per task. The expected source is a grader requirement, not protected context supplied to the selector. Replay includes a rejected quotation followed by correction. Grading checks persisted status, exact quotations, revisions, required source coverage, unexpected citations, unresolved information and duplicate briefs. It cannot establish semantic truth.

Reports reject duplicate or missing case/trial identities and incompatible configurations before comparison. They record available generator tokens, model calls, repairs, load time, selector usage, fallbacks and latency. Unsupported measurements are null. Memory measurements sample parent Node RSS and system free memory; native child worker memory is not attributed. Generator models unload between cases, so no separate cross-task warm benchmark is claimed. Three synthetic tasks and a few trials do not support statistical significance or general accuracy claims.

Live Laya and repeated live evaluations are being verified. Until retained reports establish their outcomes, no selector performance or savings are claimed. A fallback is reported as a fallback, not a successful native relevance decision.

## Final checks still in progress

The clean installation, worker bundling, build and full test matrix passed. Final live selector comparison and selected-model checks are running from that same staged source. Read docs/STATE.md and the retained reports for the current boundary. A replay pass is never a native pass, and a native probe alone is never a complete handoff pass.

After that run, review found unsupported causal prose in generated facts despite six automated state-check passes. The revised brief contract stores exact quotes as observations and explicitly labels generated interpretation as unverified uncertainty. All 105 current-source tests pass. Report version 2 checks this policy and its uncertainty notice. It includes the synthetic case, evidence, requests, brief and checkpoint so recorded citation checks can be inspected without retaining temporary core files. The comparison rejects historical version 1 reports. Both final live arms and the clean matrix must be rerun under this contract. These checks do not establish source truth, faithful quote selection or semantic entailment of an interpretation.
