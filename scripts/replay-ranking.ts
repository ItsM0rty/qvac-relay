import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { replayRecordedRankings } from '../src/recorded-ranking.js';
const [input, output] = process.argv.slice(2);
if (!input) throw new Error('Usage: replay-ranking input.json [output.json]');
let currentSource = 'unavailable';
try {
  currentSource = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}
const report = await replayRecordedRankings(
  JSON.parse(await readFile(input, 'utf8')),
  currentSource,
);
const text = JSON.stringify(report, null, 2) + '\n';
if (output) await writeFile(output, text);
else console.log(text);
