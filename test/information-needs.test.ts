import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent.js';
import { RelayStore } from '../src/store.js';
import { stableId } from '../src/records.js';
import type { Message, Model, ModelReply, ToolSpec } from '../src/qvac.js';

const question = 'What timeout setting was deployed?';
const needId = 'deployed-timeout';

for (const followup of ['resolve', 'new-gap'] as const)
  test(`answered-request feedback permits ${followup} without repeating the answered write`, async () => {
    const f = await fixture();
    const requestId = stableId(f.store.owner, 'incident', 'need', needId);
    const base = {
      schemaVersion: 1 as const,
      owner: f.store.owner,
      caseId: 'incident',
      createdAt: '2026-10-31T00:00:00.000Z',
    };
    const newQuestion = 'Which upstream condition remains unverified?';
    try {
      await f.store.put({ ...base, kind: 'request', id: requestId, needId, question });
      await f.store.put({
        ...base,
        kind: 'evidence',
        id: 'answer',
        title: 'Configuration',
        text: 'The timeout was 100 ms.',
        requestId,
      });
      let read: { id: string; text: string };
      const steps: Step[] = [
        (_h, t) => action('read_record', { id: 'answer' }, t),
        (h, t) => {
          read = result(h, 'read_record');
          return action(
            'save_brief',
            { quotes: { [read.id]: read.text }, uncertainty: [], missing: [question] },
            t,
          );
        },
        (h, t) => {
          const rejected = result<{ code: string; feedback: string }>(h, 'save_brief');
          assert.equal(rejected.code, 'ANSWERED_REQUEST');
          assert.match(rejected.feedback, /Do not repeat answered needIds/);
          assert.match(rejected.feedback, /Remove resolved items/);
          assert.match(rejected.feedback, /new question and omit needId/);
          return followup === 'resolve'
            ? action(
                'save_brief',
                { quotes: { [read.id]: read.text }, uncertainty: [], missing: [] },
                t,
              )
            : action('request_information', { question: newQuestion }, t);
        },
      ];
      if (followup === 'new-gap')
        steps.push((h, t) => {
          assert.equal(
            result<{ status: string }>(h, 'request_information').status,
            'awaiting-response',
          );
          return action(
            'save_brief',
            { quotes: { [read.id]: read.text }, uncertainty: [], missing: [newQuestion] },
            t,
          );
        });
      const checkpoint = await new Agent(f.store, new ScriptedModel(steps)).run('incident');
      assert.equal(
        checkpoint.status,
        followup === 'resolve' ? 'completed' : 'pending',
        checkpoint.reason,
      );
      assert.equal(checkpoint.repairs, 1);
      const records = await f.store.list('incident');
      assert.equal(records.filter((r) => r.kind === 'request' && r.needId === needId).length, 1);
      assert.equal(
        records.filter((r) => r.kind === 'request').length,
        followup === 'resolve' ? 1 : 2,
      );
      const briefs = records.filter((r) => r.kind === 'brief');
      assert.equal(briefs.length, 1);
      assert.deepEqual(briefs[0]!.missing, followup === 'resolve' ? [] : [newQuestion]);
      assert.equal(briefs[0]!.facts[0]!.sources[0]!.quote, read!.text);
    } finally {
      await f.close();
    }
  });
