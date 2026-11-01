# Relay project notes

Relay is an engineering handoff agent using local QVAC inference and independently owned Hyperbee2 trees. The private GitHub repository name is prac-sdk, with intended owner da-goat37. Do not publish publicly.

## Conventions

- Use code-fix/<short-description> for new branches.
- Repository-local author and committer: Suyash Bhattarai <bhattarai.suyash777@gmail.com>. No coauthor trailers.
- Preserve source reference projects unchanged.
- Trusted code controls record acceptance, permissions, budgets and transitions.
- Never substitute replay for a live model result. Never read another peer directory to simulate replication.
- Leave the assessment's personal design prose to Suyash. Ordinary setup and reference documentation can be maintained here.

## Environment under verification

Windows Node is 22.20.0. Windows GPU Vulkan API is 1.3.260. QVAC 0.22 documents Vulkan 1.4 on Windows, so the implementation is probing Ubuntu 24.04 WSL CPU inference. A local Node 22.21.1 runtime is in ignored .tools. Use scripts/linux.sh to select it. Do not change global drivers or toolchains.

## Project map

- src/store.ts: owned trees, replication and record reads.
- src/records.ts: runtime schemas and stable identities.
- src/agent.ts: model/tool loop and persisted progress.
- src/context.ts: bounded context and selectors.
- src/qvac.ts: SDK boundary and lifecycle.
- src/cli.ts: peer process and user commands.
- test/: policy, harness and separate-process P2P checks.
- docs/STATE.md: current evidence and next steps.
- docs/DECISIONS.md: confirmed requirements and implementation choices.
- docs/TESTING.md: commands, evidence and remaining gaps.

Run commands become verified only when recorded in docs/TESTING.md.
