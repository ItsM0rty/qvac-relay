import { readFile } from 'node:fs/promises';
import { regradeReport } from '../src/regrade.js';

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length !== 1) throw new Error('Usage: regrade <report.json>');
  const input: unknown = JSON.parse(await readFile(paths[0]!, 'utf8'));
  console.log(JSON.stringify(regradeReport(input), null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
