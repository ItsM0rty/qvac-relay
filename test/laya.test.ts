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
function result(choice = 'directly_relevant') {
  return {
    model: 'laya-test-boundary',
    answers: {
      relevance: {
        type: 'choice',
        choice,
        probabilities: { directly_relevant: 0.5, background: 0.3, unrelated: 0.2 },
        confidence: 0.5,
        answerConfidence: 0.5,
        action: { actProbability: 0 },
      },
    },
    usage: {
      inputTokens: 100,
      outputTokens: 1,
      stateTokens: 90,
      stateTokensDropped: 0,
      truncated: false,
      truncatedQuestions: [] as string[],
    },
  };
}
function fixture(output?: unknown) {
  const events: string[] = [];
  const inputs: LayaInput[] = [];
  const runtime: LayaRuntime = {
    load: () => {
      events.push('load');
      return pending('model-1', 'load-1');
    },
    decide: (id, request) => {
      assert.equal(id, 'model-1');
      events.push('decide');
      inputs.push(request);
      return pending(
        output === undefined ? request.states.map(() => result()) : output,
        'decision-1',
      );
    },
    unload: async (id) => {
      assert.equal(id, 'model-1');
      events.push('unload');
    },
    cancel: async (id) => {
      events.push(`cancel:${id}`);
    },
  };
  return {
    selector: new LayaSelector(async () => runtime),
    runtime,
    events,
    input: () => inputs[0],
    inputs,
  };
}

test('Laya classifies complete passages in bounded batches and unloads', async () => {
  const f = fixture();
  const selection = await f.selector.select('Deployment', candidates, signal);
  assert.deepEqual(
    selection.ids,
    candidates.map((c) => c.id),
  );
  assert.equal(selection.policy, 'laya-passage-v2');
  assert.deepEqual(f.events, ['load', 'decide', 'decide', 'unload']);
  assert.deepEqual(
    f.inputs.map((input) => input.states.length),
    [6, 2],
  );
  assert.equal(f.inputs[0]!.states[0]!.passage.text, candidates[0]!.text);
  assert.equal(f.inputs[0]!.maxLen, 1024);
  assert.equal(f.inputs[0]!.headMaxLen, 256);
  assert.equal(Object.keys(f.inputs[0]!.questions).join(), 'relevance');
  await f.selector.close();
});

test('reversed batches and options map results back by passage and rank by class', async () => {
  const f = fixture();
  f.runtime.decide = (_id, input) => {
    f.events.push('decide');
    f.inputs.push(input);
    return pending(
      input.states.map(({ passage }) =>
        result(passage.text.includes('critical tail') ? 'directly_relevant' : 'background'),
      ),
      'decision',
    );
  };
  const cs = [
    { ...candidates[0]!, text: 'Deployment background' },
    { ...candidates[1]!, text: `Deployment ${'x'.repeat(700)} critical tail` },
    { ...candidates[2]!, text: 'Deployment context' },
  ];
  const normal = await f.selector.select('Deployment', cs, signal);
  const reverse = new LayaSelector(async () => f.runtime, {
    candidateOrder: 'reverse',
    optionOrder: 'reverse',
  });
  const reversed = await reverse.select('Deployment', cs, signal);
  assert.deepEqual(reversed.ids, normal.ids);
  assert.deepEqual(reversed.ids, ['e1', 'e0', 'e2']);
  assert.deepEqual(f.inputs.at(-1)!.questions.relevance!.optionOrder, [2, 1, 0]);
  assert.ok(f.inputs.at(-1)!.states.some((state) => state.passage.text.endsWith('critical tail')));
  const changed = cs.map((c) => ({ ...c, text: c.text.replace('critical tail', 'ordinary tail') }));
  assert.deepEqual((await reverse.select('Deployment', changed, signal)).ids, ['e0', 'e2', 'e1']);
});

test('empty, pre-cancelled, oversized and duplicate inputs avoid native model loading', async () => {
  const f = fixture();
  assert.deepEqual((await f.selector.select('Task', [], signal)).ids, []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.selector.select('Deployment', candidates, controller.signal), {
    name: 'AbortError',
  });
  await assert.rejects(
    f.selector.select('Deployment', [candidates[0]!, candidates[0]!], signal),
    /duplicate candidate/,
  );
  await assert.rejects(f.selector.select('x'.repeat(1501), candidates, signal), /LAYA_INPUT/);
  await assert.rejects(
    f.selector.select('Deployment', [{ ...candidates[0]!, text: 'x'.repeat(901) }], signal),
    /LAYA_INPUT/,
  );
  assert.deepEqual(f.events, []);
});

test('malformed, missing, unknown and truncated batch results reject after unload', async () => {
  const truncated = result();
  truncated.usage.truncated = true;
  const dropped = result();
  dropped.usage.stateTokensDropped = 1;
  const questions = result();
  questions.usage.truncatedQuestions = ['relevance'];
  const badChoice = result('invented');
  const badProbabilities = result();
  badProbabilities.answers.relevance.probabilities.background = Number.NaN;
  for (const output of [
    null,
    {},
    [],
    [result()],
    [truncated, result(), result(), result(), result(), result()],
    [dropped, result(), result(), result(), result(), result()],
    [questions, result(), result(), result(), result(), result()],
    [badChoice, result(), result(), result(), result(), result()],
    [badProbabilities, result(), result(), result(), result(), result()],
  ]) {
    const f = fixture(output);
    await assert.rejects(f.selector.select('Deployment', candidates, signal), /LAYA_/);
    assert.equal(f.events.at(-1), 'unload');
  }
});

test('buildContext visibly falls back on malformed native output and protects required evidence', async () => {
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
  assert.equal(broken.selection.policy, 'lexical-v1');
  assert.match(broken.selection.fallback!, /LAYA_OUTPUT/);
  assert.ok(broken.selection.ids.includes('e1'));
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
  decision.resolve(candidates.slice(0, 6).map(() => result()));
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
  assert.deepEqual(f.events, ['load', 'decide', 'decide', 'unload']);
  await assert.rejects(f.selector.close(), isCleanupFailure);
  assert.deepEqual(f.events, ['load', 'decide', 'decide', 'unload', 'unload']);
  fails = false;
  await f.selector.close();
  assert.deepEqual(f.events, ['load', 'decide', 'decide', 'unload', 'unload', 'unload']);
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
  const f = fixture([result()]);
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
  assert.equal(context.selection.policy, 'lexical-v1');
  assert.match(context.selection.fallback!, /Native decision unavailable/);
  assert.deepEqual(context.selection.ids, ['e0']);
  assert.deepEqual(f.events, ['load', 'unload']);
  await f.selector.close();
});
