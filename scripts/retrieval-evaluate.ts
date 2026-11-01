import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runRetrievalEvaluation } from '../src/retrieval-eval.js';
import type { SelectorMode } from '../src/selectors.js';
const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'retrieval' },
    selectors: { type: 'string', default: 'deterministic,minilm,laya' },
    trials: { type: 'string', default: '2' },
    split: { type: 'string', default: 'all' },
    cases: { type: 'string' },
    output: { type: 'string' },
  },
});
if (values.mode !== 'retrieval' && values.mode !== 'agent')
  throw new Error('mode must be retrieval or agent');
if (!['all', 'development', 'heldout'].includes(values.split)) throw new Error('Invalid split');
const report = await runRetrievalEvaluation({
  mode: values.mode,
  trials: Number(values.trials),
  selectors: values.selectors.split(',') as SelectorMode[],
  split: values.split as 'all' | 'development' | 'heldout',
  caseIds: values.cases?.split(','),
});
const text = JSON.stringify(report, null, 2) + '\n';
if (values.output) {
  const path = resolve(values.output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  console.log(JSON.stringify({ written: path, rows: report.rows.length }));
} else console.log(text);
