# Relay project notes

Relay is an engineering handoff agent using local QVAC inference and independently owned Hyperbee2 trees. The repository is https://github.com/da-goat37/prac-sdk and its privacy is verified. Do not publish publicly. The user explicitly revoked the earlier collaborator invitation request. Do not invite reviewers or add any other account without a new explicit instruction.

## Conventions

- Use code-fix/<short-description> for new branches.
- Repository-local author and committer: Suyash Bhattarai <bhattarai.suyash777@gmail.com>. No coauthor trailers.
- Preserve source reference projects unchanged.
- Trusted code controls record acceptance, permissions, budgets and transitions.
- New brief facts are exact source quotations under quoted-observations-v1. Generated interpretations belong in labelled uncertainty. Automated evaluation passes are not semantic truth scores. Version 1 reports predate these guards; current comparisons require report version 2.
- Never substitute replay for a live model result. Never read another peer directory to simulate replication.
- Leave the assessment's personal design prose to Suyash. Ordinary setup and reference documentation can be maintained here.

## Runtime

Windows Node is 22.20.0. Windows GPU Vulkan API is 1.3.260; QVAC 0.22 documents Vulkan 1.4 on Windows. The verified native path is Ubuntu 24.04 WSL2 CPU inference. Qwen3 1.7B Q4 is the default; the v6 two-peer handoff completed in 343463 ms with seven cumulative model calls and two repairs. Peer B contributed from its own store while A was offline; A reconnected, cited the health log and deployment configuration, completed the brief, and deduplicated after a further restart. The 1.7B tool-result probe passed in two calls with exact format in 28.56 s; cancel() returned in 32.77 ms after native output, and the completion rejected as INFERENCE_CANCELLED. A local Node 22.21.1 runtime is in ignored `.tools`; use `scripts/linux.sh` to select it. Do not change global drivers or toolchains. WSL has about 4 GiB RAM. Run dependency installation and model work sequentially; a clean install was observed around 2.8 GiB RSS even with a bounded V8 heap.

The v5 selector matrix used source snapshot `872df5c` and passed 6/6 automated checks in both deterministic and Laya arms. Laya made six valid decisions with no fallback or truncation, but selected all six candidates including five irrelevant records on every task. No filtering benefit was observed; deterministic remains the default. This matrix is not evidence for the later v6 handoff snapshot. See `docs/EVALUATION.md` for the measurement scope and limitations.

The clean Linux verification for source `fd54add` passed fresh `npm ci`, QVAC bundle, build and 110/110 tests with zero reported vulnerabilities. The v6 handoff report at the same source is one successful live run, not a success-rate claim. Keep the snapshot identity clear when citing the earlier selector matrix.

## Project map

The current passage retrieval implementation is on `code-fix/passage-retrieval`; source `2aa0360` has passed 143/143 integrated tests. The fresh installation at `57fc4d6` passed 129/129 tests and zero audit findings with the same dependency lock. Keep those source scopes separate. Current native long-record verification is recorded in `docs/STATE.md` as it completes.

The new selection matrix has 54 rows over nine frozen cases. Each selector recovered 7/9 held-out spans per trial with seven distractor passages; no measured ranker benefit supports changing the lexical default. All six native held-out agent runs at the earlier `57fc4d6` harness failed. Preserve them. Later generic harness repairs do not turn those failures into passes. See `docs/RETRIEVAL_EVALUATION.md`.

- src/store.ts: owned trees, replication and record reads.
- src/records.ts: runtime schemas and stable identities.
- src/agent.ts: model/tool loop and persisted progress.
- src/context.ts: bounded context and selectors.
- src/retrieval.ts: exact source passages, lexical retrieval and rebuildable index.
- src/minilm.ts: pinned local-only ONNX ranking, cache and resource lifecycle.
- src/selectors.ts: explicit lexical, MiniLM and Laya selection.
- src/qvac.ts: SDK boundary, cancellation and model lifecycle.
- src/laya.ts: optional bounded native relevance selection with visible fallback.
- src/cli.ts: peer process and user commands.
- src/resume.ts: contribution tracking, restart recovery and bounded automatic resumption.
- src/eval.ts: live and labeled replay evaluation, state checks and strict comparison.
- src/regrade.ts: read-only checks over captured version 2 fixture state, without inference or writes.
- src/retrieval-eval.ts: separate passage selection and full native agent measurements.
- src/retrieval-regrade.ts: corrected checks over captured passage selections.
- src/recorded-ranking.ts: inference-free budgeting replay of captured native rankings with explicit provenance.
- test/: policy, harness and separate-process P2P checks.
- docs/STATE.md: current evidence and next steps.
- docs/DECISIONS.md: confirmed requirements and implementation choices.
- docs/TESTING.md: commands, evidence and remaining gaps.

## Verified commands

- npm run build
- npm test (110 tests passed from a clean Linux install at source fd54add)
- npm test (143 tests passed for the passage implementation at source 2aa0360, existing verified dependencies)
- npm run ranker:prepare (explicit network download; pinned SHA-256 files)
- npm run ranker:probe (real CPU logits, paired tokenization and cleanup; retained artifact)
- npm run evaluate:retrieval -- --mode retrieval --trials 2 (native 54-row captured matrix at 57fc4d6)
- npm run smoke (selected Qwen3 1.7B tool-result probe: two calls, exact format true)
- node --import tsx scripts/cancel-smoke.ts (native cancellation)
- npm run evaluate -- --mode replay --trials 3 --output artifacts/replay.json
- npm run demo (one complete native 1.7B v6 handoff with offline contribution and restart deduplication)

The v5 Laya ablation is complete and showed no candidate-filtering benefit; it predates the v6 handoff source. The selected live probes and full handoff are retained as artifacts. Do not infer verification from the existence of a script. Keep docs/TESTING.md current after meaningful verification.
