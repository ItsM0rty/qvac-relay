# Verification record

## Reviewer pass, frozen new incidents

Final application source `cd4b146d29981574c70897e5ff479e1658f7ca3e` passed fresh Git archive installation, Linux QVAC bundling, build, formatting and **181/181 tests** in 29249.19 ms. The two-call live smoke passed in 29314.50 ms. Three native default handoffs completed in 257914.46, 258688.59 and 367406.64 ms with 6/1, 6/1 and 9/2 cumulative model calls/repairs. A separate Atlas variation completed in 260900.27 ms with 6/1. All four used fresh peer stores, the same source/configuration, actual replication, required citations, restart deduplication and clean exits. The verifier exited 0. Evidence is in `artifacts/reviewer-check-cd4b146d-1793524312`; every earlier attempt, failure and measurement scope is recorded in [REVIEW_RESULTS.md](REVIEW_RESULTS.md). Node, available npm downloads and model weights were reused; source and node_modules were fresh. This is not a fresh weight-download test or broad success-rate estimate.

Cases were committed at `3f05f44` before execution. `data/review-freeze-v1.json` records raw file hashes; do not edit those fixtures after seeing outcomes. Controlled reports at `ff8de7b` and `f08aecb` preserve the no-evidence failure and its safe pending outcome separately. Controlled runs use actual stores, tool results and protocol, but scripted model responses. Paraphrase initial lexical span coverage is zero; empty-query metadata navigation recovers it in the controlled sequence. This does not establish native semantic retrieval.

The fresh source setup at `66437b3` passed npm ci, bundle, build, formatting and 176 tests. The two-call native smoke passed with exact token reproduction in 33421.60 ms. The new Atlas two-peer incident passed in 244387.15 ms with six calls and one repair, required exact observations, offline contribution, restart resumption, deduplication and clean exits. Evidence is retained under `artifacts/reviewer-check-66437b3e-1793515021`. It uses fresh source and node_modules on Linux, existing Node 22.21.1, available npm cache and cached QVAC weights. It is not an uncached model download test. The later cancellation guard and reporting changes require current verification separately.

`npm run verify:review` retains a unique directory per committed source, including failed native reports. `RELAY_REVIEW_REPEAT=3 npm run verify:review` additionally runs three serial default handoffs from fresh stores and a separately labelled Atlas variation. The model and selector are pinned; `native-plan.json` fixes attempt counts before execution and `native-summary.json` records actual configurations, usage, repairs, calls, failures and cleanup. No automatic retries occur. New current results must be reported independently of `66437b3`.

Verification uses Ubuntu 24.04 WSL2 on CPU with project-local Linux Node 22.21.1. The canonical checkout is `C:\Users\m0rty\Desktop\Programming\Research\New folder\byteask\relay-agent`. Installation and native inference are sequential to avoid competing for the WSL memory allocation.

## Clean source and tests

Source `2f23582` passed **168/168 tests**, build and formatting. The suite took 170326.26 ms with verified existing dependencies and the unchanged lockfile. New tests validate the SDK-native source-keyed quote schema and a complete controlled loop that rejects omitted coverage before storing exact delivered quotes with current revisions. The passing output is local at `artifacts/local/source-quotes-all-tests.tap`. [The current manifest](../artifacts/passage-code-verification.json) records scope. The final native result is separate below.

Source `89f9f10` passed **164/164 tests**, build and formatting in 162227.13 ms. Scripted model fixtures assert that the offered native read schema has offset and no length field. The source/offset choice remains the model's; trusted code sizes the page. Explicit library lengths remain available for controlled paging checks. The output is local at `artifacts/local/trusted-page-all-tests.tap`, with scope in [the historical manifest](../artifacts/passage-code-verification-89f9f10.json). Its native run failed required coverage with 12 calls and 2 repairs; cleanup and resumption errors were null. The prior `ae3a53f` native attempt failed two exact-quote validations after a159-character late read, before a request or replication; the attempted quotes were not logged, so its precise mismatch is unknown.

Source `ae3a53f` passed **164/164 tests**, build and formatting. The suite took 164768.31 ms. It adds feedback projection/restoration and a complete controlled regression in which long-record resumed work receives real NO_PROGRESS feedback, then stores both exact quotations without rereading or overflowing. The trusted instructions are shorter while preserving source and permission rules. An expanded wording had failed the new input-budget regression; its compact successor initially failed the case-sensitive protocol fixture phrase. Restoring the phrase fixed that failure without changing tests. The passing output is local at `artifacts/local/final-context-all-tests.tap`. [The historical manifest](../artifacts/passage-code-verification-ae3a53f.json) records source and dependency scope.

Source `cf3b330` passed **160/160 tests**, build and formatting. The test duration was 152555.85 ms. New checks cover exact read-result projection, restoration after history pruning, JSON escaping in tool admission, protocol placeholders and configured mandatory-context overflow without a false brief. The default application context budget remains 7000. The complete output is local at `artifacts/local/fitted-context-all-tests.tap`, with scope in [the historical manifest](../artifacts/passage-code-verification-cf3b330.json). Existing verified dependencies were used. Its native run later failed after NO_PROGRESS feedback overflowed; the terminal cleanup and resumption status both reported no infrastructure error.

