import assert from 'node:assert/strict';
import test from 'node:test';
import { LayaSelector, type Cancellable, type LayaInput, type LayaRuntime } from '../src/laya.js';
import { buildContext, type Candidate } from '../src/context.js';
import { parseRecord, type EvidenceRecord } from '../src/records.js';
import { RelayError } from '../src/policy.js';

const signal = new AbortController().signal;
const candidates: Candidate[] = Array.from({ length: 8 }, (_, i) => ({
  id: `e${i}`,
  revision: 'r1',
  title: 'Deployment '.repeat(8),
  text: 'Deployment evidence '.repeat(20),
}));
function pending<T>(value: T, id: string): Cancellable<T> {
  return Object.assign(Promise.resolve(value), { requestId: id });
}
function deferred<T>(id: string) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = Object.assign(
    new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    { requestId: id },
  );
  return { promise, resolve, reject };
}
function result(keys = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']) {
  return {
    model: 'laya-test-boundary',
    answers: Object.fromEntries(
      keys.map((key, i) => [
        key,
        {
          type: 'choice',
          choice: i % 2 === 0 ? 'include' : 'omit',
          probabilities: { include: 0.5, omit: 0.5 },
          confidence: 0.5,
          answerConfidence: 0.5,
          action: { actProbability: i % 2 ? 1 : 0 },
        },
      ]),
    ),
    usage: {
      inputTokens: 100,
      outputTokens: 6,
      stateTokens: 90,
      stateTokensDropped: 0,
      truncated: false,
      truncatedQuestions: [] as string[],
    },
  };
}
function fixture(output: unknown = result()) {
  const events: string[] = [];
  let input: LayaInput | undefined;
  const runtime: LayaRuntime = {
    load: () => {
      events.push('load');
      return pending('model-1', 'load-1');
    },
    decide: (id, request) => {
      assert.equal(id, 'model-1');
      events.push('decide');
      input = request;
      return pending(output, 'decision-1');
    },
    unload: async (id) => {
      assert.equal(id, 'model-1');
      events.push('unload');
    },
    cancel: async (id) => {
      events.push(`cancel:${id}`);
    },
  };
  return { selector: new LayaSelector(async () => runtime), runtime, events, input: () => input };
}

test('Laya makes one bounded request and unloads before returning selection', async () => {
  const f = fixture();
  const selection = await f.selector.select('Deployment '.repeat(50), candidates, signal);
  assert.deepEqual(selection.ids, ['e0', 'e2', 'e4']);
  assert.equal(selection.policy, 'laya');
  assert.deepEqual(f.events, ['load', 'decide', 'unload']);
  const input = f.input()!;
  assert.equal(input.state.task.length, 240);
  assert.equal(input.state.candidates.length, 6);
  assert.ok(input.state.candidates.every((c) => c.title.length <= 40 && c.text.length <= 80));
  assert.equal(Object.keys(input.questions).length, 6);
  assert.equal(input.maxLen, 1024);
  assert.equal(input.headMaxLen, 256);
  await f.selector.close();
});

test('empty candidates avoid native model loading', async () => {
  const f = fixture();
  assert.deepEqual((await f.selector.select('Task', [], signal)).ids, []);
  assert.deepEqual(f.events, []);
});

test('pre-cancelled and duplicate inputs do not acquire a native model', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.selector.select('Deployment', candidates, controller.signal), {
    name: 'AbortError',
  });
  await assert.rejects(
    f.selector.select('Deployment', [candidates[0]!, candidates[0]!], signal),
    /duplicate candidate/,
  );
  assert.deepEqual(f.events, []);
});

test('malformed, missing, unknown and truncated answers reject after unload', async () => {
  const truncated = result();
  truncated.usage.truncated = true;
  const dropped = result();
  dropped.usage.stateTokensDropped = 1;
  const questions = result();
  questions.usage.truncatedQuestions = ['c0'];
  const badChoice = result();
  badChoice.answers.c0!.choice = 'invented';
  const badProbabilities = result();
  badProbabilities.answers.c0!.probabilities.include = Number.NaN;
  for (const output of [
    null,
    {},
    result(['c0']),
    result(['c0', 'c1', 'c2', 'c3', 'c4', 'unknown']),
    truncated,
    dropped,
    questions,
    badChoice,
    badProbabilities,
  ]) {
    const f = fixture(output);
    await assert.rejects(f.selector.select('Deployment', candidates, signal), /LAYA_/);
    assert.equal(f.events.at(-1), 'unload');
  }
});

