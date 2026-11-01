import { loadMiniLM, MINILM, type RankRuntime } from '../src/minilm.js';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
const query = 'Which database timeout setting did deployment 42 change?';
const texts = [
  'Deployment42 changed the database request timeout from3000ms to100ms. Rollback restored3000ms.',
  'Office inventory contains spare keyboards and chairs.',
  'Deployment17 in the unrelated billing incident used a100ms timeout. It did not affect deployment42.',
  'Deployment42 did not change the timeout. Only when retry is enabled does100ms backoff apply.',
];
const candidates = texts.map((text, i) => ({
  id: `probe-${i}`,
  revision: 'probe-v1',
  title: 'Diagnostic passage',
  text,
}));
const report: Record<string, unknown> = {
  mode: 'real-minilm-cpu-probe',
  configuration: MINILM,
  offlineOnly: true,
  query,
  texts,
};
let runtime: RankRuntime | undefined;
const start = performance.now(),
  rss = process.memoryUsage().rss;
try {
  runtime = await loadMiniLM();
  report.loadMs = performance.now() - start;
  const cold = performance.now();
  const first = await runtime.score(query, candidates);
  report.cold = { ...first, ms: performance.now() - cold };
  const warm = performance.now();
  report.warm = { ...(await runtime.score(query, candidates)), ms: performance.now() - warm };
  const reverse = await runtime.score(query, [...candidates].reverse());
  if (
    first.scores.some((x) => !Number.isFinite(x)) ||
    new Set(first.scores.map((x) => x.toFixed(5))).size < 3 ||
    first.scores[0]! <= first.scores[1]!
  )
    throw new Error('Constant or passage-insensitive scores');
  if (reverse.scores.some((x, i) => Math.abs(x - first.scores.at(-1 - i)!) > 0.001))
    throw new Error('Candidate order changed independent logits');
  report.orderInvariant = true;
  let overflow = false;
  try {
    await runtime.score(query, [{ ...candidates[0]!, text: 'tailguard '.repeat(1000) }]);
  } catch (error) {
    overflow = error instanceof Error && error.message.includes('512');
  }
  if (!overflow) throw new Error('Combined tokenizer limit not enforced');
  report.overflowRejectedWithoutTruncation = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    await runtime?.dispose();
    report.cleanup = 'disposed';
  } catch (error) {
    report.cleanup = String(error);
    report.passed = false;
    process.exitCode = 1;
  }
  report.totalMs = performance.now() - start;
  report.memory = {
    scope:
      'Node process RSS before/after includes local ONNX native allocations; not model-only or peak',
    before: rss,
    after: process.memoryUsage().rss,
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/minilm-native-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
