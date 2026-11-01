# Reviewer reliability pass

The first consistency snapshot is `1d92009d9c458d386b9e5a6a942bdee70eb76cc6`. Its native Atlas variation failed, and a focused schema change is undergoing a new final verification. Results below remain evidence for `1d92009` until the separately labelled final snapshot is recorded. All new incident definitions were frozen at `3f05f44` before observing results. Their hashes remain in `data/review-freeze-v1.json`. This is a small synthetic diagnostic set, not a success-rate or semantic accuracy estimate.

## Setup and scope

A fresh Git archive on the Linux filesystem passed `npm ci --maxsockets=2`, QVAC bundling, build, formatting and 177 tests. Installation used a 384 MiB V8 heap allowance and ran without inference. Linux Node 22.21.1 and the npm download cache already existed. The dependency install and node_modules were fresh; QVAC model weights were linked to the existing persistent cache. The lock SHA-256 is `898cb7ce5f3ef9897667b9acb984b6a8c47085096f337380a3bddc90bf8e532a`. No uncached weight download or fresh offline install is claimed.

Execution used QVAC 0.22.0, Qwen3 1.7B Q4, CPU, 8192 model context, 768 output limit, temperature 0.7, top-p 0.8, top-k 20 and one sequence. The context policy was deterministic lexical selection with a 7000 conservative estimated-token application budget. WSL exposed approximately 3916 MiB RAM and 2048 MiB swap. All installation and model jobs were serial. No global Node, driver or host configuration was changed.

The two-call live smoke passed with exact reproduction of a fresh token delivered only in a tool result, in 34231.91 ms. Its parent Node RSS sample excludes the native worker; it is not peak model memory. Raw setup, smoke, controlled-case, native reports and traces are under [the retained report directory](../artifacts/reviewer-check-1d92009d-1793519793/).

## Repeated native workflow

The plan fixed three default short-record checkout handoffs before execution. Each attempt used separate fresh peer directories and the same archived source, dependency install, generator and selector. Existing model weights and uncontrolled OS/file caches were reused. The model still loaded for initial and resumed work. No scripted model response, automatic retry or unreported attempt is included.

| Attempt | Outcome | Cumulative calls | Repairs | Elapsed time | Cleanup |
| --- | --- | ---: | ---: | ---: | --- |
| Repeat 1 | Completed | 7 | 1 | 279841.37 ms | Passed |
| Repeat 2 | Completed | 7 | 1 | 286191.73 ms | Passed |
| Repeat 3 | Completed | 7 | 1 | 284064.73 ms | Passed |

Each attempt saved pending work, replicated its question, stopped A, wrote B's answer while A was offline, restarted A with its persistent identity, replicated the answer and resumed automatically. The completed brief quotes both `health-log` and `deployment-config`, has no missing items and retains the trusted uncertainty notice. Repeated scans and another restart did not start new completed work. Both peer processes exited cleanly.

In each run the first proposed brief omitted the required request. Trusted validation rejected it with `REQUIRED_INFORMATION_REQUEST`; the model requested the declared need and corrected the draft within the cumulative repair budget. These are completed workflows with a correction, not first-attempt-perfect model behaviour. Three passes support this demonstration only. They do not establish broad reliability, and they do not repeat the older long-record measurement.

## New incident diagnostics

| Frozen case | Execution | Outcome |
| --- | --- | --- |
| Atlas asset export, missing chunk setting | Real native two-peer workflow | Failed at `1d92009` after five calls, two repairs and 190245.98 ms. It stopped before pending work, offline contribution or resumption. Both peers exited cleanly. An earlier source passed separately. |
| Thumbnail failures described as preview rendering | Controlled agent, actual tools and store | Completed in four calls and zero repairs. Initial lexical span coverage was zero. An empty-query navigation call exposed the source, then the actual read result supplied the accepted quote. |
| Map tile cache condition and units late in a long record | Controlled agent, actual tools and store | Completed in three calls and zero repairs. Search/read recovered UTF-16 offset 3264 and both required spans, preserving the condition and seconds versus milliseconds. |
| Broker deadline with only unrelated evidence | Controlled agent, actual tools and store | Pending in two calls and zero repairs, one persisted unanswered request and no brief. No task completion or factual observation is claimed. |

The broker baseline at `ff8de7b` committed the request but failed with “No brief saved.” The failure remains in `artifacts/review-controlled-baseline.json`; the later result remains separate. The fix allows an ordinary waiting response to leave pending work without fabricating a quotation when no evidence has been read and an owned unanswered request exists. Malformed tool output and output-limit failures still receive bounded failure handling. Another controlled test supplies a real replicated answer afterward and verifies completion without repeated consumption.

The paraphrase diagnostic demonstrates the lexical ceiling. A reranker cannot recover a candidate lexical retrieval excluded. The existing broader navigation path works in this controlled sequence, but native paraphrase recovery remains unverified. No case-specific synonym dictionary, forced relevant optional evidence or semantic-search claim was added.

An earlier Atlas variation at source `66437b3` completed natively in 244387.15 ms with six calls and one repair, clean shutdown and restart deduplication. Its [report](../artifacts/reviewer-check-66437b3e-1793515021/native-handoff.json) remains separate from the final-source repetitions and variation. That source passed a separate fresh install and 176 tests; the later cancellation check was not yet present.

