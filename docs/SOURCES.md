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
