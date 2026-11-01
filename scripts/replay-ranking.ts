import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { replayRecordedRankings } from '../src/recorded-ranking.js';
const args = process.argv.slice(2);
const flag = args.indexOf('--source-commit');
let assertedScoreSource: string | undefined;
if (flag >= 0) {
  assertedScoreSource = args[flag + 1];
  if (!assertedScoreSource || assertedScoreSource.startsWith('--'))
    throw new Error('Missing --source-commit value');
  args.splice(flag, 2);
}
const [input, output] = args;
if (!input || args.length > 2)
  throw new Error('Usage: replay-ranking input.json [output.json] [--source-commit COMMIT]');
let currentSource = 'unavailable';
try {
  currentSource = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}
const report = await replayRecordedRankings(
  JSON.parse(await readFile(input, 'utf8')),
  currentSource,
  assertedScoreSource,
);
const text = JSON.stringify(report, null, 2) + '\n';
if (output) await writeFile(output, text);
else console.log(text);
