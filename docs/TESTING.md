# Verification record

Verification uses Ubuntu 24.04 WSL2 on CPU with project-local Linux Node 22.21.1. The canonical checkout is `C:\Users\m0rty\Desktop\Programming\Research\New folder\byteask\relay-agent`. Installation and native inference are sequential to avoid competing for the WSL memory allocation.

## Clean source and tests

```sh
bash scripts/clean-verify.sh
bash scripts/clean-verify.sh --live
bash scripts/clean-verify.sh --handoff
```

The default mode archives committed source into a fresh Linux temporary directory, runs `npm ci --maxsockets=2`, bundles QVAC workers, builds and runs all tests. The npm download cache may be used; `node_modules` is fresh. The `--live` mode then runs replay, both native selector arms, their comparison, the selected-model probe, cancellation and the demo sequentially. The `--handoff` mode runs the clean verification and the two-peer demo without repeating the matrix or probes. Reports are copied to `artifacts`; the demo peer stores remain under `.relay` for inspection.

At commit `fd54add9623da1fcd0b59f344a3ddf82ca6e63c0`, clean installation, bundling, compilation and **110/110 tests passed**, with zero npm audit findings. [clean-install.json](../artifacts/clean-install.json) records the source and scope. Tests cover schemas, permissions, tool protocol, quotation policy and whitespace, selector behavior, information needs, bounded recovery, cancellation, recorded-state regrading, restart handling and real separate-process replication. Controlled model tests establish harness behavior, not native model quality.

## Native handoff and probes

[The live demo](../artifacts/live-demo.json) passed at `fd54add9623da1fcd0b59f344a3ddf82ca6e63c0` in 343,463 ms. Peer A made a pending brief in four calls with one repair; B wrote linked evidence while A was offline; A reconnected and completed at seven cumulative calls and two repairs. The completed brief stores two exact source quotations under `quoted-observations-v1`, no missing items, the trusted uncertainty notice and an explicitly unverified model interpretation. A third A start checked deduplication. These are separate peer processes with independently owned trees, not replay or simulated replication. The result is one live demonstration, not a success-rate estimate.

The earlier v5 [quoted-policy output-limit failure](../artifacts/live-demo-quoted-output-limit-failed.json) remains recorded. The v6 agent repairs a length-limited no-action response with bounded format feedback; repeated identical failures stop, and tests cover preservation of committed requests. The selected 1.7B [tool-result probe](../artifacts/live-smoke-1.7b.json) passed exact format in two calls and 28.56 s. The [cancellation probe](../artifacts/live-cancellation-1.7b.json) observed native output before cancellation; cancel() returned in 32.77 ms and completion rejected as INFERENCE_CANCELLED. A probe pass is not a full handoff.

The successful handoff exercised both repairs live. The initial run corrected an attempted save before tracking the required question. The resumed run first exhausted its output limit without a call, then used the corrective feedback to read both sources and save. The [initial trace](../artifacts/traces/demo-initial.jsonl) and [resumed trace](../artifacts/traces/demo-resumed.jsonl) retain the model events, tool IDs and state transitions. The cancellation timing measures the cancel() call, not a separately timed final-settlement interval.

## Selector evaluation

The v5 native matrix at `872df5c` ran deployment, queue and missing-configuration cases twice each per selector. Deterministic and Laya each passed 6/6 automated checks; both reports were independently regraded from captured records without inference. Laya made six decisions without fallback or truncation. Every initial selection in both arms included the required source and five irrelevant records, so this suite shows no filtering benefit. The model, sampling settings, budgets and fixture identities match across arms; these results do not establish statistical significance, semantic truth, source truth, or general accuracy. See [EVALUATION.md](EVALUATION.md) and the retained [deterministic](../artifacts/live-deterministic.json), [Laya](../artifacts/live-laya.json) and [comparison](../artifacts/live-comparison.json) reports for measurements and scopes. The later v6 handoff and clean verification use a different source commit.

To regrade an existing version 2 report without native inference or store writes:

```sh
npm run regrade -- artifacts/live-deterministic.json
```

The regrader validates captured identities and linkage and reruns the current state checks; it cannot infer missing measurements or establish the truth of source text or model interpretations. Generated interpretations are labelled unverified.

The report's 25 ms RSS samples cover the parent Node process, not native workers or machine-wide peak model memory. WSL system-free memory is sampled before and after tasks and is not a measurement of all Windows memory. A retained native-worker sample is a single observation, not a peak or exclusive model attribution. Model loads are per task and OS/file caches are uncontrolled.

The private `da-goat37/prac-sdk` repository is owner-only; the user revoked all collaborator invitations. Do not invite anyone. The only deferred user-authored material is Suyash's personal design section, which he will supply later.
