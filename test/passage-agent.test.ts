import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, latestCheckpoint, validateArguments } from '../src/agent.js';
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
test('search cursors beyond the former 2048 limit remain usable without unsafe arithmetic', () => {
  assert.equal(validateArguments('find_evidence', { query: 'zircon', skip: 2049 }).skip, 2049);
  assert.throws(() =>
    validateArguments('find_evidence', { query: 'zircon', skip: Number.MAX_SAFE_INTEGER }),
  );
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
          }>
        >(history, 'find_evidence');
        const found = matches.find((m) => m.id === source.id);
        assert.ok(found);
        assert.equal(found.id, source.id);
        assert.notEqual(found.passageId, source.id);
        assert.equal(found.revision, revision(source));
        assert.equal(found.title, source.title);
        assert.equal(Object.hasOwn(found, 'text'), false);
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
        const matches = result<Array<{ id: string; offset: number }>>(h, 'find_evidence');
        const found = matches.find((m) => m.id === remote.id);
        assert.ok(found);
        assert.equal(Object.hasOwn(found, 'text'), false);
        return action('read_record', { id: found.id, offset: found.offset }, t);
      },
      (h, t) => {
        const read = result<{ id: string; text: string }>(h, 'read_record');
        assert.equal(read.text, remote.text);
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

test('bounded search navigates paginated matches and recovers a late source via read', async () => {
  await fixture(async (store, base) => {
    const late = `${'Routine observations were logged. '.repeat(80)}Zircon amber late fact was confirmed.`;
    await store.put({
      ...base,
      kind: 'evidence',
      id: 'late-navigation',
      title: 'Zircon amber',
      text: late,
    });
    for (let i = 0; i < 9; i++)
      await store.put({
        ...base,
        kind: 'evidence',
        id: `other-${i}`,
        title: 'Zircon',
        text: `Zircon inspection ${i} was routine.`,
      });
    let chosen = -1;
    const model = new ControlledModel([
      (_h, t) => action('find_evidence', { query: 'zircon amber', limit: 8 }, t),
      (h, t) => {
        const msg = h.findLast((m) => m.role === 'tool' && m.toolName === 'find_evidence')!;
        assert.ok(Buffer.byteLength(msg.content, 'utf8') <= 1000);
        const matches = result<
          Array<{ id: string; offset: number; nextSkip?: number | null; text?: string }>
        >(h, 'find_evidence');
        assert.ok(matches.length > 0 && matches.length < 8);
        assert.equal(matches.at(-1)!.nextSkip, matches.length);
        assert.ok(matches.every((m) => !Object.hasOwn(m, 'text')));
        const found = matches.find((m) => m.id === 'late-navigation');
        assert.ok(found);
        assert.ok(found.offset > 2000);
        chosen = found.offset;
        return action('read_record', { id: found.id, offset: found.offset }, t);
      },
      (h, t) => {
        const read = result<{ id: string; offset: number; end: number; text: string }>(
          h,
          'read_record',
        );
        assert.equal(read.offset, chosen);
        assert.equal(read.text, late.slice(read.offset, read.end));
        assert.ok(read.text.includes('Zircon amber late fact was confirmed.'));
        return action('save_brief', draft(read.id, ['Zircon amber late fact was confirmed.']), t);
      },
    ]);
    const cp = await new Agent(store, model).run('incident');
    assert.equal(cp.status, 'completed', cp.reason ?? '');
  });
});

test('parallel read payloads are bounded and undelivered text cannot be cited before a later read', async () => {
  await fixture(async (store, base) => {
    const hidden = 'The tail was not delivered in the first batch.';
    const text = `${'x'.repeat(550)}${hidden}${'y'.repeat(300)}`;
    for (const id of ['batch-a', 'batch-b'])
      await store.put({ ...base, kind: 'evidence', id, title: 'Batch', text });
    const model = new ControlledModel([
      (_h, t) => ({
        content: '',
        calls: ['batch-a', 'batch-b'].map((id, i) => ({
          id: `batch-${t}-${i}`,
          name: 'read_record',
          arguments: { id, offset: 0, length: 1000 },
        })),
        toolErrors: [],
        stopReason: 'eos',
      }),
      (h, t) => {
        const messages = h.filter((m) => m.role === 'tool' && m.toolName === 'read_record');
        assert.equal(messages.length, 2);
        for (const m of messages) {
          assert.ok(Buffer.byteLength(m.content, 'utf8') <= 500);
          const read = JSON.parse(m.content) as {
            text: string;
            offset: number;
            end: number;
            nextOffset: number | null;
            truncated: boolean;
          };
          assert.equal(read.text, text.slice(read.offset, read.end));
          assert.ok(read.end < 550);
          assert.equal(read.nextOffset, read.end);
          assert.equal(read.truncated, true);
          assert.ok(!read.text.includes(hidden));
        }
        return action('save_brief', draft('batch-a', [hidden]), t);
      },
      (h, t) => {
        assert.equal(result<{ code: string }>(h, 'save_brief').code, 'QUOTE');
        return action('read_record', { id: 'batch-a', offset: 550, length: hidden.length }, t);
      },
      (h, t) => {
        const read = result<{ id: string; text: string }>(h, 'read_record');
        assert.equal(read.text, hidden);
        return action('save_brief', draft(read.id, [read.text]), t);
      },
    ]);
    const cp = await new Agent(store, model).run('incident');
    assert.equal(cp.status, 'completed', cp.reason ?? '');
    assert.equal(cp.repairs, 1);
  });
});

test('oversized rejected draft repairs from protected read progress without repeating the read', async () => {
  await fixture(async (store, base) => {
    const quote = 'The zircon marker was amber.';
    await store.put({
      ...base,
      kind: 'evidence',
      id: 'draft-source',
      title: 'Zircon',
      text: quote,
    });
    const model = new ControlledModel([
      (_h, t) => action('read_record', { id: 'draft-source' }, t),
      (h, t) => {
        assert.equal(result<{ text: string }>(h, 'read_record').text, quote);
        return action(
          'save_brief',
          draft(
            'draft-source',
            [0, 1, 2].map((i) => 'x'.repeat(990) + i),
          ),
          t,
        );
      },
      (h, t) => {
        const state = h
          .filter((m) => m.role === 'user')
          .map((m) => JSON.parse(m.content))
          .find((v) => Array.isArray(v.readIds));
        assert.deepEqual(state.readIds, ['draft-source']);
        assert.ok(state.feedback);
        assert.ok(
          !h.some((m) => m.role === 'tool' && m.toolName === 'save_brief'),
          'Rejected draft should leave the protected prompt under budget pressure',
        );
        return action('save_brief', draft('draft-source', [quote]), t);
      },
    ]);
    const cp = await new Agent(store, model).run('incident', { contextBudget: 6500 });
    assert.equal(cp.status, 'completed', cp.reason ?? '');
    assert.equal(cp.calls, 3);
    assert.equal(cp.repairs, 1);
  });
});

test('new owned checkpoints remain later than persisted progress after a wall-clock rollback', async () => {
  await fixture(async (store, base) => {
    const quote = 'The zircon marker was amber.';
    const future = '2099-01-01T05:45:00.000+05:45';
    await store.put({
      ...base,
      kind: 'checkpoint',
      id: 'future-checkpoint',
      createdAt: future,
      runId: 'old-run',
      status: 'failed',
      task: 'Investigate zircon.',
      calls: 3,
      repairs: 0,
      consumed: [],
      requestIds: [],
      reason: 'Earlier persisted run.',
    });
    await store.put({
      ...base,
      kind: 'evidence',
      id: 'clock-source',
      title: 'Zircon',
      text: quote,
    });
    const model = new ControlledModel([
      (_h, t) => action('read_record', { id: 'clock-source' }, t),
      (_h, t) => action('save_brief', draft('clock-source', [quote]), t),
    ]);
    const cp = await new Agent(store, model).run('incident');
    assert.equal(cp.status, 'completed', cp.reason ?? '');
    assert.ok(Date.parse(cp.createdAt) > Date.parse(future));
    assert.equal(latestCheckpoint(await store.list('incident'), store.owner)?.runId, cp.runId);
  });
});

test('both exact quotes remain usable after the first read leaves protocol history', async () => {
  await fixture(async (store, base) => {
    const quotes = {
      'first-source': 'The zircon marker was amber.',
      'second-source': 'The zircon setting was 100 ms.',
    };
    for (const [id, text] of Object.entries(quotes))
      await store.put({ ...base, kind: 'evidence', id, title: 'Zircon', text });
    const model = new ControlledModel([
      (_h, t) => action('read_record', { id: 'first-source' }, t),
      (h, t) => {
        assert.equal(result<{ text: string }>(h, 'read_record').text, quotes['first-source']);
        return action('read_record', { id: 'second-source' }, t);
      },
      (h, t) => {
        assert.equal(result<{ text: string }>(h, 'read_record').text, quotes['second-source']);
        return action('find_evidence', { query: 'zircon' }, t);
      },
      (h, t) => {
        assert.ok(
          !h.some(
            (m) =>
              m.role === 'tool' &&
              m.toolName === 'read_record' &&
              JSON.parse(m.content).id === 'first-source',
          ),
        );
        const states = h.filter((m) => m.role === 'user').map((m) => JSON.parse(m.content));
        assert.deepEqual(
          [...states.find((v) => v.readIds)?.readIds].sort(),
          Object.keys(quotes).sort(),
        );
        const evidence = states.find((v) => v.evidenceIndex)?.evidenceIndex;
        for (const [id, quote] of Object.entries(quotes))
          assert.ok(
            evidence.some(
              (c: { sourceId: string; text: string }) =>
                c.sourceId === id && c.text.includes(quote),
            ),
          );
        return action(
          'save_brief',
          {
            facts: Object.entries(quotes).map(([id, quote]) => ({ sources: [{ id, quote }] })),
            uncertainty: [],
            missing: [],
          },
          t,
        );
      },
    ]);
    const cp = await new Agent(store, model).run('incident', { requiredIds: Object.keys(quotes) });
    assert.equal(cp.status, 'completed', cp.reason ?? '');
    assert.equal(cp.calls, 4);
    assert.equal(cp.repairs, 0);
  });
});
