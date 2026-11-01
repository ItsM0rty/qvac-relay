# Decisions

## User-confirmed requirements

Relay is a local engineering handoff agent. Each peer owns its writable tree. Contributions live in their author's tree and reference requests. The generator uses @qvac/sdk with native tools. Laya is optional. Keep the repository private as da-goat37/prac-sdk. Source reference projects remain unchanged. Suyash writes the personal design section without assistance.

The user later revoked the request to invite reviewers. The repository must remain owner-only unless he explicitly asks to add someone. After the interrupted invitation attempt, GitHub reported no pending invitations and only da-goat37 as a collaborator. Privacy remains verified as PRIVATE.

## Structured information needs

Cases can declare up to eight required information needs as stable IDs paired with canonical questions. The CLI accepts these at creation through `--needs '<JSON array>'`. This gives the trusted harness a deterministic semantic checklist for information that must be requested and received. A request uses `needId`; runtime attaches the declared question and stable ID, and rejects undeclared needs. The save path rejects an unanswered declared need even if the model reports no missing items. Requests remain pending until the linked response has been read and cited. Free-text task wording remains useful guidance, but cannot reliably encode a structured, deterministically checked requirement for a missing answer.

The retained live deterministic baseline `artifacts/live-deterministic-before-information-needs.json` ran two trials for each of three cases. Both `missing-config` trials saved a brief but failed the expected missing-information check; their `missingInformation` result was false. The existing free-text instructions did not provide deterministic semantic requirement coverage. Structured needs address that gap. This baseline is historical evidence for the defect, not evidence of a post-change live pass.

## Runtime probe

Use the existing Ubuntu 24.04 WSL installation as the first candidate for CPU inference. The Windows Vulkan runtime does not meet the SDK's documented 1.4 requirement. Node 22.21.1 is project-local because current bundling does not support the installed Windows Node 22.20.0. Native CPU inference, tool-result consumption, cancellation and the complete handoff have now been verified on this path.

The native tool-result probe and targeted decode cancellation have now passed on WSL. A 120 second RPC startup allowance addresses measured filesystem import latency. The model cache must be an absolute path. No driver, global Node or shared inference service was added.

## Native tool policy

The first full Qwen3 0.6B application run in automatic-tool mode answered in prose and then repeated searches until its 180 second deadline. The failure is retained in artifacts. Relay's application contract requires a saved tool result, so subsequent application runs use QVAC's supported tool_choice required. The model still chooses among all four tools and supplies their arguments. The probe uses automatic mode so its second turn can answer in prose. Required mode does not establish correct evidence use; deterministic checks still reject invalid effects. Repeated identical actions against unchanged data now receive bounded no-progress feedback.

The CLI's bounded run deadline includes measured cold startup and several model turns. Calls and repairs remain bounded and cumulative through automatic resumption. Trying Qwen3 1.7B is based on observed task failure by the smaller candidate, not parameter-count promises. Qwen3 1.7B Q4 is now the default after a complete native two-peer handoff passed in 358177 ms with five cumulative calls and zero repairs. The smaller model remains available, with its failed full-task reports retained. This choice is supported by one successful application demonstration; repeated evaluations are still being verified.

## Compact model draft contract

The solo 1.7B run read actual evidence, then produced repeated duplicate facts and stopped on equivalent validation feedback. The model-facing brief is now bounded to three short facts, each with up to three references. A proposed reference needs an evidence ID and exact quotation. Revision can be omitted; trusted code attaches the revision captured by read_record and verifies it still matches current local data. A supplied wrong revision remains an error. The stored record always includes complete revisions. This removes unnecessary hash transcription from a small model without relaxing source freshness.

Generation now uses temperature 0.7, top_p 0.8 and top_k 20. The installed SDK also supports reasoning_budget 0, which disables the reasoning channel explicitly. The /no_think instruction remains in the prompt. Qwen's official 1.7B model card recommends non-greedy non-thinking sampling and warns about greedy repetition. Its min_p recommendation is not exposed by this SDK's strict generation schema, so Relay leaves it unset and reports null. An attempted min_p request was rejected before inference and retained as integration evidence. The sampler now satisfies the installed completion function's parameter type directly.

The earlier temperature 0 runs remain retained as failed evidence. Context filtering, validation and acceptance remain deterministic. Live generation is stochastic; evaluations therefore repeat trials and record all exposed sampler settings.

## Native permissions and independent reads