test('buildContext visibly falls back and protects required evidence', async () => {
  const records = candidates.slice(0, 2).map(
    (c) =>
      parseRecord({
        schemaVersion: 1,
        kind: 'evidence',
        id: c.id,
        owner: 'a'.repeat(64),
        caseId: 'case-1',
        createdAt: '2026-10-31T00:00:00Z',
        title: c.title,
        text: c.text,
      }) as EvidenceRecord,
  );
  const args = { task: 'Deployment', records, history: [], tools: [], requiredIds: ['e1'], signal };
  const broken = await buildContext({ ...args, selector: fixture({}).selector });
  assert.equal(broken.selection.policy, 'deterministic');
  assert.match(broken.selection.fallback!, /LAYA_OUTPUT/);
  const omit = result(['c0', 'c1']);
  Object.values(omit.answers).forEach((answer) => {
    answer.choice = 'omit';
  });
  const selected = await buildContext({ ...args, selector: fixture(omit).selector });
  assert.deepEqual(selected.selection.ids, ['e1']);
});

test('cancellation waits for native decision settlement and unload', async () => {
  const f = fixture();
  const decision = deferred<unknown>('decision-pending');
  const entered = deferred<void>('entered');
  const cancelAck = deferred<void>('cancel-ack');
  f.runtime.decide = () => {
    f.events.push('decide');
    entered.resolve();
    return decision.promise;
  };
  f.runtime.cancel = async (id) => {
    f.events.push(`cancel:${id}`);
    await cancelAck.promise;
  };
  const controller = new AbortController();
  const selecting = f.selector.select('Deployment', candidates, controller.signal);
  const rejected = assert.rejects(selecting, { name: 'AbortError' });
  await entered.promise;
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  assert.equal(f.events.includes('unload'), false);
  decision.resolve(result());
  await Promise.resolve();
  assert.equal(
    f.events.includes('unload'),
    false,
    'Native cancellation acknowledgement must settle before unload',
  );
  cancelAck.resolve();
  await rejected;
  assert.deepEqual(f.events, ['load', 'decide', 'cancel:decision-pending', 'unload']);
});

test('close cancels model loading and unloads a raced successful acquisition', async () => {
  const f = fixture();
  const loading = deferred<string>('loading-pending');
  const entered = deferred<void>('entered');
  f.runtime.load = () => {
    f.events.push('load');
    entered.resolve();
    return loading.promise;
  };
  const selecting = f.selector.select('Deployment', candidates, signal);
  const rejected = assert.rejects(selecting, { name: 'AbortError' });
  await entered.promise;
  const closing = f.selector.close();
  assert.equal(f.events.includes('unload'), false);
  loading.resolve('model-1');
  await Promise.all([rejected, closing]);
  assert.deepEqual(f.events, ['load', 'cancel:loading-pending', 'unload']);
  await assert.rejects(f.selector.select('Deployment', candidates, signal), /LAYA_CLOSED/);
});

test('native failures unload and concurrent selection is rejected', async () => {
  const f = fixture();
  const decision = deferred<unknown>('decision-pending');
  f.runtime.decide = () => decision.promise;
  const selecting = f.selector.select('Deployment', candidates, signal);
  const rejected = assert.rejects(selecting, /native failure/);
  await assert.rejects(f.selector.select('Deployment', candidates, signal), /LAYA_BUSY/);
  decision.reject(new Error('native failure'));
  await rejected;
  assert.equal(f.events.at(-1), 'unload');
});

test('failed unload quarantines the retained model and close retries the same resource', async () => {
  const f = fixture();
  const cause = new Error('Native selector unload failed');
  let fails = true;
  f.runtime.unload = async (id) => {
    assert.equal(id, 'model-1');
    f.events.push('unload');
    if (fails) throw cause;
  };
  const isCleanupFailure = (error: unknown) =>
    error instanceof RelayError &&
    error.code === 'MODEL_RELEASE_FAILED' &&
    error.kind === 'infrastructure' &&
    error.cause === cause;
  await assert.rejects(f.selector.select('Deployment', candidates, signal), isCleanupFailure);
  await assert.rejects(f.selector.select('Deployment', candidates, signal), isCleanupFailure);
  assert.deepEqual(f.events, ['load', 'decide', 'unload']);
  await assert.rejects(f.selector.close(), isCleanupFailure);
  assert.deepEqual(f.events, ['load', 'decide', 'unload', 'unload']);
  fails = false;
  await f.selector.close();
  assert.deepEqual(f.events, ['load', 'decide', 'unload', 'unload', 'unload']);
  await assert.rejects(f.selector.select('Deployment', candidates, signal), /LAYA_CLOSED/);
});

