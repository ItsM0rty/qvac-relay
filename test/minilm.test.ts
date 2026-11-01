import test from 'node:test';
import assert from 'node:assert/strict';
import { MiniLMSelector, type RankLoader, type RankRuntime } from '../src/minilm.js';
import { buildContext, type Candidate } from '../src/context.js';
import type { EvidenceRecord } from '../src/records.js';

const signal = () => new AbortController().signal;
const candidate = (id: string, text = id, revision = 'r1'): Candidate => ({
  id,
  revision,
  title: 'Notes',
  text,
});
const evidence = (id: string, text: string): EvidenceRecord => ({
  kind: 'evidence',
  id,
  title: 'Notes',
  text,
  owner: 'a'.repeat(64),
  caseId: 'case',
  createdAt: '2026-01-01T00:00:00Z',
  schemaVersion: 1,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const result = (scores: number[]) => ({ scores, pairTokens: scores.map(() => 8) });
const code = (expected: string) => (error: unknown) =>
  (error as { code?: string }).code === expected;

test('orders raw logits, including negative values, based on actual query and passage', async () => {
  const seen: string[] = [];
  let disposed = 0;
  const selector = new MiniLMSelector(async () => ({
    score: async (query, passages) => {
      assert.equal(query, 'find beta');
      seen.push(...passages.map((p) => p.text));
      return result(passages.map((p) => (p.text.includes('beta') ? -0.25 : -3)));
    },
    dispose: async () => {
      disposed++;
    },
  }));
  const selection = await selector.select(
    'find beta',
    [candidate('a', 'alpha'), candidate('b', 'beta')],
    signal(),
  );
  assert.deepEqual(seen, ['alpha', 'beta']);
  assert.deepEqual(selection.ids, ['b', 'a']);
  assert.deepEqual((selection.usage as { scores: unknown }).scores, [
    { id: 'a', score: -3 },
    { id: 'b', score: -0.25 },
  ]);
  assert.equal(disposed, 1);
  await selector.close();
});

test('malformed logits and token counts release runtime and visibly fall back without dropping required sources', async () => {
  const malformed = [
    { scores: [NaN], pairTokens: [8] },
    { scores: [], pairTokens: [8] },
    { scores: [1], pairTokens: [513] },
  ];
  for (const bad of malformed) {
    let disposed = 0;
    const selector = new MiniLMSelector(async () => ({
      score: async () => bad,
      dispose: async () => {
        disposed++;
      },
    }));
    const context = await buildContext({
      task: 'matching optional',
      records: [
        evidence('optional', 'matching optional'),
        evidence('required', 'essential source'),
      ],
      history: [],
      tools: [],
      selector,
      requiredIds: ['required'],
      signal: signal(),
    });
    assert.equal(disposed, 1);
    assert.equal(context.selection.policy, 'lexical-v1');
    assert.match(context.selection.fallback!, /malformed/i);
    assert.ok(context.selection.recordIds!.includes('required'));
    await selector.close();
  }
});

test('cache keys include query, revision, and text; oldest entry is evicted at 32', async () => {
  let loads = 0;
  const loader: RankLoader = async () => {
    loads++;
    return { score: async (_q, p) => result(p.map(() => 1)), dispose: async () => {} };
  };
  const selector = new MiniLMSelector(loader);
  const run = (q: string, c = candidate('id', 'first', 'r1')) => selector.select(q, [c], signal());
  await run('q');
  assert.equal(
    (await run('q')).usage && ((await run('q')).usage as { cacheHit: boolean }).cacheHit,
    true,
  );
  await run('q2');
  await run('q', candidate('id', 'first', 'r2'));
  await run('q', candidate('id', 'changed', 'r1'));
  assert.equal(loads, 4);
  for (let i = 0; i < 29; i++) await run(`extra-${i}`);
  assert.equal(loads, 33);
  await run('q');
  assert.equal(loads, 34);
  await selector.close();
});

test('cancellation before loading avoids acquiring a runtime', async () => {
  let loads = 0;
  const selector = new MiniLMSelector(async () => {
    loads++;
    throw new Error('unexpected');
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    selector.select('q', [candidate('a')], controller.signal),
    code('CANCELLED'),
  );
  assert.equal(loads, 0);
  await selector.close();
});

test('cancellation during batch waits for its settlement before unloading', async () => {
  const entered = deferred<void>(),
    batch = deferred<{ scores: number[]; pairTokens: number[] }>();
  let disposed = false,
    settled = false;
  const selector = new MiniLMSelector(async () => ({
    score: async () => {
      entered.resolve();
      return batch.promise;
    },
    dispose: async () => {
      disposed = true;
    },
  }));
  const controller = new AbortController();
  const pending = selector.select('q', [candidate('a')], controller.signal);
  void pending.catch(() => {
    settled = true;
  });
  await entered.promise;
  controller.abort();
  await Promise.resolve();
  assert.equal(disposed, false);
  assert.equal(settled, false);
  batch.resolve(result([1]));
  await assert.rejects(pending, code('CANCELLED'));
  assert.equal(disposed, true);
  await selector.close();
});

test('close cancels active work and waits for batch settlement and unload', async () => {
  const entered = deferred<void>(),
    batch = deferred<{ scores: number[]; pairTokens: number[] }>();
  let disposed = false,
    closed = false;
  const selector = new MiniLMSelector(async () => ({
    score: async () => {
      entered.resolve();
      return batch.promise;
    },
    dispose: async () => {
      disposed = true;
    },
  }));
  const pending = selector.select('q', [candidate('a')], signal());
  const rejection = assert.rejects(pending, code('CANCELLED'));
  await entered.promise;
  const close = selector.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(disposed, false);
  batch.resolve(result([1]));
  await rejection;
  await close;
  assert.equal(disposed, true);
  assert.equal(closed, true);
  await assert.rejects(selector.select('q', [candidate('a')], signal()), /closed/);
});

test('cleanup failure quarantines ranking and fallback until close retries retained resource', async () => {
  let disposals = 0,
    loads = 0;
  const runtime: RankRuntime = {
    score: async (_q, p) => result(p.map(() => 1)),
    dispose: async () => {
      disposals++;
      if (disposals === 1) throw new Error('dispose failed');
    },
  };
  const selector = new MiniLMSelector(async () => {
    loads++;
    return runtime;
  });
  await assert.rejects(
    buildContext({
      task: 'matching',
      records: [evidence('required', 'matching')],
      history: [],
      tools: [],
      selector,
      requiredIds: ['required'],
      signal: signal(),
    }),
    code('MODEL_RELEASE_FAILED'),
  );
  await assert.rejects(
    selector.select('q', [candidate('a')], signal()),
    code('MODEL_RELEASE_FAILED'),
  );
  assert.equal(loads, 1);
  assert.equal(disposals, 1);
  await selector.close();
  assert.equal(disposals, 2);
  await assert.rejects(selector.select('q', [candidate('a')], signal()), /closed/);
});
