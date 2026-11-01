# Verification record

Commands run under Ubuntu 24.04 WSL2 with local Linux Node 22.21.1. Windows Node and Vulkan do not constitute the verified inference path.

## Routine checks

```sh
npm run build
npm test
npm run evaluate -- --mode replay --trials 3 --output artifacts/replay.json
```

The integrated pre-evaluation suite passed 60 tests. It covers runtime schemas, protocol IDs, argument rejection, context protection, overflow, selector fallback, bounded repair, cancellation, stored outcomes and crash recovery. Separate-process P2P tests exercise real signed replication, offline contribution, reconnect, restart, cached remote blocks and missing-block deadlines. CLI testing starts a real peer and verifies authenticated control, persisted records and shutdown.

Scripted model tests inspect actual tool results and histories. They are not evidence of native inference. Resumption tests include real stores and real replication with a controlled runner, so a full live-agent handoff remains a separate check.

## Native checks

```sh
npm run smoke
node --import tsx scripts/cancel-smoke.ts
npm run demo
```

Native startup initially failed the SDK's 30 second RPC deadline. A heartbeat showed the worker was alive and waiting on WSL filesystem I/O. A 120 second allowance let RPC initialize. The next failure identified a relative cache path rejected by the worker. `qvac.config.mjs` now computes an absolute path.

The first native Qwen3 0.6B run downloaded its GGUF, called a probe tool and reproduced the dynamic tool-result token. It failed the original exact-format assertion because it wrapped the token in prose and Markdown. The retained smoke report separately records functional tool-result consumption and exact formatting. See the current artifacts and STATE for final live status.

## Evaluation

The evaluation suite has three synthetic tasks and five irrelevant evidence records per task. The replay fixture includes a rejected quotation followed by correction. Grading checks stored status, exact quotations, revisions, required source coverage, unexpected citations, missing information and duplicate briefs.

Live deterministic and Laya runs must use the same model, suite, budgets and trial count for comparison. The comparator rejects missing or duplicate case/trial identities and configuration differences other than selector policy. Reports label replay, generator loading, token availability and memory scope. Parent-process RSS excludes native worker memory. No statistical significance or general model performance is claimed.

## Remaining checks

Update this section as live artifacts are produced. A mock pass is never a native pass. A native probe pass is not by itself a full handoff pass. Clean-install reproduction, live cancellation, full handoff and Laya ablation status must be read from the current evidence record.
