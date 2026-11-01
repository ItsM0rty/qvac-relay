import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent.js';
import { validateHistory } from '../src/context.js';
import { lexicalRetrieve, projectPassages } from '../src/retrieval.js';
import { RelayStore } from '../src/store.js';
import type { Message, Model, ModelReply } from '../src/qvac.js';

const output = process.argv[2];
if (!output) throw new Error('Usage: node --import tsx scripts/review-diagnostics.ts output.json');
const freeze = JSON.parse(await readFile('data/review-freeze-v1.json', 'utf8'));
for (const [file, expected] of Object.entries(freeze.files))
  assert.equal(
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    expected,
    `Frozen case changed: ${file}`,
  );
interface Incident {
  id: string;
  kind: string;
  task: string;
  evidence: Array<{
    id: string;
    title: string;
    text?: string;
    prefix?: string;
    repeat?: number;
    tail?: string;
  }>;
  expected: Array<{ id: string; quote: string }>;
  informationNeed?: { id: string; question: string };
}
const cases: Incident[] = JSON.parse(
  await readFile('data/review-cases-v1.json', 'utf8'),
).cases.filter((entry: { kind: string }) => entry.kind !== 'peer-handoff');
function tool<T>(history: Message[], name: string): T {
  validateHistory(history);
  const value = history.findLast((message) => message.role === 'tool' && message.toolName === name);
  assert.ok(value, `No actual ${name} result`);
  return JSON.parse(value.content) as T;
}
const rows = [];
for (const incident of cases) {
  const directory = await mkdtemp(join(tmpdir(), 'relay-review-'));
  const store = await RelayStore.open(directory);
  const started = performance.now();
  const actions: string[] = [];
  let turn = 0,
    selectedOffset: number | undefined,
    selectedId = '',
    initialLexical: string[] = [];
  try {
    const base = {
      schemaVersion: 1 as const,
      owner: store.owner,
      caseId: incident.id,
      createdAt: '2026-11-01T00:00:00.000Z',
    };
    await store.put({
      ...base,
      kind: 'case',
      id: `${incident.id}-case`,
      title: incident.id,
      task: incident.task,
      ...(incident.informationNeed ? { informationNeeds: [incident.informationNeed] } : {}),
    });
    for (const entry of incident.evidence)
      await store.put({
        ...base,
        kind: 'evidence',
        id: entry.id,
        title: entry.title,
        text: entry.text ?? entry.prefix!.repeat(entry.repeat!) + entry.tail!,
      });
    const initial = await store.list(incident.id);
    const passages = projectPassages(initial);
    initialLexical = lexicalRetrieve(incident.task, passages).map((item) => item.passage.id);
    const initialCovered = incident.expected.filter((expected) =>
      passages.some(
        (p) =>
          initialLexical.includes(p.id) &&
          p.sourceId === expected.id &&
          p.text.includes(expected.quote),
      ),
    ).length;
    const model: Model = {
      name: 'controlled-review-fixture-not-live',
      close: async () => {},
      complete: async (history): Promise<ModelReply> => {
        validateHistory(history);
        const call = (name: string, args: unknown): ModelReply => {
          actions.push(name);
          return {
            content: '',
            calls: [{ id: `review-${++turn}`, name, arguments: args }],
            toolErrors: [],
            stopReason: 'eos',
          };
        };
        if (incident.kind === 'no-relevant-optional') {
          if (turn === 0) {
            const state = history
              .filter((m) => m.role === 'user')
              .map((m) => JSON.parse(m.content))
              .find((value) => value.evidenceIndex);
            assert.deepEqual(state.evidenceIndex, []);
            return call('request_information', {
              needId: incident.informationNeed!.id,
              question: incident.informationNeed!.question,
            });
          }
          const request = tool<{ status: string }>(history, 'request_information');
          assert.equal(request.status, 'awaiting-response');
          actions.push('ordinary-waiting-completion');
          turn++;
          return {
            content: 'The broker deadline is unestablished. Waiting for the requested setting.',
            calls: [],
            toolErrors: [],
            stopReason: 'eos',
          };
        }
        if (turn === 0)
          return call('find_evidence', {
            query: incident.kind === 'paraphrase' ? incident.task : 'invalidates version marker',
          });
        if (turn === 1 && incident.kind === 'paraphrase') {
          assert.deepEqual(
            tool<unknown[]>(history, 'find_evidence'),
            [],
            'The frozen paraphrase case must expose the lexical ceiling',
          );
          return call('find_evidence', { query: '', limit: 12 });
        }
        if (!selectedId) {
          const found = tool<
            Array<{ id: string; title: string; offset: number; nextSkip?: number | null }>
          >(history, 'find_evidence');
          const relevant = found.find((item) =>
            incident.kind === 'paraphrase'
              ? item.title.includes('Preview rendering')
              : item.id === 'tile-runbook',
          );
          assert.ok(relevant, 'Navigation did not expose the relevant original record');
          selectedId = relevant.id;
          selectedOffset = relevant.offset;
          return call('read_record', { id: selectedId, offset: selectedOffset });
        }
        const page = tool<{ id: string; text: string; offset: number; end: number }>(
          history,
          'read_record',
        );
        assert.equal(page.id, selectedId);
        const original = initial.find(
          (record) => record.kind === 'evidence' && record.id === page.id,
        )!;
        assert.ok(original.kind === 'evidence');
        assert.equal(page.text, original.text.slice(page.offset, page.end));
        for (const expected of incident.expected)
          assert.ok(
            page.text.includes(expected.quote),
            'Actual delivered page omitted a graded span',
          );
        return call('save_brief', {
          quotes: { [page.id]: page.text.trim() },
          uncertainty: [],
          missing: [],
        });
      },
    };
    const checkpoint = await new Agent(store, model).run(incident.id, {
      maxCalls: 8,
      maxRepairs: 1,
    });
    const records = await store.list(incident.id);
    const briefs = records.filter((record) => record.kind === 'brief');
    const covered = incident.expected.filter((expected) =>
      briefs.some((brief) =>
        brief.facts.some((fact) =>
          fact.sources.some(
            (source) => source.id === expected.id && source.quote.includes(expected.quote),
          ),
        ),
      ),
    ).length;
    const requests = records.filter((record) => record.kind === 'request');
    const safelyUnresolved =
      incident.kind === 'no-relevant-optional' &&
      checkpoint.status === 'pending' &&
      requests.length === 1 &&
      briefs.length === 0;
    const passed =
      incident.kind === 'no-relevant-optional'
        ? safelyUnresolved
        : checkpoint.status === 'completed' && covered === incident.expected.length;
    const events = (await readFile(join(directory, 'traces', `${checkpoint.runId}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    rows.push({
      caseId: incident.id,
      kind: incident.kind,
      execution: 'controlled-agent-real-store',
      nativeInference: false,
      model: model.name,
      selector: 'deterministic',
      passed,
      status: checkpoint.status,
      reason: checkpoint.reason ?? null,
      calls: checkpoint.calls,
      repairs: checkpoint.repairs,
      latencyMs: performance.now() - started,
      actions,
      initialLexicalPassages: initialLexical,
      initialSpanCoverage: incident.expected.length
        ? initialCovered / incident.expected.length
        : null,
      coveredSpans: covered,
      expectedSpans: incident.expected.length,
      readOffset: selectedOffset ?? null,
      requests: requests.length,
      briefs: briefs.length,
      safelyUnresolved,
      trace: events,
    });
  } catch (error) {
    rows.push({
      caseId: incident.id,
      kind: incident.kind,
      execution: 'controlled-agent-real-store',
      nativeInference: false,
      passed: false,
      reason: error instanceof Error ? error.message : String(error),
      actions,
      initialLexicalPassages: initialLexical,
      latencyMs: performance.now() - started,
    });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const report = {
  mode: 'frozen-review-controlled-diagnostics',
  sourceCommit:
    process.env.RELAY_SOURCE_COMMIT ??
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceCommitBasis: process.env.RELAY_SOURCE_COMMIT ? 'caller archive manifest' : 'git checkout',
  fixtureFreeze: freeze,
  model: 'controlled-review-fixture-not-live',
  selector: 'deterministic',
  trialsPerCase: 1,
  nativeInference: false,
  rows,
  limits: [
    'Scripted fixtures assert actual protocol and tool results, not model reasoning or paraphrase understanding.',
    'Empty-query navigation recovers an omitted candidate in the controlled case; native recovery is unverified.',
    'Expected spans are diagnostic grader checks, not semantic truth.',
  ],
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      output,
      rows: rows.map((row) => ({
        id: row.caseId,
        passed: row.passed,
        status: 'status' in row ? row.status : undefined,
        reason: row.reason,
      })),
    },
    null,
    2,
  ),
);