Observed small-model runs confused internal request hashes with evidence IDs. Generator context now projects questions and linked response IDs without exposing unnecessary internal request hashes. The native read schema offers a bounded set of known evidence IDs. Searches can discover more IDs. The save schema offers only evidence already read, and saving is unavailable until required evidence has been read. Runtime checks still enforce case ownership, source existence, exact quotes and current revisions. These constraints restrict invalid proposals without prescribing which search, read or question the model chooses.

The SDK returned two independent reads in one response despite the single-call preference. Rejecting that response was an unnecessary harness constraint. Independent reads now execute sequentially and keep every call/result pair. Batches containing writes remain denied so dependent effects require a subsequent model turn.

Exact duplicate fact objects normalize deterministically before acceptance, with a trace event. Different valid excerpts can support the same observation, so prose uniqueness alone is not a rejection rule. Stored exact duplicates and duplicate references within a fact remain invalid. Normalization never repairs a wrong source ID, quotation or revision.

Required evidence IDs persist in checkpoints. Resumption protects both the prior brief's sources and the new contribution. Linked evidence arriving during an active run also becomes required; a fresh brief records its consumption only after validation and commit. Freshness remains local to the latest blocks available at validation.

## Dependency patch

The SDK pins Zod 4.6.5, which npm audit flagged for constrained-collection memory exhaustion. Relay uses a package override to the already installed direct version 4.6.7. The updated dependency graph reported zero known audit findings. Routine tests and native verification are rerun against it. This is an application patch override, not a claim of upstream certification.

## Reference patterns

Entode owns the acceptance contract and separates repairable draft failures from infrastructure problems. Relay retains committed effects and valid tool protocol while refreshing rejected drafts. OpenSwitch contributes pure policies, explicit budgets and structured decisions. Its existing routing does not establish quality-aware local routing. EvalGate contributes replay, repeated trials and explicit checks. Relay additionally checks persisted agent state and rejects duplicate or missing evaluation identities before comparison. No Rust dependency is justified.

## Evaluation scope

A later native handoff emitted 3009 characters of prose and exhausted 768 output tokens without returning an action, despite required-tool mode. This is retained in artifacts/live-demo-quoted-output-limit-failed.json and its trace. A response-length failure without a complete action now receives bounded format feedback, using the same repair budget and repeated-failure rule as other malformed proposals. Its partial prose is discarded while valid tool history and committed requests remain. Input-context overflow and infrastructure failures still stop. The harness version changed to v6 so future reports cannot silently compare this repair policy with v5. The completed v5 selector comparison remains evidence for its explicitly named snapshot.

Review of an earlier six-of-six state-check report found unsupported causal claims in generated fact prose. Queue-depth observations at 10:20 were presented as causing connection failures at 10:19. State checks alone had missed this. Relay now stores validated quotations as observations and labels generated explanations as unverified uncertainty. Code supplies a root-cause uncertainty notice even when the model omits one. The native save schema asks for quotes and references rather than fact prose. Compatible legacy draft prose is never promoted to an observation. The record schema checks policy-labelled observation consistency. This does not solve semantic interpretation or source truth; it makes their limits visible.

Evaluation report version 2 adds quoted-observation and uncertainty checks. Version 1 reports remain historical evidence and are rejected by the current comparison command. The pre-change report is retained as artifacts/live-deterministic-before-quoted-observations.json. Its six automated passes must not be described as six semantically correct answers. Both final selector arms must be rerun under the new contract before comparison.

Native imports on the Windows mount contributed about 70 seconds to observed task loads. Final clean verification stages committed source and freshly installed dependencies on the Linux filesystem. Both final selector arms use that same staged environment. Only downloaded model files may be reused through a cache link. The source remains in the canonical checkout. This also checks the README recommendation to use a Linux checkout. Earlier runs on the Windows mount remain separate evidence and are not used as a latency baseline for the staged comparison.

The same three synthetic engineering tasks and five distracting records per task are used for each selector. Expected evidence IDs are checked by the grader rather than forced into initial context. Only application-required resumed contributions and prior brief sources receive omission protection. Reports compare exact case and trial identities and compatible generator settings; selector policy is the intended ablation difference. Replay consumes actual tool results and writes only isolated temporary stores. Native tokens, selector use and loading are reported only when available. Parent-process RSS is not native worker memory. Live Laya, repeated evaluations and final clean-install verification remain in progress.
