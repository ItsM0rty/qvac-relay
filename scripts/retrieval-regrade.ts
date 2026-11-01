import { readFile, writeFile } from 'node:fs/promises';
import { regradePassageReport } from '../src/retrieval-regrade.js';
const [input, output] = process.argv.slice(2);
if (!input) throw new Error('Usage: retrieval-regrade input.json [output.json]');
const report = regradePassageReport(JSON.parse(await readFile(input, 'utf8')));
const text = JSON.stringify(report, null, 2) + '\n';
if (output) await writeFile(output, text);
else console.log(text);