## Focused fixes and failure checks

At `1d92009`, Atlas first attempted a brief without requesting its declared need. After corrective feedback it committed the request, then failed quote-count validation twice. The repeated `ARGUMENTS` failure exhausted bounded correction and no brief was accepted. The trace confirms that the full 180-character original journal excerpt had been delivered, with no context groups dropped or overflow. This was not a lexical miss or missing source blocks. The rejected arguments are not logged. The old error checks both zero and more than 32 entries, so an empty map is an inference rather than a captured property count. New feedback reports the entry count without quotation text.

The native schema had one available quote property, no required quote keys, and `minProperties: 1`. The installed SDK preserves these loose JSON Schema fields, but the observed run did not satisfy the nonempty map constraint. The backend's enforcement mechanism is not established by these traces. The focused change explicitly requires the sole key when only one source is available. With additional properties forbidden, this is equivalent to the existing nonempty rule. It neither invents text, forces all optional multi-source quotes nor bypasses runtime validation. Existing empty-map rejection remains. The comparison harness version changes because generation behaviour may change. The failed report remains preserved, and new native checks use a separate source rather than pooling results.

An owned request can now remain pending without a brief when there are no read observations. A reproduced cancellation during its awaited request scan now produces a cancelled checkpoint and preserves the request. A post-request-commit interruption test reopens the store and retries without another request write. An unavailable paired-block test fails visibly, then succeeds after real reconnection rather than treating missing blocks as absent evidence.

The guided demo now frames startup JSON across chunks, fails promptly on early child exit and closes a child whose startup failed. Shutdown recognises signal termination, avoiding a late exit-listener hang. Progress shows peer startup, pairing, work, request persistence, offline contribution, replication/resumption and cleanup, with periodic waiting messages and a final visible brief. Structured smoke failures survive staged-source cleanup. Native reports include cleanup even after an assertion failure. Ordinary evaluation examples use unique output paths.

The existing suite already covers malformed and unknown tools, call/result protocol, repeated actions, repair/call exhaustion, cancellation stages, explicit context overflow, stale locally known evidence, committed-brief recovery, delayed/disconnected replication, duplicate notifications and repeated resumption. The final 177-test run includes these controlled checks and real separate-process replication. It is not 177 native model trials. Post-write interruption tests inject failure at the commit boundary; they are not arbitrary OS power-loss tests.

## Second consistency snapshot and answer-aware feedback

Source `0cfdea8` passed another fresh install, bundle, build, formatting, 178 tests and a two-call native smoke in 28370.44 ms. Its native default repeats completed as follows: 289397.61 ms with seven calls and one repair; 285490.67 ms with seven calls and one repair; 381208.89 ms with nine calls and two repairs. All completed both citations, offline contribution/resumption, restart deduplication and clean shutdown. These three results are separate from the first snapshot's three repeats.

Its Atlas variation passed initial work and reached real offline contribution, replication and resumption. It then failed in 333917.25 ms with eight calls and two repairs, repeating `REQUEST_REQUIRED` after the existing request had a linked answer. Cleanup passed. The model's intervening request reused the original request ID rather than creating a new gap. The rejected missing strings are not logged, so their semantic content is not established. All results and traces remain under `artifacts/reviewer-check-0cfdea8f-1793521712`; this verifier also correctly exited 1.

Source inspection and controlled reproduction found misleading feedback: when every existing request has a response, the generic error still tells the model to persist a request. New `ANSWERED_REQUEST` feedback distinguishes resolved items from a genuinely new gap. It directs the model to review/cite answers, remove only resolved missing items, retain interpretations in uncertainty, or request a new question without reusing an answered need ID. No acceptance check, permission or attempt budget changes. Controlled tests prove both correction to completion and preservation of a new unanswered gap. They use actual tool results and store state, not native model reasoning.

A second focused change makes the demo notice a new terminal pending resumption promptly, rather than waiting twelve minutes for completion when another human answer is needed. The initial pending checkpoint still waits for the first contribution, and successful completion still requires consumption of that contribution. A pure policy regression covers each terminal state. Nine focused information-need and demo checks passed before freezing the next source; native checks must be rerun on that new snapshot.

## Remaining submission limits

Native recovery for the paraphrase, no-relevant-optional and new late-record cases is unverified. The earlier long-record pass took about 11.9 minutes at source `2f23582`; this pass makes no long-record speed improvement or repeated long-record reliability claim. MiniLM and Laya retain their separately scoped probes and earlier evaluations; neither has a newly verified complete two-peer workflow here. All earlier failed reports remain retained.

Freshness applies to the latest locally available data. The implementation claims neither global freshness nor exactly-once distributed effects. Quotations establish what a source reports, not source truth or causal correctness. Context accounting remains an estimate. CPU load and native cancellation/cleanup can take time.

The personally written design section remains deferred and untouched. The repository remains private and owner-only, with no invitations, as requested. Reviewer access would need to be arranged by Suyash when he chooses to share it. See [the reviewer guide](REVIEWING.md) for reproducible commands and cancellation instructions.