Source `538481a2f79cb1e716abc6d56c0547e6ee76fd32` passed **153/153 tests**, build and formatting. The test duration was 147544.46 ms. This adds protected read progress, exact quotations after history eviction, pressure-only rejected-draft repair and offset-aware checkpoint ordering after clock rollback. The final output is local at `artifacts/local/read-state-final-tests.tap`; [the historical verification manifest](../artifacts/passage-code-verification-538481a.json) records scope. Dependencies were already verified and unchanged, not freshly installed again.

The new live handoff was deliberately cancelled at the user's shutdown request before its first model reply. Its cancelled checkpoint and separate peer stores remain in `.relay/passage-read-state`. It does not establish current native completion and is excluded from quality results. Read STATE.md before resuming. The earlier `1a1e8c5` native run is retained as a failed handoff: replication and pending work succeeded, then repeated reads, incomplete coverage and overflow stopped resumption; cleanup also reported an unload failure.

The earlier passage implementation passed **147/147 tests**, build and formatting at source `1a1e8c5` with the existing verified dependencies. This suite includes long-tail passage discovery, actual tool-result recovery, protected required evidence, exact delivered-slice quotations, bounded search/read payloads, ranking-cache invalidation, selector cleanup and cancellation, restart/index reconstruction, history-group compaction, strict replay provenance, real replication and loopback HTTP deadlines. [The historical verification manifest](../artifacts/passage-code-verification-1a1e8c5.json) records its scope; the full output is local at `artifacts/local/control-final-tests.tap`. The earlier source `2aa0360` passed 143 tests before the four HTTP checks were added. This is a controlled harness suite, not native model quality.

Earlier in the same dependency change, fresh Linux `npm ci`, QVAC bundling, build and **129/129 tests** passed at `57fc4d6`, with zero reported audit findings. [The manifest](../artifacts/clean-install.json) names that source. A separate source recheck at `13eafee` passed 137 tests using dependencies hard-linked from that verified install; [its manifest](../artifacts/current-source-recheck.json) explicitly records reuse. Neither is a claim of a second fresh installation of the final source.

```sh
bash scripts/clean-verify.sh
bash scripts/clean-verify.sh --live
bash scripts/clean-verify.sh --handoff
```

The default mode archives committed source into a fresh Linux temporary directory, runs `npm ci --maxsockets=2`, bundles QVAC workers, builds and runs all tests. The npm download cache may be used; `node_modules` is fresh. The `--live` mode then runs replay, both native selector arms, their comparison, the selected-model probe, cancellation and the demo sequentially. The `--handoff` mode runs the clean verification and the two-peer demo without repeating the matrix or probes. Reports are copied to `artifacts`; the demo peer stores remain under `.relay` for inspection.

At commit `fd54add9623da1fcd0b59f344a3ddf82ca6e63c0`, clean installation, bundling, compilation and **110/110 tests passed**, with zero npm audit findings. [The historical manifest](../artifacts/clean-install-fd54add.json) records the source and scope. Tests cover schemas, permissions, tool protocol, quotation policy and whitespace, selector behavior, information needs, bounded recovery, cancellation, recorded-state regrading, restart handling and real separate-process replication. Controlled model tests establish harness behavior, not native model quality.

## Native handoff and probes

The [current long-record handoff](../artifacts/passage-demo-2f23582.json) passed at source `2f23582` with QVAC0.22.0 Qwen3 1.7B Q4 CPU and deterministic selection in 711784.74 ms, about11.9minutes. A saved pending work after six calls and one repair. B wrote evidence into B's own persistent tree while A was offline. A restarted, replicated and resumed once, completing at eleven cumulative calls and two repairs. Both late facts were quoted with current revisions, no missing items and the root-cause uncertainty notice. Cleanup and resumption errors were null. Another restart deduplicated work, and both peers exited cleanly. These were real separate processes and stores, without filesystem substitution.

[Initial](../artifacts/traces/passage-2f23582-initial.jsonl), [resumed](../artifacts/traces/passage-2f23582-resumed.jsonl) and [resumption](../artifacts/traces/passage-2f23582-resumption.jsonl) traces record the decisions. Initial repair tracked a required question before acceptance. Resumed repair corrected a missing-information proposal after the answer was available. [SDK totals](../artifacts/passage-demo-2f23582-metrics.json) were 20167 prompt tokens,703 output tokens,164767.40 ms loading and 481751.31 ms generation. Prompt counts include repeated context; file caches were uncontrolled. Elapsed time uses a monotonic clock. This is one development demonstration, not a reliability, accuracy or semantic-truth estimate, and not a current complete MiniLM/Laya handoff pass.

Reproduce after README setup with `RELAY_SELECTOR=deterministic RELAY_DEMO_LONG=1 npm run demo` in WSL, using fresh stores and one active generator. Earlier failed reports remain retained. The later pass does not turn the exposed held-out matrix into successes.

