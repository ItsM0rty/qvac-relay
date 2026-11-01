import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { replayRecordedRankings } from '../src/recorded-ranking.js';
import { fixtureRecords, runRetrievalEvaluation } from '../src/retrieval-eval.js';
import { RETRIEVAL_CASES } from '../src/retrieval-cases.js';
import { lexicalRetrieve, projectPassages } from '../src/retrieval.js';
import { MINILM } from '../src/minilm.js';

const sourceAssertion = '57fc4d68cdc53dba9bd9c7eec83c0b983c9fe4f4';
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
  // Synthetic rows exercise behavior; only historical configuration comes from the raw artifact.
  const historical = JSON.parse(
    await readFile('artifacts/passage-retrieval-raw-57fc4d6.json', 'utf8'),
  );
  report.configuration = historical.configuration;
  report.configurationHash = historical.configurationHash;
  report.sourceCommit = 'unavailable';
  return { report, pool };
}

test('replays frozen logits/classes and cached trial with current context, no native inference or input mutation', async () => {
  const { report, pool } = await captured(),
    before = structuredClone(report);
  const result = await replayRecordedRankings(report, 'current-test-source', sourceAssertion);
  assert.deepEqual(report, before);
  assert.equal(result.mode, 'recorded-ranking-budget-replay');
  assert.equal(result.nativeInference, false);
  assert.equal(result.currentSourceCommit, 'current-test-source');
  assert.equal(result.currentContextBudget, 7000);
  assert.equal(result.rawReportSourceCommit, 'unavailable');
  assert.equal(result.assertedScoreSourceCommit, sourceAssertion);
  assert.match(result.scoreSourceBasis, /Caller asserts/);
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
  await assert.rejects(
    replayRecordedRankings(broken, 'current', sourceAssertion),
    /scores|candidate/i,
  );
  broken = structuredClone(report);
  mini().usage.scores[0]!.id = 'unknown';
  await assert.rejects(
    replayRecordedRankings(broken, 'current', sourceAssertion),
    /scores|candidate/i,
  );
  broken = structuredClone(report);
  mini().usage.model = {};
  await assert.rejects(replayRecordedRankings(broken, 'current', sourceAssertion), /model/i);
  broken = structuredClone(report);
  const laya = broken.rows.find((r) => r.selector === 'laya')!.selection as {
    usage: { classes: Record<string, string> };
  };
  laya.usage.classes[Object.keys(laya.usage.classes)[0]!] = 'unknown';
  await assert.rejects(replayRecordedRankings(broken, 'current', sourceAssertion), /classes/i);
  broken = structuredClone(report);
  broken.configuration.fixtureVersion = 'unknown';
  broken.configurationHash = createHash('sha256')
    .update(JSON.stringify(broken.configuration))
    .digest('hex');
  await assert.rejects(
    replayRecordedRankings(broken, 'current', sourceAssertion),
    /configuration|fixture/i,
  );
});

test('requires explicit provenance for missing source and rejects other historical configurations', async () => {
  const { report } = await captured();
  await assert.rejects(replayRecordedRankings(report, 'current'), /assertion/i);
  await assert.rejects(replayRecordedRankings(report, 'current', 'wrong'), /assertion|source/i);
  const changed = structuredClone(report);
  changed.configuration.contextBudget++;
  changed.configurationHash = createHash('sha256')
    .update(JSON.stringify(changed.configuration))
    .digest('hex');
  await assert.rejects(
    replayRecordedRankings(changed, 'current', sourceAssertion),
    /historical configuration/i,
  );
});
