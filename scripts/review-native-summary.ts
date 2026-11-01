import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: tsx scripts/review-native-summary.ts report-directory');
const plan = JSON.parse(await readFile(join(directory, 'native-plan.json'), 'utf8'));
const labels = [
  ...Array.from({ length: plan.repeatedAttempts }, (_, i) => `repeat-${i + 1}`),
  'variation-atlas',
];
const rows = [];
for (const label of labels) {
  const path = join(directory, label);
  let report: any;
  let missingReport: string | undefined;
  try {
    report = JSON.parse(await readFile(join(path, 'report.json'), 'utf8'));
  } catch (error) {
    missingReport = String(error);
  }
  const events: any[] = [];
  try {
    for (const name of (await readdir(join(path, 'traces'))).filter((n) => n.endsWith('.jsonl')))
      for (const line of (await readFile(join(path, 'traces', name), 'utf8')).trim().split('\n'))
        if (line) events.push(JSON.parse(line));
  } catch (error) {
    if (!missingReport) missingReport = `Trace collection incomplete: ${String(error)}`;
  }
  const starts = events.filter((e) => e.event === 'start');
  const models = events.filter((e) => e.event === 'model');
  const transitions = events.filter((e) => e.event === 'transition');
  const total = (key: string) => models.reduce((sum, e) => sum + (e.stats?.[key] ?? 0), 0);
  const settled = (report?.events ?? []).filter((e: any) =>
    ['initial-run-settled', 'terminal-run-settled'].includes(e.event),
  );
  const configurations = [...new Set(starts.map((e) => JSON.stringify(e.configuration)))];
  const cleanupPassed =
    report?.cleanupPassed === true &&
    settled.length > 0 &&
    settled.every((e: any) => !e.cleanupError && !e.resumptionError);
  const exitCode = Number((await readFile(join(path, 'exit-code.txt'), 'utf8')).trim());
  const configurationMatches =
    report?.sourceCommit === plan.sourceCommit &&
    report?.selector === plan.selector &&
    report?.model === plan.model &&
    configurations.length === 1 &&
    starts.every((e) => e.model === plan.model);
  rows.push({
    attempt: label,
    group: label.startsWith('repeat-') ? 'repeated-default-handoff' : 'new-incident-variation',
    mode: 'live-qvac-two-peer',
    nativeInference: true,
    sourceCommit: report?.sourceCommit ?? plan.sourceCommit,
    model: report?.model ?? null,
    selector: report?.selector ?? null,
    configurations: configurations.map((value) => JSON.parse(value)),
    configurationMatches,
    fixtureId: report?.fixtureId ?? null,
    scenarioSHA256: report?.scenarioSHA256 ?? null,
    passed:
      report?.passed === true &&
      exitCode === 0 &&
      cleanupPassed &&
      configurationMatches &&
      !missingReport,
    exitCode,
    elapsedMs: report?.elapsedMs ?? null,
    calls: Math.max(0, ...transitions.map((e) => e.calls ?? 0)),
    repairs: Math.max(0, ...transitions.map((e) => e.repairs ?? 0)),
    observedModelReplies: models.length,
    cleanupPassed,
    finalCleanup: report?.finalCleanup ?? null,
    settled,
    error: report?.error ?? missingReport ?? null,
    validationFailures: events.filter((e) => ['validation', 'failure'].includes(e.event)),
    usage: {
      scope:
        'Sum of exposed per-call SDK counters; includes loading after peer restart. OS/file caches uncontrolled. No worker memory peak measured.',
      promptTokens: total('promptTokens'),
      generatedTokens: total('generatedTokens'),
      loadMs: total('loadMs'),
      generationMs: total('generationMs'),
    },
    report: `${label}/report.json`,
    traces: `${label}/traces`,
  });
}
const repeated = rows.filter((row) => row.group === 'repeated-default-handoff');
const signatures = new Set(repeated.map((row) => JSON.stringify(row.configurations)));
const summary = {
  mode: 'native-review-diagnostics',
  plan,
  repeatedConfigurationConsistent:
    repeated.length === plan.repeatedAttempts &&
    signatures.size <= 1 &&
    repeated.every((row) => row.configurationMatches),
  rows,
  limitations: [
    'Three repeated runs support this demonstration only, not broad reliability or statistical significance.',
    'Scenario variations are separate from repeated default handoffs. No scripted model responses count as native success.',
    'Fresh peer directories per attempt; same bundled source and dependency install. Model weights reused; per-run model loading remains measured.',
  ],
};
await writeFile(join(directory, 'native-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      summary: join(directory, 'native-summary.json'),
      rows: rows.map(({ attempt, passed, calls, repairs, elapsedMs, cleanupPassed, error }) => ({
        attempt,
        passed,
        calls,
        repairs,
        elapsedMs,
        cleanupPassed,
        error,
      })),
    },
    null,
    2,
  ),
);
if (rows.some((row) => !row.passed) || !summary.repeatedConfigurationConsistent)
  process.exitCode = 1;
