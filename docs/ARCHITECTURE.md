# Module reference

`records.ts` defines strict runtime schemas, immutable operation IDs and canonical content revisions. A record belongs to the public key of its signed tree. A case has one owner. Collaborators contribute evidence referencing an owner's request; they do not edit that owner's tree.

`store.ts` opens one local writable Hyperbee2 tree and separate remote read-only trees on Corestore sessions. Pairing persists public keys. TCP carries actual Corestore replication streams. Remote refresh updates the visible tree root. Reads enforce deadlines and payload limits. A write queue serializes local effects and verifies an expected case fingerprint before accepting a brief.

`qvac.ts` adapts native SDK responses to the harness model interface. It preserves assistant tool calls and tool result IDs. Loading and decode use targeted cancellation. The generator unloads after a run. `laya.ts` loads the optional decision model for one bounded relevance request, checks truncation and unloads before returning.

`context.ts` protects instructions, the original task, outstanding questions and recent complete protocol groups. Evidence is projected to short snippets and budgeted deterministically. The optional selector only chooses eligible evidence IDs. Required resumed contributions survive omissions. Exact source text is obtained through `read_record`.

`agent.ts` owns the model-to-tool-to-result loop. The model can find evidence, read records, request information and propose a brief. Code owns schemas, permissions, acceptance and state transitions. A failed proposal receives specific tool feedback; committed requests remain. Repeated equivalent failures, attempt limits, native failures, overflow and cancellation stop work. Call attempts are checkpointed before inference so a crash cannot reset the budget.

`resume.ts` scans owned pending or interrupted cases. A remote evidence record matters when it references an outstanding request and its contribution ID has not been consumed. Child run IDs derive from persisted prior work and contribution IDs. Checkpoints carry consumed IDs and cumulative budgets. Recovery can settle an already committed brief without reexecuting its write. Completed, cancelled and failed runs do not automatically restart.

`cli.ts` hosts a peer and a loopback control API. Other CLI invocations read only that peer's control metadata and submit authenticated commands. The live demo starts separate processes and directories. Its coordinator never opens peer core files.

`eval.ts` runs synthetic cases through the same Agent and real temporary stores. Replay is a scripted model fixture that inspects protocol and tool results. Live evaluation uses QVAC. State checks grade persisted outcomes. Comparison validates identities and configuration before calculating deltas.

## Request flow

1. A owns a case and evidence. Its model reads the evidence and writes a question and pending brief.
2. B replicates the question, then can remain connected or continue while A is offline.
3. B writes evidence in B's tree with the request ID.
4. A reconnects and replicates B's blocks. The resumer recognizes an unconsumed contribution.
5. A refreshes context and starts bounded work with that contribution protected. A valid new brief cites the contribution and a terminal checkpoint records consumption.

This flow depends on locally received blocks. It cannot prove all peers have supplied their latest data. Source quotations support inspection; semantic truth remains a limitation of the model and the evidence.
