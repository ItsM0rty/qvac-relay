# Passage retrieval evaluation

The recommended default is deterministic lexical retrieval. In this small frozen synthetic set, MiniLM and Laya changed some ordering and selected passages, but neither improved held-out span recall or the total number of distractors over lexical retrieval. MiniLM remains an optional real local reranker; this experiment did not establish a quality gain from using it. The six captured native agent runs are reported separately below. The later default-selector long-record handoff passed at2f23582. It is a development integration result, not a new held-out quality estimate.

## Scope and provenance

The measured source was commit `57fc4d68cdc53dba9bd9c7eec83c0b983c9fe4f4`, run from the clean source archive used in the 129-test clean verification. That archive omitted `.git`, so the original report could not read a commit ID directly. The source commit in the corrected report is restored from the clean-install manifest, not obtained from Git inside the archive.

The fixture is `retrieval-cases-v2`, frozen before model evaluation with SHA-256 `306b32f7ae3f22823f76e34d03cb07858ce1befd2e709949ade16784a56d2bf4`. Development and held-out incident families are disjoint; there was no tuning on held-out results. The [original captured report](../artifacts/passage-retrieval-raw-57fc4d6.json) is retained. The [corrected report](../artifacts/passage-retrieval.json) was regraded offline from its recorded passage IDs against that frozen fixture using [retrieval-regrade.ts](../src/retrieval-regrade.ts); the regrade made no new native inference calls. The reporting fix did not change the evaluated rankers.

All three arms begin with lexical passage retrieval; the optional rankers order that candidate set, and required source context is handled separately. Consequently, a reranker cannot recover a passage excluded by lexical retrieval. These checks measure exact annotated quotations present in selected passages, not semantic truth or the quality of a generated answer. A later `find_evidence` and `read_record` call can recover an omitted passage, but recovery is not guaranteed and does not mean it was present in the initial context.

## Recorded selection results

The report contains 54 rows across nine cases, three selectors and two trials. The following figures count each frozen case once; the two trials produced the same coverage and distractor counts. They are not independent new fixtures.

| Split | Deterministic | MiniLM | Laya |
| --- | --- | --- | --- |
| Held-out answerable cases, micro span recall | 7/9 (77.8%) | 7/9 (77.8%) | 7/9 (77.8%) |
| Held-out answerable cases, macro span recall | 80% | 80% | 80% |
| Held-out distractor passages, including the no-answer case | 7 | 7 | 7 |
| Development micro span recall | 1/5 (20%) | 1/5 (20%) | 1/5 (20%) |

Macro recall averages the five answerable held-out cases and excludes the no-answer case. The no-answer case has no expected span, so its recall is undefined (`null`), rather than 100%. Each arm admitted one unrelated passage in that case on each trial; under the report's no-answer selection criterion that is a failure to abstain from optional noise, not a measured answer.

The equal counts do not mean the selected passages were identical. For example, in `held-cold-2` the three arms admitted different distractor passages, and ordering varied in other cases. The held-out refrigerated-shipping observation and satellite-uplink fix were absent from the lexical candidates, limiting all three arms to half of the annotated spans in those cases. Development results show a separate lexical ceiling: the first checkout case and the database-timeout case each had zero of their two expected spans in the lexical candidates. An optional reranker cannot recover any of those four omitted development spans.

## Captured native agent results

The separate [agent report](../artifacts/passage-agent.json) recorded zero successful runs across two held-out cases, three selectors and one trial per case and selector. Four runs stopped on context overflow: deterministic on `held-charge-1`, MiniLM on `held-cold-1`, and Laya on both cases. The deterministic `held-cold-1` run failed validation of an undeclared `needId`; the MiniLM `held-charge-1` run failed repeated-action validation. No run produced a successful saved outcome. Empty outcome coverage is not a measurement of zero initial passage coverage. One stochastic trial per case and selector cannot establish a general failure rate or semantic correctness.

The agent report itself records `sourceCommit` as `unavailable`; its source snapshot `57fc4d68cdc53dba9bd9c7eec83c0b983c9fe4f4` is identified through the clean-install manifest, rather than read from Git inside the archive. These results remain evidence for that snapshot and are not replaced by later verification.

## Native execution and timing

Across 18 MiniLM rows, eight performed native rankings, eight repeat-trial rows reused cached rankings, and two had no candidates. Of the warm builds, 16 were cache hits and two had no candidates. These are not 16 independent warm native scoring measurements. Across the held-out native first builds, median MiniLM time was about 381 ms including model loading; the median recorded native batch was about 31 ms across the full report. Held-out Laya first builds had a median of about 12.44 seconds, including loading. These are observed, process-scoped measurements for this run, with uncontrolled system and OS caches, not general latency guarantees or causal speed estimates.

Laya had 16 native-ranking rows and two empty-candidate rows; its recorded cold and warm selections involved 18 decision batches each. No truncation was reported in those selections. Runtime and RSS scope are described in the report; no external process memory or global peak is implied.

## Recorded prediction replay after harness corrections

[The budget replay](../artifacts/passage-ranking-budget-replay.json) reapplies the captured MiniLM logits and Laya classes to the context builder at `2f23582`. No model ran and no peer store was written. Under the current tool metadata, protected availability summary and initial empty read progress, each arm retained 7/9 held-out spans and admitted six distractor passages per trial. This is a budget regression check over old predictions, not a fresh native quality comparison. Original native timing is not reused as new latency. The [earlier replay at b735b53](../artifacts/passage-ranking-budget-replay-b735b53.json) remains separate.

The raw report lacks both a source commit and captured query text. The replay requires the known historical configuration hash and the caller's explicit clean-manifest attribution to `57fc4d6`. Query identity is inferred from the frozen task fixture and historical harness. The hash checks configuration compatibility; it does not authenticate the supplied scores.

```sh
node --import tsx scripts/replay-ranking.ts artifacts/passage-retrieval-raw-57fc4d6.json artifacts/new-ranking-budget-replay.json --source-commit 57fc4d68cdc53dba9bd9c7eec83c0b983c9fe4f4
```

## Laya sensitivity probe

The separate [Laya passage probe](../artifacts/laya-passage-probe.json) tested one cargo-temperature question. With the original answer passage, the base, reversed candidate order, reversed option order, and contrast-example settings each classified the answer as `directly_relevant` and the routing passage as `background`. Changing the crucial tail classified both as `background`. No probe input reported truncation. The unrelated modem passage did not pass lexical preselection and was never classified by Laya in this probe.

These observations concern the tested lexical subset and the model's recorded classes and order. They do not establish that a classification is correct, calibrated, or a basis for an autonomous action.

The frozen `held-charge-1` question asks what voltage is allowed while the connector is wet, but its annotations also require the separate 48 V DC rule after the connector is dry. Full annotated-span coverage is therefore a strict mechanical benchmark; omitting the dry-condition rule alone does not prove that an answer to the narrower wet-condition question is incorrect. Report agent completion, quoted-span coverage, and this possible annotation overspecification separately. The deterministic and Laya charging runs overflowed without a successful outcome, while the MiniLM charging run failed repeated-action validation. None supplies evidence of a completed answer omitting the dry-condition rule.