type Step = (history: Message[], turn: number) => ModelReply | Promise<ModelReply>;
class ScriptedModel implements Model {
  readonly name = 'information-needs-test-not-live';
  private turn = 0;
  constructor(private readonly steps: Step[]) {}
  async complete(history: Message[], _tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    signal.throwIfAborted();
    const turn = ++this.turn;
    assert.ok(this.steps[turn - 1], `Unexpected model turn ${turn}`);
    return this.steps[turn - 1]!(history, turn);
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
  assert.ok(message, `Expected ${name} result`);
  return JSON.parse(message.content) as T;
}
function draft(reads: Array<{ id: string; text: string }>) {
  return {
    facts: reads.map((read) => ({ text: read.text, sources: [{ id: read.id, quote: read.text }] })),
    uncertainty: [],
    missing: [],
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'relay-needs-'));
  const store = await RelayStore.open(directory);
  const base = {
    schemaVersion: 1 as const,
    owner: store.owner,
    caseId: 'incident',
    createdAt: '2026-10-31T00:00:00.000Z',
  };
  await store.put({
    ...base,
    kind: 'case',
    id: 'incident-case',
    title: 'Configuration',
    task: 'Investigate the timeout.',
    informationNeeds: [{ id: needId, question }],
  });
  await store.put({
    ...base,
    kind: 'evidence',
    id: 'incident-log',
    title: 'Log',
    text: 'Requests timed out after release.',
  });
  return {
    store,
    directory,
    close: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('premature completion is repaired by requesting the required information', async () => {
  const f = await fixture();
  try {
    let read: { id: string; text: string };
    const model = new ScriptedModel([
      (_h, t) => action('read_record', { id: 'incident-log' }, t),
      (h, t) => {
        read = result(h, 'read_record');
        return action('save_brief', draft([read]), t);
      },
      (h, t) => {
        const rejected = result<{ code: string }>(h, 'save_brief');
        assert.equal(rejected.code, 'REQUIRED_INFORMATION_REQUEST');
        return action(
          'request_information',
          { needId, question: 'Please provide configuration.' },
          t,
        );
      },
      (h, t) => {
        const request = result<{
          id: string;
          persisted: boolean;
          duplicate: boolean;
          status: string;
          responseIds: string[];
          guidance: string;
        }>(h, 'request_information');
        assert.equal(request.persisted, true);
        assert.equal(request.duplicate, false);
        assert.equal(request.status, 'awaiting-response');
        assert.deepEqual(request.responseIds, []);
        assert.match(request.guidance, /Save a pending brief/);
        assert.equal(request.id, stableId(f.store.owner, 'incident', 'need', needId));
        return action('request_information', { needId, question }, t);
      },
      (h, t) => {
        const reused = result<{ duplicate: boolean; status: string; responseIds: string[] }>(
          h,
          'request_information',
        );
        assert.equal(reused.duplicate, true);
        assert.equal(reused.status, 'awaiting-response');
        assert.deepEqual(reused.responseIds, []);
        return action('save_brief', draft([read]), t);
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'pending', checkpoint.reason ?? '');
    assert.equal(checkpoint.repairs, 1);
    const records = await f.store.list('incident');
    const requests = records.filter((r) => r.kind === 'request');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.needId, needId);
    assert.equal(requests[0]!.question, question);
    const briefs = records.filter((r) => r.kind === 'brief');
    assert.equal(briefs.length, 1);
    assert.ok(briefs[0]!.missing.includes(question));
  } finally {
    await f.close();
  }
});

test('unknown need ID has no request side effect, and an unrelated request cannot satisfy the need', async () => {
  const f = await fixture();
  try {
    let read: { id: string; text: string };
    const model = new ScriptedModel([
      (_h, t) => action('request_information', { needId: 'unknown', question: 'Unknown?' }, t),
      async (h, t) => {
        assert.equal(result<{ ok: boolean }>(h, 'request_information').ok, false);
        assert.equal(
          (await f.store.list('incident')).filter((r) => r.kind === 'request').length,
          0,
        );
        return action('request_information', { question: 'Who was on call?' }, t);
      },
      (_h, t) => action('read_record', { id: 'incident-log' }, t),
      (h, t) => {
        read = result(h, 'read_record');
        return action('save_brief', draft([read]), t);
      },
      (h, t) => {
        assert.equal(
          result<{ code: string }>(h, 'save_brief').code,
          'REQUIRED_INFORMATION_REQUEST',
        );
        return action('request_information', { needId, question }, t);
      },
      (_h, t) => action('save_brief', draft([read]), t),
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident', { maxRepairs: 3 });
    assert.equal(checkpoint.status, 'pending', checkpoint.reason ?? '');
    const records = await f.store.list('incident');
    assert.equal(records.filter((r) => r.kind === 'request').length, 2);
    assert.equal(records.filter((r) => r.kind === 'brief').length, 1);
  } finally {
    await f.close();
  }
});

test(
  'a linked remote response must be read and cited before completion',
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const remoteDirectory = await mkdtemp(join(tmpdir(), 'relay-needs-remote-'));
    const remote = await RelayStore.open(remoteDirectory);
    try {
      const requestId = stableId(f.store.owner, 'incident', 'need', needId);
      await f.store.put({
        schemaVersion: 1,
        kind: 'request',
        id: requestId,
        owner: f.store.owner,
        caseId: 'incident',
        createdAt: '2026-10-31T00:00:00.000Z',
        question,
        needId,
      });
      await f.store.pair(remote.owner);
      await remote.pair(f.store.owner);
      await f.store.connect(await remote.listen());
      await remote.put({
        schemaVersion: 1,
        kind: 'evidence',
        id: 'timeout-response',
        owner: remote.owner,
        caseId: 'incident',
        createdAt: '2026-10-31T00:00:00.000Z',
        title: 'Setting',
        text: 'The timeout was 100 ms.',
        requestId,
      });
      let arrived = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await f.store.get('timeout-response')) {
          arrived = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(arrived, true);
      let source: { id: string; text: string };
      let response: { id: string; text: string };
      const model = new ScriptedModel([
        (_h, t) => action('request_information', { needId, question }, t),
        (h, t) => {
          const existing = result<{
            duplicate: boolean;
            status: string;
            responseIds: string[];
            guidance: string;
          }>(h, 'request_information');
          assert.equal(existing.duplicate, true);
          assert.equal(existing.status, 'answered');
          assert.deepEqual(existing.responseIds, ['timeout-response']);
          assert.match(existing.guidance, /Read and cite/);
          return action('read_record', { id: 'incident-log' }, t);
        },
        (h, t) => {
          source = result(h, 'read_record');
          return action('read_record', { id: 'timeout-response' }, t);
        },
        (h, t) => {
          response = result(h, 'read_record');
          return action('save_brief', draft([source]), t);
        },
        (h, t) => {
          assert.equal(result<{ code: string }>(h, 'save_brief').code, 'COVERAGE');
          return action('save_brief', draft([source, response]), t);
        },
      ]);
      const checkpoint = await new Agent(f.store, model).run('incident');
      assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
      assert.ok(checkpoint.requiredIds?.includes('timeout-response'));
      const brief = (await f.store.list('incident')).find((r) => r.kind === 'brief');
      assert.ok(brief && brief.kind === 'brief');
      assert.deepEqual(brief.missing, []);
      assert.ok(
        brief.facts.some((fact) =>
          fact.sources.some(
            (s) => s.id === 'timeout-response' && s.quote === 'The timeout was 100 ms.',
          ),
        ),
      );
    } finally {
      await remote.close();
      await f.close();
      await rm(remoteDirectory, { recursive: true, force: true });
    }
  },
);
