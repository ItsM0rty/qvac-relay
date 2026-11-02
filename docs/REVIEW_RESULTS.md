# Reviewer reliability results

## Final native check of the review fixes, 2026-11-02

One real QVAC two-peer default short-record handoff passed at checkout `19f5a44f01fe2005b09cc98364b1b0d5da6b7051`. Its application code is the fixed `40ff12c963b04ff9c98ae67a49f3268d99ba2ece` source, unchanged by the intervening evidence commit. Before this attempt the working tree was clean, both remote branches still pointed to `cfa92b6`, and the private repository was authenticated as da-goat37.

The run completed in **458437.24 ms**, about 7.6 minutes, with **7 cumulative model calls and 1 repair**. The repair rejected a save before the required information request; the model then recorded that request. There was no terminal model, infrastructure or cleanup error. A saved pending work, its request replicated to B, A stopped cleanly, and B wrote its linked answer into B's own store while A was offline. A restarted with the same identity, received the contribution through replication and resumed automatically. The final brief cites both health-log and deployment-config, contains no missing items, and retains the trusted root-cause uncertainty notice. Repeated scans and another restart left the completed checkpoint unchanged. Both peers stopped cleanly.

A post-run audit opened only A's persisted store. It verified B's ownership of the received answer, its request link, source revisions, exact quoted text, both source IDs, empty missing items and the unchanged final checkpoint. Initial and resumed model cleanup reported no errors. The demo and audit exited 0; a subsequent process check found no WSL Node, Bare, npm or tsx processes. Peer stores remain at `.relay/final-native-19f5a44-20261102-d99154`.

[The summary](../artifacts/final-native-19f5a44-20261102-d99154/summary.json), native report, actual traces, progress/stdout logs, frozen attempt plan and audit source are retained under `artifacts/final-native-19f5a44-20261102-d99154`. Native configuration was QVAC 0.22.0 Qwen3 1.7B Q4, CPU, deterministic selection, required native tools, context 8192, output 768, temperature 0.7, top-p 0.8, top-k 20 and one sequence. SDK totals were 11040 input tokens, 420 generated tokens, 166924.63 ms loading and 238887.38 ms generation, summed across calls including reload after restart. These are not unique input tokens or worker memory measurements.

This reused the existing verified Ubuntu 24.04 WSL2 setup, Node 22.21.1, installed dependencies, worker bundle and cached weights, with fresh peer stores. No fresh installation or uncached model download was tested. No application code changed after the passing 187-test, build, bundle, formatting, three controlled incident and nine replay checks recorded below, so those checks were not repeated. This one new native attempt is separate from every earlier result. It is not a new three-run reliability set, a long-record test, an optional-selector test or a speed improvement claim. Owner-answer and partial-close faults remain covered by controlled regressions rather than injected native scenarios. Personal design prose and repository access were untouched.

## Independent review repairs, 2026-11-01

The three findings at `cfa92b6` were reproduced before application changes. The retained [pre-fix output](../artifacts/review-fixes-cfa92b6/before.tap) has four failing regressions and two passing controls. Failures cover owner-answer finalization, owner-answer committed-brief recovery, skipped cleanup resources, and a failed diagnostic report exiting 0. [Reproduction scope](../artifacts/review-fixes-cfa92b6/reproduction.json) distinguishes the unchanged application from the newly added tests.

Application source `40ff12c963b04ff9c98ae67a49f3268d99ba2ece` fixes all three findings. Linked-answer coverage includes every owner during completion and committed-brief recovery. Uncited answers keep the old brief pending and become required context for refresh. Already-cited revisions recover without inference. Accepted writes are retained. The separate remote-contribution policy for work without an accepted brief is unchanged.

Diagnostics write all outcomes before setting exit status 1 on failure. A real subprocess test reads the retained failed report and checks its nonzero status; a passing subprocess checks status 0. Shutdown shares concurrent close attempts, attempts all captured resource steps, aggregates failures and their causes, and retries only rejected steps on a later explicit close. The store stays closed to new work. Injected remote-tree and local-tree failures verify other trees and Corestore are still closed, concurrent callers both observe failure, successful steps are not repeated, retry succeeds, and the directory can reopen. Dependency close calls are assumed safe to repeat after partial failure; an indefinitely hanging dependency close is not bounded by this change.

