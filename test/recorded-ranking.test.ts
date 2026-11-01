import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayRecordedRankings } from '../src/recorded-ranking.js';
import { fixtureRecords, runRetrievalEvaluation } from '../src/retrieval-eval.js';
import { RETRIEVAL_CASES } from '../src/retrieval-cases.js';
import { lexicalRetrieve, projectPassages } from '../src/retrieval.js';
import { MINILM } from '../src/minilm.js';

async function captured() {
  const report = await runRetrievalEvaluation({
    mode: 'retrieval',
    selectors: ['deterministic'],
    trials: 1,
    split: 'development',
    caseIds: ['dev-checkout-2'],
  });
  const entry = RETRIEVAL_CASES.find((c) => c.id === 'dev-checkout-2')!;
  const pool = lexicalRetrieve(entry.task, projectPassages(fixtureRecords(entry)), 12).map(
    (x) => x.passage.id,
  );
  assert.ok(pool.length);
  const layaPool = lexicalRetrieve(
    entry.task,
    pool.map((id) => projectPassages(fixtureRecords(entry)).find((p) => p.id === id)!),
    12,
  ).map((x) => x.passage.id);
  const original = structuredClone(report.rows[0]!);
  report.options.selectors = ['deterministic', 'minilm', 'laya'];
  report.options.trials = 2;
  const scores = pool.map((id, i) => ({ id, score: i - pool.length }));
  report.rows = [1, 2].flatMap((trial) => [
    { ...structuredClone(original), trial },
    {
      ...structuredClone(original),
      trial,
      selector: 'minilm' as const,
      selection: {
        ids: [...pool],
        policy: 'minilm-int8-v1',
        usage:
          trial === 1
            ? { model: MINILM, cacheHit: false, scores }
            : { model: MINILM, cacheHit: true },
      },
    },
    {
      ...structuredClone(original),
      trial,
      selector: 'laya' as const,
      selection: {
        ids: [...pool],
        policy: 'laya-passage-v2',
        usage: {
          candidateIds: layaPool,
          classes: Object.fromEntries(
            layaPool.map((id, i) => [id, i === 0 ? 'background' : 'directly_relevant']),
          ),
        },
      },
    },
  ]);
  report.sourceCommit = 'unavailable';
  return { report, pool };
}

test('replays frozen logits/classes and cached trial with current context, no native inference or input mutation', async () => {
  const { report, pool } = await captured(),
    before = structuredClone(report);
  const result = await replayRecordedRankings(report, 'current-test-source');
  assert.deepEqual(report, before);
  assert.equal(result.mode, 'recorded-ranking-budget-replay');
  assert.equal(result.nativeInference, false);
  assert.equal(result.currentSourceCommit, 'current-test-source');
  assert.equal(result.currentContextBudget, 7000);
  assert.match(result.queryIdentityBasis, /did not capture/);
  const mini = result.rows.find((r) => r.selector === 'minilm' && r.trial === 1)!;
  assert.deepEqual(mini.selection.ids, [...pool].reverse().slice(0, mini.selection.ids.length));
  assert.equal(
    result.rows.find((r) => r.selector === 'minilm' && r.trial === 2)!.rankingSource,
    'recorded-native-scores-reused-for-cache',
  );
  assert.equal(
    result.rows.find((r) => r.selector === 'laya' && r.trial === 1)!.rankingSource,
    'recorded-native-classes',
  );
  assert.ok(
    result.rows.every(
      (r) => r.replaySucceeded && !Object.hasOwn(r, 'coldMs') && !Object.hasOwn(r, 'warmMs'),
    ),
  );
});

test('rejects malformed or incompatible recorded model, candidate pool, scores and classes', async () => {
  const { report } = await captured();
  let broken = structuredClone(report);
  const mini = () =>
    broken.rows.find((r) => r.selector === 'minilm' && r.trial === 1)!.selection as {
      usage: { scores: Array<{ id: string; score: number }>; model: unknown };
    };
  mini().usage.scores[0]!.score = NaN;
  await assert.rejects(replayRecordedRankings(broken, 'current'), /scores|candidate/i);
  broken = structuredClone(report);
  mini().usage.scores[0]!.id = 'unknown';
  await assert.rejects(replayRecordedRankings(broken, 'current'), /scores|candidate/i);
  broken = structuredClone(report);
  mini().usage.model = {};
  await assert.rejects(replayRecordedRankings(broken, 'current'), /model/i);
  broken = structuredClone(report);
  const laya = broken.rows.find((r) => r.selector === 'laya')!.selection as {
    usage: { classes: Record<string, string> };
  };
  laya.usage.classes[Object.keys(laya.usage.classes)[0]!] = 'unknown';
  await assert.rejects(replayRecordedRankings(broken, 'current'), /classes/i);
  broken = structuredClone(report);
  broken.configuration.fixtureVersion = 'unknown';
  broken.configurationHash = createHash('sha256')
    .update(JSON.stringify(broken.configuration))
    .digest('hex');
  await assert.rejects(replayRecordedRankings(broken, 'current'), /fixture/i);
});
