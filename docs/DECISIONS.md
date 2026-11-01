# Decisions

## User-confirmed requirements

Relay is a local engineering handoff agent. Each peer owns its writable tree. Contributions live in their author's tree and reference requests. The generator uses @qvac/sdk with native tools. Laya is optional. Keep the repository private as da-goat37/prac-sdk. Source reference projects remain unchanged. Suyash writes the personal design section without assistance.

## Runtime probe

Use the existing Ubuntu 24.04 WSL installation as the first candidate for CPU inference. The Windows Vulkan runtime does not meet the SDK's documented 1.4 requirement. Node 22.21.1 is project-local because current bundling does not support the installed Windows Node 22.20.0. WSL execution must be proven by native inference before treating this as a supported application path.

The native tool-result probe and targeted decode cancellation have now passed on WSL. A 120 second RPC startup allowance addresses measured filesystem import latency. The model cache must be an absolute path. No driver, global Node or shared inference service was added.

## Native tool policy

The first full Qwen3 0.6B application run in automatic-tool mode answered in prose and then repeated searches until its 180 second deadline. The failure is retained in artifacts. Relay's application contract requires a saved tool result, so subsequent application runs use QVAC's supported tool_choice required. The model still chooses among all four tools and supplies their arguments. The probe uses automatic mode so its second turn can answer in prose. Required mode does not establish correct evidence use; deterministic checks still reject invalid effects. Repeated identical actions against unchanged data now receive bounded no-progress feedback.

The CLI's five minute run deadline allows measured cold startup and several model turns. Calls and repairs remain bounded and cumulative through automatic resumption. Trying Qwen3 1.7B is based on observed task failure by the smaller candidate, not parameter-count promises. Model selection remains provisional until the handoff and evaluations run.

## Reference patterns

Entode owns the acceptance contract and separates repairable draft failures from infrastructure problems. Relay will retain committed effects and valid tool protocol while refreshing rejected drafts. OpenSwitch contributes pure policies, explicit budgets and structured decisions. Its existing routing does not establish quality-aware local routing. EvalGate contributes replay, repeated trials and explicit checks. Relay must additionally check persisted agent state and reject duplicate or missing evaluation identities before comparison. No Rust dependency is justified.
