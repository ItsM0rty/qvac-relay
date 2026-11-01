# Relay project notes

Relay is an engineering handoff agent using local QVAC inference and independently owned Hyperbee2 trees. The private GitHub repository name is prac-sdk, with intended owner da-goat37. Do not publish publicly.

## Conventions

- Use code-fix/<short-description> for new branches.
- Repository-local author and committer: Suyash Bhattarai <bhattarai.suyash777@gmail.com>. No coauthor trailers.
- Preserve source reference projects unchanged.
- Trusted code controls record acceptance, permissions, budgets and transitions.
- Never substitute replay for a live model result. Never read another peer directory to simulate replication.
- Leave the assessment's personal design prose to Suyash. Ordinary setup and reference documentation can be maintained here.

## Runtime

Windows Node is 22.20.0. Windows GPU Vulkan API is 1.3.260. QVAC 0.22 documents Vulkan 1.4 on Windows. Native CPU tool calling, cancellation and the full two-peer handoff have passed on Ubuntu 24.04 WSL. Qwen3 1.7B Q4 is the default; one complete handoff took 358177 ms with five cumulative calls and zero repairs. A local Node 22.21.1 runtime is in ignored .tools. Use scripts/linux.sh to select it. Do not change global drivers or toolchains. WSL has about 4 GiB RAM. Run dependency installation and model work sequentially. A clean npm install was observed around 2.8 GiB RSS even with a bounded V8 heap.

## Project map

- src/store.ts: owned trees, replication and record reads.
- src/records.ts: runtime schemas and stable identities.
- src/agent.ts: model/tool loop and persisted progress.
- src/context.ts: bounded context and selectors.
- src/qvac.ts: SDK boundary, cancellation and model lifecycle.
- src/laya.ts: optional bounded native relevance selection with visible fallback.
- src/cli.ts: peer process and user commands.
- src/resume.ts: contribution tracking, restart recovery and bounded automatic resumption.
- src/eval.ts: live and labeled replay evaluation, state checks and strict comparison.
- test/: policy, harness and separate-process P2P checks.
- docs/STATE.md: current evidence and next steps.
- docs/DECISIONS.md: confirmed requirements and implementation choices.
- docs/TESTING.md: commands, evidence and remaining gaps.

## Verified commands

- npm run build
- npm test (101 current-source tests passed; earlier clean installation passed 70)
- npm run smoke (native 0.6B tool result round trip, exact format false)
- node --import tsx scripts/cancel-smoke.ts (native cancellation)
- npm run evaluate -- --mode replay --trials 3 --output artifacts/replay.json
- npm run demo (one complete native 1.7B handoff with offline contribution and restart deduplication)

Current-source final tests, clean installation and live Laya ablation are being verified. The earlier clean-install result predates later harness changes. Full handoff evidence and current ablation status are in docs/STATE.md and retained artifacts. Do not infer it from the existence of a script. Keep docs/TESTING.md current after meaningful verification.
