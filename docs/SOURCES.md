# Versioned source reference

Implementation inspected the installed npm distribution, not only example code. Runtime dependencies are locked in package-lock.json.

- [QVAC JS/TS SDK](https://docs.qvac.tether.io/sdk/js-ts-sdk/): installation and configuration.
- [QVAC system requirements](https://docs.qvac.tether.io/sdk/system-requirements/): Windows Vulkan requirement and Linux CPU path.
- [Text generation](https://docs.qvac.tether.io/sdk/ai-capabilities/text-generation/): native tool-call events and assistant/tool history.
- [Decisions](https://docs.qvac.tether.io/sdk/ai-capabilities/decisions/): decide(), typed questions, truncation and unusable actProbability.
- [Model fit](https://docs.qvac.tether.io/sdk/models/assess-model-fit/): advisory estimation, not a measured fit guarantee.
- [SDK 0.22 release](https://github.com/tetherto/qvac/releases/tag/sdk-v0.22.0): bundling toolchain compatibility.
- [Hyperbee2](https://github.com/holepunchto/hyperbee2): constructor, write batches, refresh and snapshots. Installed version2.21.2 was inspected.
- [Hypercore](https://github.com/holepunchto/hypercore): signed replication and block reads.
- [Official QVAC examples](https://github.com/tetherto/qvac-examples): integration reference only, not evidence those examples ran on this machine.
- [Laya typed-decisions checkpoint](https://huggingface.co/convaiinnovations/laya-typed-decisions) and [checkpoint configuration](https://huggingface.co/convaiinnovations/laya/resolve/main/typed-decisions/rl_agent_config.json): English specialist, sequence1024 and head256. Relevance selection still needs application measurements.

The text-generation page contained an older example that omitted call metadata. Relay follows the current native tool protocol and installed types. SDK0.22.0's final stop reason was absent in observed aggregated results, so the adapter also consumes completionDone events explicitly.

Entode, OpenSwitch and EvalGate were inspected locally and preserved unchanged. Their reusable principles and the limits of that connection are recorded in DECISIONS.md. None is a runtime dependency of Relay.

## Passage reranking sources

- [Pinned Xenova ONNX model revision](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/tree/a09144355adeed5f58c8ed011d209bf8ee5a1fec) and its [INT8 artifact](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/blob/a09144355adeed5f58c8ed011d209bf8ee5a1fec/onnx/model_int8.onnx). Relay verifies the four file hashes listed in `src/minilm.ts` during explicit preparation.
- [Original cross-encoder model card](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2), which identifies the Apache 2.0 license and describes its intended ranking use. The Xenova conversion does not publish a separate root license file; Relay does not redistribute its weights.
- [Transformers.js 4.3.2 source](https://github.com/huggingface/transformers.js/tree/4.3.2) and [ONNX Runtime documentation](https://onnxruntime.ai/docs/). The installed runtime is pinned in the lockfile; these sources are not evidence of Relay quality.

[kaiyes/fast-jev-compaction-laya](https://github.com/kaiyes/fast-jev-compaction-laya) describes comparative three-choice decisions, bounded state and original-preservation patterns. Its README reports weak relevance and occasional wrong truncations; those self-reports do not prove this pipeline works or establish Relay performance. Relay's own native probe and held-out evaluation have separate scopes.
