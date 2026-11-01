import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent.js';
import { RelayStore } from '../src/store.js';
import { revision } from '../src/records.js';
import type { Message, Model, ModelReply, ToolSpec } from '../src/qvac.js';

type Step = (history: Message[], tools: ToolSpec[], turn: number) => ModelReply;
class ScriptedModel implements Model {
  readonly name = 'quoted-observation-test-not-live';
  private turn = 0;
  constructor(private readonly steps: Step[]) {}
  async complete(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    signal.throwIfAborted();
    const turn = ++this.turn;
    assert.ok(this.steps[turn - 1], `Unexpected model turn ${turn}`);
    return this.steps[turn - 1]!(history, tools, turn);
  }
  async close(): Promise<void> {}
}
function action(name: string, args: unknown, turn: number): ModelReply {
  return {
    content: '',
    calls: [{ id: `call-${turn}`, name, arguments: args }],
    toolErrors: [],
    stopReason: 'eos',
  };
}
function result<T>(history: Message[], name: string): T {
  const message = history.findLast((item) => item.role === 'tool' && item.toolName === name);
  assert.ok(message);
  return JSON.parse(message.content) as T;
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'relay-observations-'));
  const store = await RelayStore.open(directory);
  const base = {
    schemaVersion: 1 as const,
    owner: store.owner,
    caseId: 'incident',
    createdAt: '2026-10-31T00:00:00.000Z',
  };
  await store.put({
    ...base,
    id: 'case',
    kind: 'case',
    title: 'Queue',
    task: 'Investigate the queue.',
  });
  const source = {
    ...base,
    id: 'queue-log',
    kind: 'evidence' as const,
    title: 'Log',
    text: 'Connection refused at 10:19. Queue depth reached 500 at 10:20.',
  };
  const other = {
    ...base,
    id: 'other-log',
    kind: 'evidence' as const,
    title: 'Other log',
    text: 'Worker restarted at 10:25.',
  };
  await store.put(source);
  await store.put(other);
  return {
    store,
    source,
    other,
    close: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const note = 'Source quotations alone do not establish root cause.';

test('legacy interpretation is labelled as uncertainty while facts are canonical quotations', async () => {
  const f = await fixture();
  try {
    const causal = 'Queue depth caused the earlier connection refusal.';
    const quote1 = 'Connection refused at 10:19.';
    const quote2 = 'Queue depth reached 500 at 10:20.';
    const model = new ScriptedModel([
      (_h, _tools, t) => action('read_record', { id: f.source.id }, t),
      (_h, tools, t) => {
        const schema = tools.find((tool) => tool.name === 'save_brief')!.parameters as any;
        const fact = schema.properties.facts.items;
        assert.equal(Object.hasOwn(fact.properties, 'text'), false);
        assert.equal((fact.required ?? []).includes('text'), false);
        return action(
          'save_brief',
          {
            facts: [
              { text: causal, sources: [{ id: f.source.id, quote: quote1 }] },
              { text: causal, sources: [{ id: f.source.id, quote: quote1 }] },
              { sources: [{ id: f.source.id, quote: quote2 }] },
            ],
            uncertainty: [],
            missing: [],
          },
          t,
        );
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
    const brief = (await f.store.list('incident')).find((r) => r.kind === 'brief');
    assert.ok(brief && brief.kind === 'brief');
    assert.equal(brief.factPolicy, 'quoted-observations-v1');
    assert.deepEqual(
      brief.facts.map((fact) => fact.text),
      [quote1, quote2],
    );
    for (const fact of brief.facts) {
      assert.equal(fact.sources.length, 1);
      assert.equal(fact.text, fact.sources[0]!.quote);
      assert.equal(fact.sources[0]!.revision, revision(f.source));
      assert.notEqual(fact.text, causal);
    }
    assert.ok(brief.uncertainty.includes(`Unverified model interpretation: ${causal}`));
    assert.ok(brief.uncertainty.includes(note));
  } finally {
    await f.close();
  }
});

test('quote-only drafts still enforce coverage, revisions and exact quotations', async () => {
  const f = await fixture();
  try {
    const good = (id: string, quote: string, extra = {}) => ({
      sources: [{ id, quote, ...extra }],
    });
    const save = (facts: unknown[]) => ({ facts, uncertainty: [], missing: [] });
    const model = new ScriptedModel([
      (_h, _tools, t) => action('read_record', { id: f.source.id }, t),
      (_h, _tools, t) => action('read_record', { id: f.other.id }, t),
      (_h, _tools, t) => action('save_brief', save([good(f.source.id, f.source.text)]), t),
      (h, _tools, t) => {
        assert.equal(result<{ code: string }>(h, 'save_brief').code, 'COVERAGE');
        return action(
          'save_brief',
          save([
            good(f.source.id, f.source.text),
            good(f.other.id, f.other.text, { revision: '0'.repeat(64) }),
          ]),
          t,
        );
      },
      (h, _tools, t) => {
        assert.equal(result<{ code: string }>(h, 'save_brief').code, 'REVISION');
        return action(
          'save_brief',
          save([good(f.source.id, f.source.text), good(f.other.id, 'invented quote')]),
          t,
        );
      },
      (h, _tools, t) => {
        assert.equal(result<{ code: string }>(h, 'save_brief').code, 'QUOTE');
        return action(
          'save_brief',
          save([good(f.source.id, f.source.text), good(f.other.id, f.other.text)]),
          t,
        );
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident', {
      requiredIds: [f.source.id, f.other.id],
      maxRepairs: 3,
    });
    assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
    const brief = (await f.store.list('incident')).find((r) => r.kind === 'brief');
    assert.ok(brief && brief.kind === 'brief');
    assert.equal(brief.factPolicy, 'quoted-observations-v1');
    assert.ok(brief.uncertainty.includes(note));
    assert.deepEqual(
      brief.facts.map((fact) => fact.text),
      [f.source.text, f.other.text],
    );
    assert.deepEqual(
      brief.facts.map((fact) => fact.sources[0]!.revision),
      [revision(f.source), revision(f.other)],
    );
  } finally {
    await f.close();
  }
});
