# Reviewer reliability results

The tested application snapshot is `cd4b146d29981574c70897e5ff479e1658f7ca3e`. Later documentation and evidence commits do not change its application code. Three native default handoffs and the separately recorded Atlas variation passed on this source. These are small synthetic diagnostics, not a general success-rate estimate or proof of semantic correctness.

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

The [native summary](../artifacts/reviewer-check-cd4b146d-1793524312/native-summary.json), individual reports, traces and concise `progress.txt` transcripts are retained under `artifacts/reviewer-check-cd4b146d-1793524312`. The [recorded-state audit](../artifacts/reviewer-check-cd4b146d-1793524312/state-audit.json) checks required sources, consumption, empty missing lists, uncertainty and deduplication from captured native store results. The audit itself performs no inference and adds no trial.

## Setup verification and measurement scope

A fresh Git archive on the Linux filesystem passed `npm ci --maxsockets=2`, QVAC bundling, build, formatting and **181/181 tests** in 29249.19 ms. The two-call native smoke reproduced a fresh token delivered only through a tool result exactly, in 29314.50 ms. The full verifier exited 0. [The setup manifest](../artifacts/reviewer-check-cd4b146d-1793524312/setup.json) records source, Linux x64, Node 22.21.1 and lock SHA-256 `898cb7ce5f3ef9897667b9acb984b6a8c47085096f337380a3bddc90bf8e532a`.

The supported Node binary and npm download cache existed. Source and node_modules were fresh; model weights were linked to the existing persistent QVAC cache. No uncached weight download or fresh offline installation is claimed. Ubuntu 24.04 WSL2 exposed approximately 3916 MiB RAM and 2048 MiB swap. Installation used a 384 MiB V8 heap allowance, not a total-process memory cap. Installation and inference were serial. No global Node, graphics driver or host configuration was changed.

Loading and generation counters are sums of the exposed per-call SDK measurements, including loads after peer restart. Input token totals are not unique tokens. OS and file caches were uncontrolled. The smoke's RSS measurement covers the parent Node process and excludes the native worker; system free memory is not model attribution. No native-worker memory peak is established by this pass.

## Frozen new incident cases

Definitions were committed at `3f05f44` before observing results. `data/review-freeze-v1.json` records the raw file hashes. The definitions and grader quotations were not changed after failures. Expected quotations are checked after generation, not passed to the agent as mandatory context. Later reruns of exposed cases are diagnostics, not new held-out trials.

| New case | Execution at final source | Outcome |
| --- | --- | --- |
| Atlas asset export, missing chunk setting | Real native two-peer workflow | Completed in 6 calls, 1 repair and 260900.27 ms. The final brief quotes the item-640 journal observation and the 512-to-64 setting change, with uncertainty about cause. |
| Thumbnail failures described as preview rendering | Controlled agent, actual tools and store | Completed in 4 calls, 0 repairs and 98.07 ms. Initial lexical span coverage was zero. Empty-query navigation exposed the source metadata; an actual read supplied the accepted quote. |
| Map tile cache condition and units late in a long record | Controlled agent, actual tools and store | Completed in 3 calls, 0 repairs and 37.36 ms. Search/read reached UTF-16 offset 3264 and recovered both condition and seconds-versus-milliseconds spans. |
| Broker deadline with only unrelated evidence | Controlled agent, actual tools and store | Pending in 2 calls, 0 repairs and 20.59 ms. One unanswered request persisted, with no brief and no accepted observation. This is safely unresolved, not a completed investigation. |

The [controlled report](../artifacts/reviewer-check-cd4b146d-1793524312/controlled.json) includes actual history-dependent actions, persisted outcomes and traces. Scripted responses assert real tool results and protocol; they do not measure model reasoning. The broker baseline at `ff8de7b` committed a request but failed with “No brief saved.” That failure remains in `artifacts/review-controlled-baseline.json`, separate from the safe pending result.

A reranker cannot recover a candidate excluded by lexical retrieval. The paraphrase case confirms this ceiling. Broader navigation works in its controlled sequence; native paraphrase recovery remains unverified. No case-specific synonym dictionary or forced relevant optional evidence was added.

## Earlier native attempts in this pass

Every earlier handoff attempt is retained below. They are not pooled with the final three repeats. Full reports and traces remain in the corresponding `artifacts/reviewer-check-<source>-<timestamp>` directories.

