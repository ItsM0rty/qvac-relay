# Live evaluation: deterministic selection and Laya

The recorded native matrix used source commit `872df5c`, QVAC 0.22.0, and Qwen3 1.7B Q4 on CPU. It contains three synthetic cases (deployment, queue, and missing configuration), each run twice with each selector. Both reports use the same dataset and harness hashes, case IDs, sampling settings and budgets; selector is the intended difference. The generator was unloaded between tasks; operating-system and file caches were uncontrolled. Later changes cover quotation whitespace, read-only regrading and an oldest-known-ID refresh; they are outside the measured source snapshot. The final non-live clean verification is separate.

Both [deterministic](../artifacts/live-deterministic.json) and [Laya](../artifacts/live-laya.json) reports independently regraded **6/6 recorded states** with `scripts/regrade.ts`, without model inference. The [comparison](../artifacts/live-comparison.json) reports no automated state-check regression. These checks cover protocol state, valid exact quotations and revisions, required-source coverage, the quotation policy and uncertainty notice, and pending/completed status. They do not establish semantic truth or the entailment of interpretations. Three synthetic cases and two trials per case cannot establish statistical significance or general accuracy.

| Measure                                 |          Deterministic |                    Laya |
| --------------------------------------- | ---------------------: | ----------------------: |
| Automated state-check passes            |                    6/6 |                     6/6 |
| Generator calls / repairs, total        |                 16 / 2 |                  15 / 1 |
| Generator input / output tokens, total  |           27,244 / 807 |            25,386 / 781 |
| Task latency, mean (range)              | 115.4 s (87.3–170.3 s) | 129.6 s (105.5–190.4 s) |
| Generator load, per task range          |            19.1–22.1 s |             17.9–18.9 s |
| Selector decisions / fallbacks          |                  0 / 0 |                   6 / 0 |
| Parent RSS sampled peak, per task range |         85.7–171.5 MiB |         128.6–174.9 MiB |

Latency includes fixture-store setup and agent execution, including end-of-run model release; it excludes subsequent temporary-store removal and final SDK shutdown. The token totals above are generator usage, not selector usage. In these runs Laya reported one decision per task, 1,674–1,698 input tokens and zero output tokens per decision, with separately reported load of 8.3–9.8 s and decision time of 14.0–15.0 s. These numbers are descriptive: call counts and generated outputs varied, so neither the observed token nor latency difference isolates a selector effect. The 25 ms RSS samples cover the parent Node process only; native child-worker memory is not attributed, and these values are not machine-wide or model peak memory. System free memory was measured only before and after each task.

Each initial selection included the required source and all five unrelated records, for both selectors and all trials. No relevant source was omitted, no selector fallback occurred, and Laya reported no input truncation, dropped state tokens, truncated questions, or task projection. There is no observed filtering benefit on this suite; deterministic selection remains the default. This does not rule out a benefit on other workloads.

Every stored brief contains the quoted-observation policy and a single fact equal to its sole source quotation. Both missing-configuration trials in each arm have the canonical question recorded, linked to a pending checkpoint and brief. The only stored uncertainty in these twelve briefs is the trusted notice that source quotations alone do not establish root cause. Model-generated interpretations, if present in other runs, are labelled unverified and should not be treated as established facts; raw model generations are not reconstructed by this recorded-state audit.
