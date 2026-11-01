# Current implementation state

Updated 2026-10-31. Canonical source is this isolated relay-agent checkout. Branch: code-fix/relay-handoff. Repository-local author and committer are Suyash Bhattarai. Source reference projects were preserved unchanged.

## Working code and controlled verification

Implemented strict record schemas, owned Hyperbee2 trees, actual Corestore replication over loopback TCP, the QVAC adapter, bounded native tools, context policies, optional Laya adapter, CLI, checkpoints, remote-change resumption and evaluation tooling.

A clean archive of commit 461bf93 passed fresh npm installation, worker bundling, strict build and 70 tests. The temporary Linux directory was removed by WSL on restart. Later affected harness and state suites also passed. Final verification of the current working tree remains pending. Replay passed three trials over three synthetic tasks; replay is not model-quality evidence.

## Native evidence

- Qwen3 0.6B passed a real dynamic tool-result round trip. It reproduced the token but ignored exact formatting. See artifacts/live-smoke.json.
- Targeted cancellation after native decode began passed and settled as INFERENCE_CANCELLED. See artifacts/live-cancellation.json.
- Full application attempts exposed ordinary prose, repeated searches, duplicate draft facts, output-budget exhaustion and premature save attempts. They stopped visibly. Failed reports are retained in artifacts.
- One native 0.6B run saved a pending brief, A stopped, B contributed to B's own tree, and A reconnected and automatically resumed. That resumed run failed the unread-source rule after spending its repair budget. This is partial live handoff evidence, not a completed demonstration.
- A larger-model download checksum failed with ENOMEM while a clean npm install was competing for RAM. This was a confounded resource failure. A later solo 1.7B run loaded and read evidence, then failed repeated-draft validation.
- The current solo 1.7B handoff attempt uses compact draft fields, native read permissions, allowed source-ID enums, non-greedy sampling and reasoning_budget 0. Its result is pending. Optional Laya has controlled tests but no live verification yet.

## Runtime facts

Windows 11 x64, Ryzen 5 7430U, about 15.4 GiB usable host RAM and 1.68 GiB free at the first check. Integrated Radeon GPU API is Vulkan 1.3.260; loader 1.3.301. Windows Node 22.20.0. These observations are not current free-memory guarantees.

Ubuntu 24.04.5 WSL2 starts successfully, with about 4 GiB RAM and 2 GiB swap. Linux Node 22.21.1 is local in ignored .tools. QVAC 0.22.0, Hyperbee2 2.21.2 and Corestore 7.16.1 are installed. Native CPU inference is verified on this path. Windows Vulkan does not meet QVAC's documented 1.4 requirement.

Native worker import I/O on /mnt/c exceeded the default 30 second RPC deadline. A measured 120 second allowance works. The worker requires an absolute model cache path, provided by qvac.config.mjs. Linux-only bundling avoids unnecessary mobile packages. A clean npm install reached about 2.8 GiB RSS even with a smaller V8 heap. Run installation and inference sequentially. No global drivers, global Node or shared inference service was added.

## Exact remaining work

1. Finish and retain a passing complete native handoff, including restart deduplication.
2. Run repeated live deterministic and Laya evaluations on the same task set and compare compatible reports. Retain failures honestly.
3. Finish current-source build, test matrix, clean setup and documentation review.
4. Publish private da-goat37/prac-sdk and verify privacy and invitations for Drache93, mialso and NamelsKing. GitHub CLI is already authenticated as da-goat37. Nothing has been published yet.
5. Ask Suyash for his required personally written design section when the implementation is ready. Insert only his own prose. Do not block independent development on it.
