# Current state

The reviewer reliability pass is on `code-fix/reviewer-reliability`. Source `66437b3` passed a fresh Linux git-archive install, bundle, build, formatting and 176 tests. The new frozen Atlas native handoff passed in 244387.15 ms with six calls and one repair. Reports, traces and setup scope are retained in `artifacts/reviewer-check-66437b3e-1793515021`. Existing supported Node, npm cache and model weights were reused; source and node_modules were fresh. This does not verify an uncached model download.

The three controlled new cases passed their scoped checks: paraphrase recovery through empty-query navigation, late exact source detail, and an unanswered request remaining pending without an invented brief. The baseline no-evidence case failed after committing the request; `f08aecb` added safe request-only pending work. A later cancellation race found in this guard is fixed with checks after its awaited read and before checkpointing. New focused tests also cover post-request-commit interruption and unavailable remote blocks. Demo readiness, child shutdown and concise progress are improved.

Next: freeze the cancellation and reporting changes, then run the full current checks and three serial native default handoffs in fresh stores on that one source. Run the Atlas variation separately. Keep every result, including failures, and never pool snapshots. The verifier supports `RELAY_REVIEW_REPEAT=3 npm run verify:review`. Final evidence and publication will follow those results. Personal design prose remains deferred and untouched; repository access remains owner-only.

## Prior passage milestone

Updated 2026-11-01. The passage retrieval implementation passed its real long-record handoff at functional source `2f23582bc24fc344e53e752f5077d9f05a477140`. The current build, formatting and all 168 controlled tests passed at that source. No peer, demo or model process should be left running after the final cleanup check. The canonical checkout is `C:\Users\m0rty\Desktop\Programming\Research\New folder\byteask\relay-agent`, on `code-fix/passage-retrieval`.

## Verified outcome

The [native report](../artifacts/passage-demo-2f23582.json) took 711784.74 ms, about 11.9 minutes. A saved a pending brief after six calls and one repair. B contributed from its own persisted tree while A was offline. A restarted with the same identity, replicated the contribution and resumed once. The completed checkpoint has eleven cumulative calls and two repairs, both exact late-source observations, no missing items and the trusted root-cause uncertainty notice. Model cleanup and resumption errors were null. A further restart deduplicated the completed work, and both peers exited cleanly. The coordinator never reads peer core data. This is one development demonstration, not a reliability or semantic accuracy estimate.

The generator used QVAC0.22.0 Qwen3 1.7B Q4 on Ubuntu24.04 WSL2 CPU with local Node22.21.1. Final run traces are `artifacts/traces/passage-2f23582-{initial,resumed,resumption}.jsonl`. The run exposed 20167 prompt tokens, 703 generated tokens and 164767.40 ms loading across calls; these SDK counters are not a memory peak or unique-token count. Accepted facts are exact delivered quotations, not generated causal conclusions.

## Implemented path

Accepted original records produce exact UTF-16 passages with stable locations and full revisions. A rebuildable local lexical index supplies optional candidates. Native search returns navigation metadata; read tools retain original data and page it through trusted sizing. Required context, partial read progress, tool/result relationships, coverage, permissions and local freshness are protected. Required text and corrective feedback are represented once when their exact copies remain in protocol, and restored if those groups leave. Rejected drafts may leave under pressure without undoing effects. Native save input is a source-keyed quote map with required source fields; independent runtime checks still reject missing, unread, nonexact or outdated quotes. One contiguous quote per source is the native input limit.

MiniLM uses Transformers.js4.3.2, pinned Xenova revision `a09144355adeed5f58c8ed011d209bf8ee5a1fec`, INT8 ONNX and verified hashes. `ranker:prepare` explicitly downloads; inference loads only local files. Its real CPU probe passed paired tokenization, nonconstant raw logits, ordering, input-limit refusal and disposal. Laya's improved bounded three-class probe also ran. Neither authorizes actions from confidence. Selector errors fall back visibly only after safe cleanup.

## Measured recommendation and limits

Keep deterministic lexical selection as default. The frozen `retrieval-cases-v2` hash is `306b32f7ae3f22823f76e34d03cb07858ce1befd2e709949ade16784a56d2bf4`. Its nine cases have disjoint development and held-out families. The native 54-row selection matrix at `57fc4d6` gave all three selectors 7/9 held-out spans and seven distractor passages per trial. No ranker gain was established. The current inference-free budget replay reuses those predictions and retains 7/9 spans with six distractors. It is not fresh inference. Preserve query-provenance and cache caveats in [RETRIEVAL_EVALUATION](RETRIEVAL_EVALUATION.md).

All six earlier held-out full-agent runs failed at `57fc4d6`. They remain evidence for that snapshot, not corrected passes. Later failed development reports at `13eafee`, `b735b53`, `1a1e8c5`, `cc543bd`, `cf3b330`, `ae3a53f` and `89f9f10` remain in artifacts and decisions. Some involved overflow, repeated reads, invalid quotations or missing coverage; earlier unload errors had unproven causes. The final successful default workflow does not establish current full MiniLM or Laya P2P success. Exposed held-out cases must not be rerun as an independent holdout claim.

The default 7000 budget is a conservative byte-based estimate, not an exact generator tokenizer. Future peer changes and large mandatory state or errors can still cause explicit overflow. Exact quotes do not prove source truth. Freshness is local to received data, not global consensus or exactly-once effects. Native latency is substantial on this laptop; keep heavy operations serial. MiniLM cancellation waits for an active ONNX batch. Older cold/warm reports distinguish cache reuse from native scoring.

## Reproduction and next work

Use README setup and `scripts/linux.sh` from PowerShell. Dependencies and model caches persist; do not reinstall or repeat research without a new reason. A fresh Linux install at `57fc4d6` passed npm ci, bundle, build and 129 tests with the same lock. Final168 tests used verified existing dependencies. Manifests distinguish those scopes.

For a new live demonstration in a WSL terminal:

```sh
RELAY_SELECTOR=deterministic RELAY_DEMO_LONG=1 npm run demo
```

Use a fresh demo directory. Cancelled `.relay/passage-read-state` belongs to the user's shutdown pause and is excluded from quality results. The final successful persistent stores are `.relay/passage-source-quotes-20261101-103533`.

Implementation, evaluation artifacts and ordinary instructions are ready. Suyash's personally written design section remains deferred; do not write it or ask again until he is ready. The repository is private `da-goat37/prac-sdk`, owner-only, with no invitations. Do not add reviewers or send messages. Use checked fast-forward publication to `code-fix/relay-handoff`; never force-push or create a public PR. Broader evaluation needs new unseen incident families rather than recycling the exposed holdout.