At that exact source, Ubuntu 24.04 WSL2 with project-local Node 22.21.1 passed QVAC bundling, TypeScript build, formatting and **187/187 tests** in 184332.84 ms. The suite includes real separate-process P2P replication, disconnect/reconnect and restart checks. All three frozen controlled incidents passed: paraphrase and late-detail completed; absent optional evidence stayed safely pending. Replay passed all nine rows across three cases and three trials. These use controlled/scripted models with actual tools and stores, not native inference. Existing dependencies were reused with the unchanged lockfile; no fresh installation, uncached model download or new native handoff is claimed. The [verification manifest](../artifacts/review-fixes-cfa92b6/verification.json), full TAP, controlled report, replay report and command transcript are retained together.

An intermediate build caught a Node error type annotation and was corrected before the committed source was verified. Both build logs remain retained. Evaluation harness identity is v15; passage evaluation configuration is 11. All earlier native passes and failures remain historical evidence for their original sources. The prior three-pass native set does not establish native reliability on this changed source. A final process check found no WSL Node, Bare, npm or tsx processes. No repository access, invitations or personal design prose changed.

The historical native-tested application snapshot is `d63f00cb9147176b1e20866c7ca7c0313c9f800c`. Documentation and evidence through `cfa92b6` did not change its application code; the independent-review repair above is a new source. Three native default handoffs and the separately recorded Atlas variation passed on this source. These are small synthetic diagnostics, not a general success-rate estimate or proof of semantic correctness.

## Final native results

All four attempts used QVAC 0.22.0, Qwen3 1.7B Q4 on CPU, deterministic lexical selection, model context 8192, output limit 768, temperature 0.7, top-p 0.8, top-k 20 and one sequence. The application context limit is 7000 conservatively estimated tokens, not an exact generator token count. Calls and repairs are cumulative across initial work and automatic resumption. Every attempt used fresh peer stores, the same archived source and dependency install. No automatic retries or scripted model responses were used.

| Attempt | Outcome | Model calls | Repairs | Elapsed ms | SDK input/output tokens | Loading ms | Cleanup |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Default repeat 1 | Completed | 6 | 1 | 257914.46 | 9508 / 437 | 40663.41 | Passed |
| Default repeat 2 | Completed | 6 | 1 | 258688.59 | 9544 / 429 | 41586.33 | Passed |
| Default repeat 3 | Completed | 9 | 2 | 367406.64 | 14686 / 616 | 39918.15 | Passed |
| Atlas variation | Completed | 6 | 1 | 260900.27 | 9458 / 418 | 39735.18 | Passed |

Each attempt saved pending work, replicated the question to B, stopped A, wrote B's linked answer while A was offline, restarted A with its persistent identity, replicated the answer and resumed automatically. The final briefs cite both original and contributed evidence, contain no missing items and preserve the trusted uncertainty notice. Repeated scans and another restart did not resume completed work. Both peer processes exited cleanly. A final process check found no Node, Bare, npm, tsx or Relay peer processes in WSL. Stores and earlier reports remain intact.

All four initial runs needed a correction for proposing a brief before requesting the declared need. Repeat 3 also exercised the new `ANSWERED_REQUEST` feedback natively before completing. These are corrected workflows, not first-attempt-perfect behaviour. The first two repeats batched independent resumed reads into one model turn. The observed latency and call differences do not establish a speed improvement.

The [native summary](../artifacts/reviewer-check-d63f00cb-1793524312/native-summary.json), individual reports, traces and concise `progress.txt` transcripts are retained under `artifacts/reviewer-check-d63f00cb-1793524312`. The [recorded-state audit](../artifacts/reviewer-check-d63f00cb-1793524312/state-audit.json) checks required sources, consumption, empty missing lists, uncertainty and deduplication from captured native store results. The audit itself performs no inference and adds no trial.

## Setup verification and measurement scope