| Source | Attempt | Outcome | Calls / repairs | Elapsed ms | Cleanup |
| --- | --- | --- | ---: | ---: | --- |
| 66437b3 | Atlas variation | Completed | 6 / 1 | 244387.15 | Passed |
| 1d92009 | Default repeat 1 | Completed | 7 / 1 | 279841.37 | Passed |
| 1d92009 | Default repeat 2 | Completed | 7 / 1 | 286191.73 | Passed |
| 1d92009 | Default repeat 3 | Completed | 7 / 1 | 284064.73 | Passed |
| 1d92009 | Atlas variation | Failed before pending work | 5 / 2 | 190245.98 | Passed |
| 0cfdea8 | Default repeat 1 | Completed | 7 / 1 | 289397.61 | Passed |
| 0cfdea8 | Default repeat 2 | Completed | 7 / 1 | 285490.67 | Passed |
| 0cfdea8 | Default repeat 3 | Completed | 9 / 2 | 381208.89 | Passed |
| 0cfdea8 | Atlas variation | Failed during resumption | 8 / 2 | 333917.25 | Passed |

At `1d92009`, Atlas committed its request, then failed quote-count validation twice. The full 180-character journal excerpt had been read, with no context group dropped or overflow. This was not a demonstrated retrieval miss. Raw rejected arguments were not logged; the old error checks both zero and more than 32 entries, so an empty map was an inference rather than a captured count. New feedback reports the count without quotation text.

At `0cfdea8`, Atlas reached offline contribution and resumption, then repeated `REQUEST_REQUIRED` after the existing request already had a linked response. The intervening request reused the same answered request ID. Its prior valid pending brief remained stored; no invalid completed brief was accepted. The rejected missing strings were not logged, so their exact semantic content is unknown. Both verifiers correctly exited 1.

Snapshot `0077bfe` installed dependencies and bundled successfully but failed the TypeScript build on a new test assertion's optional message argument. No native attempt ran on it. The [build failure](../artifacts/reviewer-check-0077bfe9-1793523881/build-failure.txt) and [stage record](../artifacts/reviewer-check-0077bfe9-1793523881/failure.json) remain. The test-only argument was corrected, type checking passed, then the complete final verifier ran at `cd4b146`.

## Focused fixes and regression evidence

- Request-only work can remain pending without fabricating a brief when no source has been read and an owned unanswered request exists. Malformed calls and output-limit failures still follow bounded failure handling. Cancellation is rechecked after the awaited request scan and before checkpointing.
- A post-request-commit interruption test reopens the store and retries without another request record. An unavailable paired-block test fails visibly, then succeeds after real reconnection instead of inventing absent evidence. These are controlled commit-boundary tests, not arbitrary OS power-loss tests.
- Native quote schemas explicitly require the sole available key. With additional properties forbidden, this is equivalent to the existing nonempty-map rule. Multiple optional sources are not all forced into a brief. SDK loose schema fields are preserved, but complete native grammar enforcement is not assumed; runtime validation remains independent.
- `ANSWERED_REQUEST` feedback distinguishes existing linked responses from a genuinely new gap. It asks for review/citation, removal of resolved missing items, uncertainty for interpretations, or a new question without reusing an answered need ID. Controlled tests prove both completion and preservation of a new pending gap without duplicate answered requests. No acceptance check or budget was weakened.
- Demo startup frames pretty or chunked JSON, reports early exit promptly and closes a child whose startup failed. Shutdown recognises signal termination. Progress exposes work, waiting, requests, contributions, replication, resumption and cleanup. A new terminal pending child is reported promptly rather than waiting twelve minutes. Completion still requires contribution consumption and citations.
- Structured smoke failures survive staged-source cleanup, and failed demo reports retain final cleanup. Setup and troubleshooting explain cancellation acknowledgment versus settlement and use unique report and store paths.

The existing suite also checks malformed and unknown tools, protocol IDs, repeated actions, cumulative exhaustion, cancellation stages, overflow, stale locally known evidence, committed-brief recovery, delayed/disconnected replication and duplicate resumption. Its 181 passing tests include controlled models and real separate-process P2P checks. They are not 181 native model trials.

## Remaining submission limits

Native recovery for the new paraphrase, late-record and no-relevant-optional cases is unverified. The earlier native long-record pass took about 11.9 minutes at `2f23582`; this pass does not establish a repeated long-record result or speed improvement at the final source. MiniLM and Laya retain separately scoped probes and older evaluations, with no newly verified complete two-peer workflow here. Earlier failed held-out agent reports remain failures for their snapshots.

Freshness means the latest locally available information, not global consensus or exactly-once distributed effects. Quotations establish what a source reports, not source truth or causal correctness. Context accounting remains an estimate. Model behaviour still varies, and the third final repeat used its full two-repair budget. Three passes support this demo, not broad reliability.

The required personally written design section remains deferred and untouched. The repository stays private and owner-only, with no invitations as requested. Suyash must arrange reviewer access when he chooses to share it. See the [reviewer guide](REVIEWING.md) for setup, live commands, cancellation and retained data.