[The live demo](../artifacts/live-demo.json) passed at `fd54add9623da1fcd0b59f344a3ddf82ca6e63c0` in 343,463 ms. Peer A made a pending brief in four calls with one repair; B wrote linked evidence while A was offline; A reconnected and completed at seven cumulative calls and two repairs. The completed brief stores two exact source quotations under `quoted-observations-v1`, no missing items, the trusted uncertainty notice and an explicitly unverified model interpretation. A third A start checked deduplication. These are separate peer processes with independently owned trees, not replay or simulated replication. The result is one live demonstration, not a success-rate estimate.

The earlier v5 [quoted-policy output-limit failure](../artifacts/live-demo-quoted-output-limit-failed.json) remains recorded. The v6 agent repairs a length-limited no-action response with bounded format feedback; repeated identical failures stop, and tests cover preservation of committed requests. The selected 1.7B [tool-result probe](../artifacts/live-smoke-1.7b.json) passed exact format in two calls and 28.56 s. The [cancellation probe](../artifacts/live-cancellation-1.7b.json) observed native output before cancellation; cancel() returned in 32.77 ms and completion rejected as INFERENCE_CANCELLED. A probe pass is not a full handoff.

The successful handoff exercised both repairs live. The initial run corrected an attempted save before tracking the required question. The resumed run first exhausted its output limit without a call, then used the corrective feedback to read both sources and save. The [initial trace](../artifacts/traces/demo-initial.jsonl) and [resumed trace](../artifacts/traces/demo-resumed.jsonl) retain the model events, tool IDs and state transitions. The cancellation timing measures the cancel() call, not a separately timed final-settlement interval.

## Selector evaluation

The passage ranking experiment and failure evidence are in [RETRIEVAL_EVALUATION.md](RETRIEVAL_EVALUATION.md). The native MiniLM probe, improved Laya order/fact probe, 54-row selection matrix and six failed full-agent runs are distinct measurements. A failed full-agent run does not erase initial selection coverage, and good selection coverage does not establish a completed investigation. Two failed long-record demonstrations are retained at [57fc4d6](../artifacts/passage-demo-minilm-57fc4d6-failed.json) and [13eafee](../artifacts/passage-demo-lexical-13eafee-failed.json), with matching trace files under `artifacts/traces/passage-*`.

The later [b735b53 development run](../artifacts/passage-demo-control-timeout-b735b53-failed.json) stopped because its control request failed after roughly 300 seconds while the generator was still working. Peer shutdown then cancelled decode. The retained trace records the late-page read and committed question, not a completed handoff. Source `1a1e8c5` replaces the affected fetch path with a bounded HTTP client; tests check delayed headers, full-body deadlines, cancellation and invalid responses.

To rerun native passage measurements, first prepare the default MiniLM cache:

```sh
npm run ranker:prepare
npm run ranker:probe
npm run evaluate:retrieval -- --mode retrieval --trials 2 --output artifacts/new-passage-retrieval.json
npm run evaluate:retrieval -- --mode agent --split development --trials 1 --output artifacts/new-development-agent.json
RELAY_DEMO_LONG=1 RELAY_SELECTOR=deterministic npm run demo
```

The development command is a new stochastic execution, not a fresh held-out estimate. `bash scripts/clean-verify.sh --retrieval` uses the default `.relay/reranker-cache` rather than a custom ranker path; prepare that cache first. It runs expensive operations sequentially. Existing historical artifacts may be updated by this convenience script, so archive them first when retaining multiple source snapshots.

The v5 native matrix at `872df5c` ran deployment, queue and missing-configuration cases twice each per selector. Deterministic and Laya each passed 6/6 automated checks; both reports were independently regraded from captured records without inference. Laya made six decisions without fallback or truncation. Every initial selection in both arms included the required source and five irrelevant records, so this suite shows no filtering benefit. The model, sampling settings, budgets and fixture identities match across arms; these results do not establish statistical significance, semantic truth, source truth, or general accuracy. See [EVALUATION.md](EVALUATION.md) and the retained [deterministic](../artifacts/live-deterministic.json), [Laya](../artifacts/live-laya.json) and [comparison](../artifacts/live-comparison.json) reports for measurements and scopes. The later v6 handoff and clean verification use a different source commit.

To regrade an existing version 2 report without native inference or store writes:

```sh
npm run regrade -- artifacts/live-deterministic.json
```

The regrader validates captured identities and linkage and reruns the current state checks; it cannot infer missing measurements or establish the truth of source text or model interpretations. Generated interpretations are labelled unverified.

The report's 25 ms RSS samples cover the parent Node process, not native workers or machine-wide peak model memory. WSL system-free memory is sampled before and after tasks and is not a measurement of all Windows memory. A retained native-worker sample is a single observation, not a peak or exclusive model attribution. Model loads are per task and OS/file caches are uncontrolled.

The private `da-goat37/prac-sdk` repository is owner-only; the user revoked all collaborator invitations. Do not invite anyone. The only deferred user-authored material is Suyash's personal design section, which he will supply later.