A fresh Git archive on the Linux filesystem passed `npm ci --maxsockets=2`, QVAC bundling, build, formatting and **181/181 tests** in 29249.19 ms. The two-call native smoke reproduced a fresh token delivered only through a tool result exactly, in 29314.50 ms. The full verifier exited 0. [The setup manifest](../artifacts/reviewer-check-d63f00cb-1793524312/setup.json) records source, Linux x64, Node 22.21.1 and lock SHA-256 `898cb7ce5f3ef9897667b9acb984b6a8c47085096f337380a3bddc90bf8e532a`.

The supported Node binary and npm download cache existed. Source and node_modules were fresh; model weights were linked to the existing persistent QVAC cache. No uncached weight download or fresh offline installation is claimed. Ubuntu 24.04 WSL2 exposed approximately 3916 MiB RAM and 2048 MiB swap. Installation used a 384 MiB V8 heap allowance, not a total-process memory cap. Installation and inference were serial. No global Node, graphics driver or host configuration was changed.

Loading and generation counters are sums of the exposed per-call SDK measurements, including loads after peer restart. Input token totals are not unique tokens. OS and file caches were uncontrolled. The smoke's RSS measurement covers the parent Node process and excludes the native worker; system free memory is not model attribution. No native-worker memory peak is established by this pass.

## Frozen new incident cases

Definitions were committed at `e84206f` before observing results. `data/review-freeze-v1.json` records the raw file hashes. The definitions and grader quotations were not changed after failures. Expected quotations are checked after generation, not passed to the agent as mandatory context. Later reruns of exposed cases are diagnostics, not new held-out trials.

| New case | Execution at final source | Outcome |
| --- | --- | --- |
| Atlas asset export, missing chunk setting | Real native two-peer workflow | Completed in 6 calls, 1 repair and 260900.27 ms. The final brief quotes the item-640 journal observation and the 512-to-64 setting change, with uncertainty about cause. |
| Thumbnail failures described as preview rendering | Controlled agent, actual tools and store | Completed in 4 calls, 0 repairs and 98.07 ms. Initial lexical span coverage was zero. Empty-query navigation exposed the source metadata; an actual read supplied the accepted quote. |
| Map tile cache condition and units late in a long record | Controlled agent, actual tools and store | Completed in 3 calls, 0 repairs and 37.36 ms. Search/read reached UTF-16 offset 3264 and recovered both condition and seconds-versus-milliseconds spans. |
| Broker deadline with only unrelated evidence | Controlled agent, actual tools and store | Pending in 2 calls, 0 repairs and 20.59 ms. One unanswered request persisted, with no brief and no accepted observation. This is safely unresolved, not a completed investigation. |

The [controlled report](../artifacts/reviewer-check-d63f00cb-1793524312/controlled.json) includes actual history-dependent actions, persisted outcomes and traces. Scripted responses assert real tool results and protocol; they do not measure model reasoning. The broker baseline at `20c7b43` committed a request but failed with “No brief saved.” That failure remains in `artifacts/review-controlled-baseline.json`, separate from the safe pending result.

A reranker cannot recover a candidate excluded by lexical retrieval. The paraphrase case confirms this ceiling. Broader navigation works in its controlled sequence; native paraphrase recovery remains unverified. No case-specific synonym dictionary or forced relevant optional evidence was added.

## Earlier native attempts in this pass

Every earlier handoff attempt is retained below. They are not pooled with the final three repeats. Full reports and traces remain in the corresponding `artifacts/reviewer-check-<source>-<timestamp>` directories.

| Source | Attempt | Outcome | Calls / repairs | Elapsed ms | Cleanup |
| --- | --- | --- | ---: | ---: | --- |
| 522bfa1 | Atlas variation | Completed | 6 / 1 | 244387.15 | Passed |
| 0eaa3cd | Default repeat 1 | Completed | 7 / 1 | 279841.37 | Passed |
| 0eaa3cd | Default repeat 2 | Completed | 7 / 1 | 286191.73 | Passed |
| 0eaa3cd | Default repeat 3 | Completed | 7 / 1 | 284064.73 | Passed |
| 0eaa3cd | Atlas variation | Failed before pending work | 5 / 2 | 190245.98 | Passed |
| 83f9e24 | Default repeat 1 | Completed | 7 / 1 | 289397.61 | Passed |
| 83f9e24 | Default repeat 2 | Completed | 7 / 1 | 285490.67 | Passed |
| 83f9e24 | Default repeat 3 | Completed | 9 / 2 | 381208.89 | Passed |
| 83f9e24 | Atlas variation | Failed during resumption | 8 / 2 | 333917.25 | Passed |

