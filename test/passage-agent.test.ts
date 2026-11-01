import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from '../src/agent.js';
import { buildContext, validateHistory } from '../src/context.js';
import { RelayStore } from '../src/store.js';
import { revision, type EvidenceRecord } from '../src/records.js';
import type { Message, Model, ModelReply, ToolSpec } from '../src/qvac.js';

type Step = (history: Message[], turn: number) => ModelReply | Promise<ModelReply>;
class ControlledModel implements Model {
  name = 'passage-integration-not-live';
  private turn = 0;
  constructor(private readonly steps: Step[]) {}
  async complete(history: Message[], _tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    signal.throwIfAborted();
    validateHistory(history);
    const turn = ++this.turn;
    assert.ok(this.steps[turn - 1], `Unexpected turn ${turn}`);
    return this.steps[turn - 1]!(history, turn);
  }
  async close() {}
}
const action = (name: string, args: unknown, turn: number): ModelReply => ({
  content: '',
  calls: [{ id: `call-${turn}`, name, arguments: args }],
  toolErrors: [],
  stopReason: 'eos',
});
function result<T>(history: Message[], name: string): T {
  const message = history.findLast((m) => m.role === 'tool' && m.toolName === name);
  assert.ok(message, `Missing real ${name} result`);
  assert.ok(
    history.some(
      (m) => m.role === 'assistant' && m.toolCalls?.some((c) => c.id === message.toolCallId),
    ),
  );
  return JSON.parse(message.content) as T;
}
const draft = (id: string, quotes: string[]) => ({
  facts: quotes.map((quote) => ({ sources: [{ id, quote }] })),
  uncertainty: [],
  missing: [],
});
async function fixture(
  body: (
    store: RelayStore,
    base: { schemaVersion: 1; owner: string; caseId: string; createdAt: string },
  ) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-passage-agent-'));
  const store = await RelayStore.open(dir);
  const base = {
    schemaVersion: 1 as const,
    owner: store.owner,
    caseId: 'incident',
    createdAt: '2026-10-31T00:00:00.000Z',
  };
  try {
    await store.put({
      ...base,
      kind: 'case',
      id: 'case',
      title: 'Incident',
      task: 'Investigate the zircon marker.',
    });
    await body(store, base);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
const preface = 'Routine inspection recorded ordinary operations and shift handover. '.repeat(40);
const quote = 'The zircon marker confirms the late observation.';

test('omitted late source is found through the actual search result, read at its offset and cited', async () => {
  await fixture(async (store, base) => {
    const source: EvidenceRecord = {
      ...base,
      kind: 'evidence',
      id: 'late-log',
      title: 'Long log',
      text: preface + quote,
    };
    await store.put(source);
    const omit = { select: async () => ({ ids: [], policy: 'omit-fixture' }) };
    const required = await buildContext({
      task: 'zircon marker',
      records: [source],
      history: [],
      tools: [],
      selector: omit,
      requiredIds: [source.id],
      signal: new AbortController().signal,
    });
    assert.ok(
      required.selection.locations?.some((p) => p.sourceId === source.id && p.start > 2000),
    );
    let foundOffset = -1;
    const model = new ControlledModel([
      (history, t) => {
        const index = history.find((m) => m.role === 'user' && m.content.includes('evidenceIndex'));
        assert.ok(index);
        assert.deepEqual(JSON.parse(index.content).evidenceIndex, []);
        return action('find_evidence', { query: 'zircon marker' }, t);
      },
      (history, t) => {
        const matches = result<
          Array<{
            id: string;
            passageId: string;
            offset: number;
            end: number;
            revision: string;
            title: string;
            text: string;
          }>
        >(history, 'find_evidence');
        const found = matches.find((m) => m.text.includes(quote));
        assert.ok(found);
        assert.equal(found.id, source.id);
        assert.notEqual(found.passageId, source.id);
        assert.equal(found.revision, revision(source));
        assert.equal(found.title, source.title);
        assert.equal(found.text, source.text.slice(found.offset, found.end));
        assert.ok(found.offset > 2000);
        foundOffset = found.offset;
        return action('read_record', { id: found.id, offset: found.offset }, t);
      },
      (history, t) => {
        const read = result<{
          id: string;
          text: string;
          offset: number;
          end: number;
          nextOffset: number | null;
          totalLength: number;
        }>(history, 'read_record');
        assert.equal(read.offset, foundOffset);
        assert.equal(read.text, source.text.slice(read.offset, read.end));
        assert.equal(read.totalLength, source.text.length);
        assert.equal(read.nextOffset, read.end < source.text.length ? read.end : null);
        assert.ok(read.text.includes(quote));
        return action('save_brief', draft(read.id, [quote]), t);
      },
    ]);
    const checkpoint = await new Agent(store, model).run('incident', { selector: omit });
    assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
    const brief = (await store.list('incident')).find((r) => r.kind === 'brief');
    assert.ok(brief && brief.kind === 'brief');
    assert.equal(brief.facts[0]!.sources[0]!.quote, quote);
  });
});

test('separate excerpts can both be cited, while an unread gap is rejected and repaired', async () => {
  await fixture(async (store, base) => {
    const first = 'First independently observed fact.';
    const gap = 'The unread middle contains a separate observation.';
    const last = 'Second independently observed fact.';
    const text = first + 'x'.repeat(1200) + gap + 'y'.repeat(1200) + last;
    await store.put({ ...base, kind: 'evidence', id: 'slices', title: 'Slices', text });
    const lastOffset = text.indexOf(last);
    const model = new ControlledModel([
      (_h, t) => action('read_record', { id: 'slices', offset: 0, length: first.length }, t),
      (h, t) => {
        const r = result<{
          text: string;
          offset: number;
          end: number;
          nextOffset: number;
          totalLength: number;
        }>(h, 'read_record');
        assert.deepEqual(
          [r.text, r.offset, r.end, r.nextOffset, r.totalLength],
          [first, 0, first.length, first.length, text.length],
        );
        return action('read_record', { id: 'slices', offset: lastOffset, length: last.length }, t);
      },
      (h, t) => {
        const r = result<{ text: string; offset: number; end: number; nextOffset: null }>(
          h,
          'read_record',
        );
        assert.deepEqual(
          [r.text, r.offset, r.end, r.nextOffset],
          [last, lastOffset, text.length, null],
        );
        return action('save_brief', draft('slices', [first, last, gap]), t);
      },
      (h, t) => {
        assert.equal(result<{ code: string }>(h, 'save_brief').code, 'QUOTE');
        return action('save_brief', draft('slices', [first, last]), t);
      },
    ]);
    const cp = await new Agent(store, model).run('incident');
    assert.equal(cp.status, 'completed', cp.reason ?? '');
    assert.equal(cp.repairs, 1);
    const brief = (await store.list('incident')).find((r) => r.kind === 'brief');
    assert.ok(brief && brief.kind === 'brief');
    assert.deepEqual(
      brief.facts.map((f) => f.sources[0]!.quote),
      [first, last],
    );
  });
});

test('replicated evidence becomes searchable by an existing agent and by a restarted agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-passage-peers-'));
  let a: RelayStore | undefined, b: RelayStore | undefined;
  try {
    a = await RelayStore.open(join(dir, 'a'));
    b = await RelayStore.open(join(dir, 'b'));
    await a.pair(b.owner);
    await b.pair(a.owner);
    await b.connect(await a.listen());
    const base = {
      schemaVersion: 1 as const,
      caseId: 'incident',
      createdAt: '2026-10-31T00:00:00.000Z',
    };
    await a.put({
      ...base,
      owner: a.owner,
      kind: 'case',
      id: 'case',
      title: 'Incident',
      task: 'Investigate the remote marker.',
    });
    await a.put({
      ...base,
      owner: a.owner,
      kind: 'evidence',
      id: 'local',
      title: 'Local',
      text: 'Local ordinary observation.',
    });
    const remote = {
      ...base,
      owner: b.owner,
      kind: 'evidence' as const,
      id: 'remote',
      title: 'Remote log',
      text: 'A replicated cobalt marker was observed.',
    };
    let remoteStore = b;
    const model = new ControlledModel([
      (_h, t) => action('find_evidence', { query: 'cobalt marker' }, t),
      async (h, t) => {
        assert.deepEqual(result<unknown[]>(h, 'find_evidence'), []);
        await remoteStore.put(remote);
        for (let i = 0; i < 100; i++) {
          if ((await a!.list('incident')).some((r) => r.id === remote.id)) break;
          await delay(25);
        }
        assert.ok((await a!.list('incident')).some((r) => r.id === remote.id));
        return action('find_evidence', { query: 'cobalt marker' }, t);
      },
      (h, t) => {
        const matches = result<Array<{ id: string; text: string; offset: number }>>(
          h,
          'find_evidence',
        );
        const found = matches.find((m) => m.id === remote.id);
        assert.ok(found);
        assert.equal(found.text, remote.text);
        return action('read_record', { id: found.id, offset: found.offset }, t);
      },
      (h, t) => {
        const read = result<{ id: string; text: string }>(h, 'read_record');
        return action('save_brief', draft(read.id, [read.text]), t);
      },
    ]);
    const agent = new Agent(a, model);
    const cp = await agent.run('incident');
    assert.equal(cp.status, 'completed', cp.reason ?? '');
    const restarted = new Agent(
      a,
      new ControlledModel([
        (_h, t) => action('find_evidence', { query: 'cobalt marker' }, t),
        (h, t) => {
          const found = result<Array<{ id: string; offset: number }>>(h, 'find_evidence').find(
            (m) => m.id === remote.id,
          );
          assert.ok(found);
          return action('read_record', { id: found.id, offset: found.offset }, t);
        },
        (h, t) => {
          const read = result<{ id: string; text: string }>(h, 'read_record');
          return action('save_brief', draft(read.id, [read.text]), t);
        },
      ]),
    );
    const cp2 = await restarted.run('incident');
    assert.equal(cp2.status, 'completed', cp2.reason ?? '');
  } finally {
    await Promise.allSettled([a?.close(), b?.close()]);
    await rm(dir, { recursive: true, force: true });
  }
});
