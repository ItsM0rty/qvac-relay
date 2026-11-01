# Current state

Updated 2026-11-01. Current application source is `c4702c214abff5f507cb0a5f342b4973e9f93b41`, fixing all three independent-review findings reproduced at `e9731d0`. It passed bundle, build, formatting, 187 tests, three controlled incident checks and nine replay rows using existing dependencies. No new native inference ran on this source. The historical native reliability pass remains at `cd4b146d29981574c70897e5ff479e1658f7ca3e`; evidence and documentation through `e9731d0` did not change that older application source. The working branch is `code-fix/reviewer-reliability`; the private repository's default branch remains `code-fix/relay-handoff`.

The canonical checkout is `C:\Users\m0rty\Desktop\Programming\Research\New folder\byteask\relay-agent`. Use Ubuntu 24.04 WSL2 CPU with Linux Node 22.21.1, or the documented supported Node range. Windows Node 22.20 and the observed Vulkan 1.3 path are not the verified inference environment. Do not change global tools or drivers.

## Independent review repair status

All three defects are fixed and regression-tested, including committed-brief recovery for owner-written linked answers. Store close attempts every captured resource, aggregates failures and allows an explicit retry of only rejected steps while rejecting new work. Diagnostic failures retain their report and exit nonzero. See docs/REVIEW_RESULTS.md and artifacts/review-fixes-e9731d0/verification.json for exact scope and pre-fix reproductions. Evaluation identities are v15 and passage configuration 11.

The full verifier that includes fresh installation and native handoffs was not rerun. A new native run, if desired before submission, must be attributed to this changed source rather than combined with the historical three-pass set. No current failure remains from the three review findings. The final WSL process check found no Node, Bare, npm or tsx processes. Personal design prose stays deferred; access and historical stores/reports remain unchanged.

## Historical native-tested snapshot

Fresh Git archive source and fresh npm ci passed Linux QVAC bundle, build, formatting and **181/181 tests**. Existing Node, available npm downloads and cached QVAC weights were reused. The two-call native smoke passed with exact reproduction of a fresh tool-result token in 29314.50 ms. Uncached model download and fresh offline installation were not tested.

Three default short-record native handoffs ran serially from fresh stores on the same source/configuration. All completed offline contribution, genuine replication, restart resumption, both source citations, repeated-scan/restart deduplication and clean shutdown:

| Repeat | Model calls | Repairs | Elapsed ms |
| --- | ---: | ---: | ---: |
| 1 | 6 | 1 | 257914.46 |
| 2 | 6 | 1 | 258688.59 |
| 3 | 9 | 2 | 367406.64 |

The separate frozen Atlas variation completed in 260900.27 ms with six calls and one repair. The full verifier exited 0. Configuration identity was checked from actual native traces. Model: QVAC0.22.0 Qwen3 1.7B Q4 on CPU; selector: deterministic; native tool mode required; model context 8192 and output 768; application budget 7000 estimated tokens; sampling 0.7/0.8/top-k 20; one sequence. No broad reliability, semantic accuracy or speed improvement is claimed.

Evidence is under `artifacts/reviewer-check-cd4b146d-1793524312`: setup and smoke reports, full TAP, controlled diagnostics, native plan/summary, all four native reports/traces, progress transcripts and read-only recorded-state audit. Peer stores remain under `.relay/review-native-cd4b146d-reviewer-check-cd4b146d-1793524312-{repeat-1,repeat-2,repeat-3,variation-atlas}`. A final WSL process check found no remaining Node, npm, Bare, tsx or Relay processes. All earlier artifacts and peer data remain preserved.

## Changes and retained failures

Request-only work can safely wait without a fabricated brief, and cancellation during its awaited request scan now wins before checkpointing. Tests cover interruption after a request write commits, unavailable remote blocks and subsequent real reconnection. Startup parsing, child cleanup, concise progress and terminal pending-run reporting improve the guided demo.

A native quote-count failure led to explicitly requiring the sole available quote key, without weakening quotation validation. A later native failure exposed misleading repair feedback for requests with linked responses. `ANSWERED_REQUEST` now distinguishes resolved items from a genuinely new gap; controlled tests retain new gaps rather than erasing them. This branch was also exercised natively in final repeat 3. Evaluation harness version is v14; passage evaluation configuration is 10.

New incidents were frozen at `3f05f44`; data file hashes remain in `data/review-freeze-v1.json`. Final controlled paraphrase and late-detail cases completed using real tool results and stores; the no-relevant-evidence case remained pending with one request and no brief. They are scripted-model diagnostics, not native successes. Native paraphrase recovery remains unverified, and a reranker cannot recover a lexical candidate miss.

Earlier native Atlas failures at `1d92009` (quote-count validation) and `0cfdea8` (repeated missing-item feedback after an answer) are retained, along with their separately passing default repeats. An earlier Atlas pass at `66437b3` is also retained. `0077bfe` failed a test-only TypeScript build before native inference; `cd4b146` corrects that argument and is the final verified source. See docs/REVIEW_RESULTS.md for every attempt and scope. Never pool these snapshots or relabel earlier failures as passes.

The prior real long-record pass remains at source `2f23582`, in `artifacts/passage-demo-2f23582.json`, taking 711784.74 ms with 11 calls and 2 repairs. It is not repeated long-record evidence at the final source. Older native held-out failures and optional-selector measurements remain in docs/RETRIEVAL_EVALUATION.md, docs/TESTING.md and docs/DECISIONS.md. Deterministic lexical selection stays default; no newly measured MiniLM or Laya quality benefit is claimed.

## Reproduce and hand off

Follow README and docs/REVIEWING.md from a Linux filesystem checkout. For the guided native default demo, after setup:

```sh
RELAY_MODEL=1.7b RELAY_SELECTOR=deterministic npm run demo
```

For the full fresh-source verification and three serial repetitions plus separate Atlas variation:

```sh
RELAY_REVIEW_REPEAT=3 npm run verify:review
```

The verifier retains unique report and store paths. It archives committed source, so uncommitted edits are excluded. Do not use the older clean-verify script when preserving historical filenames. Heavy installation and model jobs must remain serial on this approximately 4 GiB WSL allocation. Cancellation acknowledgment is prompt; native settlement is cooperative. Check active/cleanup status before stopping manually started peers.

Freshness is local to received data, not global consensus or exactly-once effects. Accepted quotes do not prove source truth. The context budget is estimated. Repeated model corrections and failures remain possible. Use new unseen families for future quality evaluation; exposed fixtures are regressions, not independent holdouts.

Suyash's personal design section is still deferred. Do not write it or ask again until he is ready. Repository access remains private and owner-only with no invitations. Do not add reviewers, send messages or publish a public PR. Publish only through a checked fast-forward to `code-fix/relay-handoff`; never force-push. The final documentation/evidence commit can follow the tested application source without changing it.