At `0eaa3cd`, Atlas committed its request, then failed quote-count validation twice. The full 180-character journal excerpt had been read, with no context group dropped or overflow. This was not a demonstrated retrieval miss. Raw rejected arguments were not logged; the old error checks both zero and more than 32 entries, so an empty map was an inference rather than a captured count. New feedback reports the count without quotation text.

At `83f9e24`, Atlas reached offline contribution and resumption, then repeated `REQUEST_REQUIRED` after the existing request already had a linked response. The intervening request reused the same answered request ID. Its prior valid pending brief remained stored; no invalid completed brief was accepted. The rejected missing strings were not logged, so their exact semantic content is unknown. Both verifiers correctly exited 1.

Snapshot `5adc76c` installed dependencies and bundled successfully but failed the TypeScript build on a new test assertion's optional message argument. No native attempt ran on it. The [build failure](../artifacts/reviewer-check-5adc76c0-1793523881/build-failure.txt) and [stage record](../artifacts/reviewer-check-5adc76c0-1793523881/failure.json) remain. The test-only argument was corrected, type checking passed, then the complete final verifier ran at `d63f00c`.

## Focused fixes and regression evidence

- Request-only work can remain pending without fabricating a brief when no source has been read and an owned unanswered request exists. Malformed calls and output-limit failures still follow bounded failure handling. Cancellation is rechecked after the awaited request scan and before checkpointing.
- A post-request-commit interruption test reopens the store and retries without another request record. An unavailable paired-block test fails visibly, then succeeds after real reconnection instead of inventing absent evidence. These are controlled commit-boundary tests, not arbitrary OS power-loss tests.
- Native quote schemas explicitly require the sole available key. With additional properties forbidden, this is equivalent to the existing nonempty-map rule. Multiple optional sources are not all forced into a brief. SDK loose schema fields are preserved, but complete native grammar enforcement is not assumed; runtime validation remains independent.
- `ANSWERED_REQUEST` feedback distinguishes existing linked responses from a genuinely new gap. It asks for review/citation, removal of resolved missing items, uncertainty for interpretations, or a new question without reusing an answered need ID. Controlled tests prove both completion and preservation of a new pending gap without duplicate answered requests. No acceptance check or budget was weakened.
- Demo startup frames pretty or chunked JSON, reports early exit promptly and closes a child whose startup failed. Shutdown recognises signal termination. Progress exposes work, waiting, requests, contributions, replication, resumption and cleanup. A new terminal pending child is reported promptly rather than waiting twelve minutes. Completion still requires contribution consumption and citations.
- Structured smoke failures survive staged-source cleanup, and failed demo reports retain final cleanup. Setup and troubleshooting explain cancellation acknowledgment versus settlement and use unique report and store paths.

The existing suite also checks malformed and unknown tools, protocol IDs, repeated actions, cumulative exhaustion, cancellation stages, overflow, stale locally known evidence, committed-brief recovery, delayed/disconnected replication and duplicate resumption. Its 181 passing tests include controlled models and real separate-process P2P checks. They are not 181 native model trials.

## Remaining submission limits

Native recovery for the new paraphrase, late-record and no-relevant-optional cases is unverified. The earlier native long-record pass took about 11.9 minutes at `59fd3a5`; this pass does not establish a repeated long-record result or speed improvement at the final source. MiniLM and Laya retain separately scoped probes and older evaluations, with no newly verified complete two-peer workflow here. Earlier failed held-out agent reports remain failures for their snapshots.

Freshness means the latest locally available information, not global consensus or exactly-once distributed effects. Quotations establish what a source reports, not source truth or causal correctness. Context accounting remains an estimate. Model behaviour still varies, and the third final repeat used its full two-repair budget. Three passes support this demo, not broad reliability.

The required personally written design section remains deferred and untouched. The repository stays private and owner-only, with no invitations as requested. Suyash must arrange reviewer access when he chooses to share it. See the [reviewer guide](REVIEWING.md) for setup, live commands, cancellation and retained data.
