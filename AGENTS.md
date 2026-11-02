# Relay project notes

Relay is an engineering handoff agent using local QVAC inference and independently owned Hyperbee2 trees. The intended submission repository is https://github.com/ItsM0rty/qvac-relay; verify its privacy before pushing. Do not publish publicly. The user explicitly revoked the earlier collaborator invitation request. Do not invite reviewers or add any other account without a new explicit instruction.

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

The v5 selector matrix used source snapshot `4fb380c` and passed 6/6 automated checks in both deterministic and Laya arms. Laya made six valid decisions with no fallback or truncation, but selected all six candidates including five irrelevant records on every task. No filtering benefit was observed; deterministic remains the default. This matrix is not evidence for the later v6 handoff snapshot. See `docs/EVALUATION.md` for the measurement scope and limitations.

The clean Linux verification for source `e336b55` passed fresh `npm ci`, QVAC bundle, build and 110/110 tests with zero reported vulnerabilities. The v6 handoff report at the same source is one successful live run, not a success-rate claim. Keep the snapshot identity clear when citing the earlier selector matrix.

## Project map

Final native follow-up on 2026-11-02: clean checkout `19f5a44` (same application code as `40ff12c`) passed one default real two-peer handoff in 458437.24 ms, 7 cumulative calls and 1 repair. Offline contribution, replication, resumption, both current quotations, restart deduplication and cleanup passed; no native processes remained after the persisted-state audit. Existing setup/weights were reused with fresh stores. Evidence: artifacts/final-native-19f5a44-20261102-d99154. This is one new attempt, separate from the older three-pass set; no long-record or optional-selector result is implied. The previous 187-test checks still cover identical application code.

Current application source `40ff12c` fixes the independent-review findings at `cfa92b6`: any owner's linked answer participates in citation coverage and committed-brief recovery; failed controlled diagnostics retain their report and exit 1; store cleanup attempts every resource and explicitly retries only rejected steps. Bundle, build, formatting, 187 tests, three controlled incidents and nine replay rows passed on WSL with existing dependencies. That earlier controlled verification performed no native inference or fresh install; the separately recorded follow-up above adds one native run. Evidence: artifacts/review-fixes-cfa92b6. Evaluation identities are v15 and passage configuration 11. Keep historical native results scoped to their original source. See docs/REVIEW_RESULTS.md for reproduction and retry limitations.

The reviewer reliability branch is `code-fix/reviewer-reliability`. Tested application source `d63f00c` passed a fresh Linux install, bundle, build, formatting and 181 tests. Its three native default handoffs passed in 6/1, 6/1 and 9/2 model calls/repairs; a separate Atlas variation passed in 6/1. All used fresh stores and verified cleanup and restart deduplication. Earlier Atlas failures and build failures remain retained by source. Read docs/STATE.md and docs/REVIEW_RESULTS.md before new work. `RELAY_REVIEW_REPEAT=3 npm run verify:review` repeats the serial fresh-source plan and preserves unique reports; Node, npm downloads and model weights may be reused, with fresh node_modules. Never pool changed snapshots or treat controlled/replay responses as native inference.

The prior passage milestone was on `code-fix/passage-retrieval`; source `59fd3a5` passed 168 tests, build and formatting, then passed the real long-record handoff in 711784.74 ms with 11 cumulative calls and 2 repairs. Offline contribution, real replication, both late quotations, cleanup, restart deduplication and graceful peer exit passed. This is one development run, not a general success rate. Fresh installation at 9972119 used the same dependency lock; final 168 tests reused verified dependencies. Read docs/STATE.md for details.

The new selection matrix has 54 rows over nine frozen cases. Each selector recovered 7/9 held-out spans per trial with seven distractor passages; no measured ranker benefit supports changing the lexical default. All six native held-out agent runs at the earlier `9972119` harness failed. Preserve them. Later generic harness repairs do not turn those failures into passes. See `docs/RETRIEVAL_EVALUATION.md`.

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
- src/control-client.ts: authenticated loopback JSON commands with a full response deadline.
- src/brief-input.ts: strict native source-keyed quotes and mandatory source schema, with independent runtime checks.
- src/tool-budget.ts: pure fit check against protected next-turn context and complete protocol.
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
- npm test (110 tests passed from a clean Linux install at source e336b55)
- npm test (168 tests passed for the passage implementation at source 59fd3a5, existing verified dependencies)
- npm run ranker:prepare (explicit network download; pinned SHA-256 files)
- npm run ranker:probe (real CPU logits, paired tokenization and cleanup; retained artifact)
- npm run evaluate:retrieval -- --mode retrieval --trials 2 (native 54-row captured matrix at 9972119)
- npm run smoke (selected Qwen3 1.7B tool-result probe: two calls, exact format true)
- node --import tsx scripts/cancel-smoke.ts (native cancellation)
- npm run evaluate -- --mode replay --trials 3 --output artifacts/replay.json
- npm run demo (one complete native 1.7B v6 handoff with offline contribution and restart deduplication)

The v5 Laya ablation is complete and showed no candidate-filtering benefit; it predates the v6 handoff source. The selected live probes and full handoff are retained as artifacts. Do not infer verification from the existence of a script. Keep docs/TESTING.md current after meaningful verification.
