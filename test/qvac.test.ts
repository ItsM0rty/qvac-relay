import assert from 'node:assert/strict';
import test from 'node:test';
import { QvacModel, type QvacRuntime } from '../src/qvac.js';
import { RelayError } from '../src/policy.js';

const signal = new AbortController().signal;
function deferred<T>(requestId: string) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = Object.assign(
    new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    { requestId },
  );
  return { promise, resolve, reject };
}
function fixture() {
  const loads: string[] = [];
  const unloads: string[] = [];
  const cancellations: string[] = [];
  let completions = 0;
  let closes = 0;
  const runtime: QvacRuntime = {
    load: () => {
      const id = `model-${loads.length + 1}`;
      loads.push(id);
      return Object.assign(Promise.resolve(id), { requestId: `load-${id}` });
    },
    completion: () => {
      completions++;
      return {
        requestId: `turn-${completions}`,
        events: (async function* () {})(),
        final: Promise.resolve({ contentText: 'done', toolCalls: [], raw: { fullText: 'done' } }),
      };
    },
    unload: async (id) => {
      unloads.push(id);
    },
    cancel: async (id) => {
      cancellations.push(id);
    },
    close: async () => {
      closes++;
    },
  };
  const model = new QvacModel('0.6b', 'required', runtime);
  return {
    model,
    runtime,
    loads,
    unloads,
    cancellations,
    completions: () => completions,
    closes: () => closes,
  };
}
function infrastructure(code: string, cause?: unknown) {
  return (error: unknown) =>
    error instanceof RelayError &&
    error.kind === 'infrastructure' &&
    error.code === code &&
    (cause === undefined || error.cause === cause);
}

test('failed unload retains its resource and quarantines generation until cleanup retry succeeds', async () => {
  const f = fixture();
  const cause = new Error('native unload failed');
  let fail = true;
  f.runtime.unload = async (id) => {
    f.unloads.push(id);
    if (fail) throw cause;
  };
  await f.model.complete([], [], signal);
  await assert.rejects(f.model.release(), infrastructure('MODEL_RELEASE_FAILED', cause));
  await assert.rejects(f.model.complete([], [], signal), infrastructure('MODEL_CLEANUP_REQUIRED'));
  assert.equal(f.completions(), 1);
  assert.deepEqual(f.loads, ['model-1']);
  fail = false;
  await f.model.release();
  assert.deepEqual(f.unloads, ['model-1', 'model-1']);
  await f.model.complete([], [], signal);
  assert.deepEqual(f.loads, ['model-1', 'model-2']);
  await f.model.close();
  assert.deepEqual(f.unloads, ['model-1', 'model-1', 'model-2']);
});

test('concurrent release callers share cleanup and generation cannot overlap it', async () => {
  const f = fixture();
  const unloading = deferred<void>('unloading');
  f.runtime.unload = async (id) => {
    f.unloads.push(id);
    await unloading.promise;
  };
  await f.model.complete([], [], signal);
  const first = f.model.release();
  const second = f.model.release();
  assert.equal(first, second);
  await assert.rejects(f.model.complete([], [], signal), infrastructure('MODEL_RELEASING'));
  assert.deepEqual(f.unloads, ['model-1']);
  unloading.resolve();
  await first;
  await f.model.close();
  assert.equal(f.closes(), 1);
});

test('shutdown retries quarantined resource and closes SDK despite persistent unload failure', async () => {
  const f = fixture();
  const cause = new Error('persistent native unload failure');
  f.runtime.unload = async (id) => {
    f.unloads.push(id);
    throw cause;
  };
  await f.model.complete([], [], signal);
  await assert.rejects(f.model.release(), infrastructure('MODEL_RELEASE_FAILED', cause));
  const closing = f.model.close();
  assert.equal(f.model.close(), closing);
  await assert.rejects(closing, infrastructure('MODEL_CLOSE_FAILED', cause));
  assert.deepEqual(f.unloads, ['model-1', 'model-1']);
  assert.equal(f.closes(), 1);
  await assert.rejects(f.model.complete([], [], signal), /MODEL_CLOSED/);
});

test('shutdown reports both unload and SDK-close failures without dropping either cause', async () => {
  const f = fixture();
  const unloadFailure = new Error('unload failed');
  const closeFailure = new Error('SDK close failed');
  f.runtime.unload = async () => {
    throw unloadFailure;
  };
  f.runtime.close = async () => {
    throw closeFailure;
  };
  await f.model.complete([], [], signal);
  await assert.rejects(f.model.close(), (error: unknown) => {
    assert.ok(error instanceof RelayError);
    assert.equal(error.code, 'MODEL_CLOSE_FAILED');
    assert.equal(error.kind, 'infrastructure');
    assert.ok(error.cause instanceof AggregateError);
    assert.deepEqual(error.cause.errors, [unloadFailure, closeFailure]);
    return true;
  });
});

test('close waits for native acquisition and cancellation acknowledgement before releasing a raced model', async () => {
  const f = fixture();
  const loading = deferred<string>('loading');
  const cancellation = deferred<void>('cancellation');
  f.runtime.load = () => loading.promise;
  f.runtime.cancel = async (id) => {
    f.cancellations.push(id);
    await cancellation.promise;
  };
  const completing = f.model.complete([], [], signal);
  const rejected = assert.rejects(completing, { name: 'AbortError' });
  const closing = f.model.close();
  assert.deepEqual(f.cancellations, ['loading']);
  loading.resolve('raced-model');
  await Promise.resolve();
  assert.deepEqual(f.unloads, []);
  assert.equal(f.closes(), 0);
  cancellation.resolve();
  await Promise.all([rejected, closing]);
  assert.deepEqual(f.unloads, ['raced-model']);
  assert.equal(f.completions(), 0);
  assert.equal(f.closes(), 1);
});