test('failed load cancellation still releases an acquired model before fallback', async () => {
  const f = fixture();
  const loading = deferred<string>('load-pending');
  const controller = new AbortController();
  const cancelCause = new Error('Native cancellation acknowledgement failed');
  const unloadCause = new Error('Native unload failed after cancellation');
  let unloadFails = true;
  f.runtime.load = () => {
    f.events.push('load');
    return loading.promise;
  };
  f.runtime.cancel = async (id) => {
    f.events.push(`cancel:${id}`);
    throw cancelCause;
  };
  f.runtime.unload = async (id) => {
    assert.equal(id, 'model-1');
    f.events.push('unload');
    if (unloadFails) throw unloadCause;
  };

  const selecting = f.selector.select('Deployment', candidates, controller.signal);
  const rejected = assert.rejects(
    selecting,
    (error: unknown) =>
      error instanceof RelayError &&
      error.code === 'MODEL_RELEASE_FAILED' &&
      error.kind === 'infrastructure' &&
      error.cause === unloadCause,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  loading.resolve('model-1');
  await rejected;
  assert.deepEqual(f.events, ['load', 'cancel:load-pending', 'unload']);
  await assert.rejects(
    f.selector.select('Deployment', candidates, signal),
    (error: unknown) => error instanceof RelayError && error.code === 'MODEL_RELEASE_FAILED',
  );

  unloadFails = false;
  await f.selector.close();
  assert.deepEqual(f.events, ['load', 'cancel:load-pending', 'unload', 'unload']);
});

test('selector cleanup failure propagates through buildContext instead of allowing generator fallback', async () => {
  const f = fixture(result(['c0']));
  f.runtime.unload = async () => {
    f.events.push('unload');
    throw new Error('Uncertain native residency');
  };
  const record = parseRecord({
    schemaVersion: 1,
    kind: 'evidence',
    id: 'e0',
    owner: 'a'.repeat(64),
    caseId: 'case-1',
    createdAt: '2026-10-31T00:00:00Z',
    title: 'Deployment',
    text: 'Deployment completed.',
  });
  const args = {
    task: 'Deployment',
    records: [record],
    history: [],
    tools: [],
    selector: f.selector,
    signal,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      buildContext(args),
      (error: unknown) =>
        error instanceof RelayError &&
        error.code === 'MODEL_RELEASE_FAILED' &&
        error.kind === 'infrastructure',
    );
  }
  assert.deepEqual(f.events, ['load', 'decide', 'unload']);
  await assert.rejects(
    f.selector.close(),
    (error: unknown) => error instanceof RelayError && error.code === 'MODEL_RELEASE_FAILED',
  );
  assert.deepEqual(f.events, ['load', 'decide', 'unload', 'unload']);
});

test('ordinary decision errors still fall back after successful native cleanup', async () => {
  const f = fixture();
  f.runtime.decide = () =>
    Object.assign(Promise.reject(new Error('Native decision unavailable')), {
      requestId: 'decision-failed',
    });
  const record = parseRecord({
    schemaVersion: 1,
    kind: 'evidence',
    id: 'e0',
    owner: 'a'.repeat(64),
    caseId: 'case-1',
    createdAt: '2026-10-31T00:00:00Z',
    title: 'Deployment',
    text: 'Deployment completed.',
  });
  const context = await buildContext({
    task: 'Deployment',
    records: [record],
    history: [],
    tools: [],
    selector: f.selector,
    signal,
  });
  assert.equal(context.selection.policy, 'deterministic');
  assert.match(context.selection.fallback!, /Native decision unavailable/);
  assert.deepEqual(context.selection.ids, ['e0']);
  assert.deepEqual(f.events, ['load', 'unload']);
  await f.selector.close();
});
