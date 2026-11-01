import { LayaSelector, type LayaConfig } from '../src/laya.js';
import { close } from '@qvac/sdk';
import { writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const task = 'What is the maximum permitted vaccine cargo temperature in degrees Celsius?';
const prefix =
  'The shipment manifest lists pallet identifiers, seal checks, operator assignments and routine handling notes. '.repeat(
    4,
  );
const candidates = [
  {
    id: 'answer',
    revision: 'probe-v1',
    title: 'Cargo handling rule',
    text:
      prefix +
      'The maximum permitted vaccine cargo temperature is8 degrees Celsius, not8 degrees Fahrenheit.',
  },
  {
    id: 'background',
    revision: 'probe-v1',
    title: 'Cargo routing',
    text: 'The vaccine cargo travels through the north loading bay. This routing record does not specify temperature limits.',
  },
  {
    id: 'unrelated',
    revision: 'probe-v1',
    title: 'Modem maintenance',
    text: 'The satellite modem queue was replaced after packet jitter.',
  },
];
const configurations: Array<[string, Partial<LayaConfig>]> = [
  ['base', {}],
  ['candidate-reversed', { candidateOrder: 'reverse' }],
  ['options-reversed', { optionOrder: 'reverse' }],
  ['contrast-example', { example: true }],
];
const rows: unknown[] = [];
const started = performance.now();
try {
  for (const [name, config] of configurations) {
    const selector = new LayaSelector(undefined, {
      candidateOrder: 'forward',
      optionOrder: 'forward',
      ...config,
    });
    try {
      const before = performance.now();
      const selection = await selector.select(task, candidates, AbortSignal.timeout(180_000));
      rows.push({ name, config, selection, ms: performance.now() - before });
    } catch (error) {
      rows.push({ name, error: String(error) });
    } finally {
      await selector.close();
    }
  }
  const selector = new LayaSelector();
  try {
    rows.push({
      name: 'crucial-tail-changed',
      selection: await selector.select(
        task,
        [
          {
            ...candidates[0]!,
            revision: 'probe-v2',
            text:
              prefix +
              'The cargo checklist specifies only the number of spare labels. It supplies no allowed temperature.',
          },
          ...candidates.slice(1),
        ],
        AbortSignal.timeout(180_000),
      ),
    });
  } finally {
    await selector.close();
  }
} finally {
  await close();
  await mkdir('artifacts', { recursive: true });
  const report = {
    mode: 'live-qvac-laya-passage-probe',
    purpose:
      'Observed candidate order, option order, separate example and crucial-tail sensitivity. Prediction changes are not proof of correctness.',
    elapsedMs: performance.now() - started,
    task,
    candidates,
    rows,
  };
  await writeFile('artifacts/laya-passage-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
