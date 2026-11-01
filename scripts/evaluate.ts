import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compareReports, runEvaluation } from '../src/eval.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string', default: 'replay' },
    selector: { type: 'string', default: 'deterministic' },
    trials: { type: 'string', default: '3' },
    output: { type: 'string' },
    compare: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
async function main(): Promise<void> {
  if (values.help) {
    console.log(
      'evaluate --mode live|replay --selector deterministic|laya --trials 3 --output report.json\nevaluate --compare baseline.json current.json [--output comparison.json]\nReplay never invokes native inference. Live uses RELAY_MODEL=0.6b|1.7b.',
    );
    return;
  }
  let report: unknown;
  if (values.compare) {
    if (positionals.length !== 2)
      throw new Error('--compare requires baseline.json and current.json');
    report = compareReports(
      JSON.parse(await readFile(resolve(positionals[0]!), 'utf8')),
      JSON.parse(await readFile(resolve(positionals[1]!), 'utf8')),
    );
  } else {
    if (positionals.length) throw new Error('Unexpected positional arguments');
    if (values.mode !== 'live' && values.mode !== 'replay')
      throw new Error('--mode must be live or replay');
    if (values.selector !== 'deterministic' && values.selector !== 'laya')
      throw new Error('--selector must be deterministic or laya');
    const modelCandidate = process.env.RELAY_MODEL ?? '1.7b';
    if (modelCandidate !== '0.6b' && modelCandidate !== '1.7b')
      throw new Error('RELAY_MODEL must be 0.6b or 1.7b');
    report = await runEvaluation({
      mode: values.mode,
      selector: values.selector,
      trials: Number(values.trials),
      modelCandidate,
    });
  }
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) {
    const path = resolve(values.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
    console.log(JSON.stringify({ written: path }));
  } else console.log(text);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
