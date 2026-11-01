# Current implementation state

Updated 2026-10-31. Canonical source is the isolated relay-agent checkout on code-fix/relay-handoff. The repository-local author and committer are Suyash Bhattarai. The source reference projects remain unchanged.

## Implemented and exercised

Relay has strict record schemas, independently owned Hyperbee2 trees, real Corestore replication over loopback TCP, a native QVAC adapter, bounded tool execution, deterministic context selection, an optional Laya selector, a CLI, immutable checkpoints, crash recovery, contribution-triggered resumption and evaluation tooling.

The complete native handoff passed with Qwen3 1.7B Q4. Peer A wrote a request and pending brief, stopped, and later received evidence written by B into B's own tree. A restarted, reconnected and completed a new brief citing the original health log and B's configuration evidence. A second restart did not duplicate completed work. The retained report is artifacts/live-demo.json. It records 358177 ms end to end, five cumulative model calls and zero repairs. This is one successful demonstration, not a success-rate estimate.

Qwen3 1.7B Q4 is now the default because it completed this task on the measured CPU path. Qwen3 0.6B Q4 remains available for experiments. Its probe consumed a real tool result, but its full handoff attempts exposed repeated searches, source-ID confusion and output-budget failures. Those failures are retained. Parameter count alone was not used to select the default.

## Verification boundaries

A clean archive of commit 27edb4a passed fresh npm installation, worker bundling, strict compilation and all 102 tests, including real separate-process replication. See artifacts/clean-install.json. npm reported zero audit findings. Earlier clean evidence for commit 461bf93 remains in artifacts/clean-install-461bf93.json.

Structured information needs prevent an empty missing list from bypassing an explicit case requirement. The earlier native report passed four of six state checks and failed both missing-configuration trials. Corrected runs passed six of six state checks with pending missing-information outcomes. Those version 1 reports remain historical evidence. Review then found unsupported causal claims in generated fact prose, so these are not six semantically correct answers. The pre-change clean-source report is retained as artifacts/live-deterministic-before-quoted-observations.json.

New briefs use quoted-observations-v1: source quotations become observations, generated explanations are labelled unverified in uncertainty, and trusted code supplies a root-cause uncertainty notice. A clean snapshot at 872df5c passed build and all 105 tests. Its version 2 native baseline and Laya arm each passed and independently regraded six of six automated checks. Every selection kept all six records including five distractors. Laya ran six decisions without fallback or truncation but showed no filtering benefit. See docs/EVALUATION.md for measured costs and limits. These checks are not semantic truth scores.

The selected 1.7B native probe passed in two calls with exact output formatting, and cancellation passed after decoding began. The quoted-policy handoff then stopped on verbose prose with no action at the output limit. The failed report and trace are retained. The v6 loop now treats this as a bounded format repair; controlled tests prove repeated truncation stops and committed requests remain. Related focused suites passed 40 tests. A new clean build and handoff-only run are next. The v5 native comparison is not being relabelled as v6 evidence.

Later commits also preserve quotation whitespace, return correctable whitespace-only feedback, add read-only recorded-state regrading and refresh IDs rediscovered by search. These do not change native settings or the tool definitions used by the measured six-candidate fixtures. Do not overlap installation with inference in this WSL allocation.

Native probe and targeted decode cancellation passed. See artifacts/live-smoke.json and artifacts/live-cancellation.json. The probe separately records functional tool-result consumption and the smaller model's failure to follow exact output formatting. A native probe pass alone is not the full-handoff evidence.

## Runtime facts

The checked Windows host has a Ryzen 5 7430U, about 15.4 GiB usable RAM, integrated Radeon GPU API Vulkan 1.3.260 and loader 1.3.301. Windows Node is 22.20.0. Free RAM was about 1.68 GiB at the first check and is not a current guarantee. QVAC 0.22 documents Vulkan 1.4 on Windows, so this host's verified execution path uses Ubuntu 24.04.5 WSL2 CPU inference.

WSL has about 4 GiB RAM and 2 GiB swap. Ignored .tools contains Linux Node 22.21.1. Installed packages include QVAC 0.22.0, Hyperbee2 2.21.2 and Corestore 7.16.1. Native worker imports on /mnt/c exceeded the default 30 second RPC deadline. A 120 second allowance and an absolute model-cache path in qvac.config.mjs worked. Linux-only bundling avoids unnecessary mobile packages.

A clean npm install was observed around 2.8 GiB RSS. Running it concurrently with the first 1.7B model checksum caused a confounded ENOMEM failure. Installation and inference now run sequentially. No graphics drivers, global Node installation or shared inference service was changed.

## Exact remaining work

1. Complete repeated live deterministic and Laya runs on the same task set. Compare compatible reports and retain failures and fallback details.
2. Finish final live checks and documentation review.
3. Push final verification reports to the existing private https://github.com/da-goat37/prac-sdk. Source is published on code-fix/relay-handoff. The user revoked reviewer invitations. GitHub confirms no pending invitations and only da-goat37 with access. Do not invite anyone.
4. Insert the required personally written design section verbatim when Suyash supplies it. He explicitly deferred this section until later. No AI prose should replace it.
