import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idSchema } from '../src/records.js';
import {
  DemoProgress,
  waitForPeerReady,
  stopChild,
  resumptionSettled,
} from '../src/demo-progress.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { latestCheckpoint } from '../src/agent.js';
import type { RelayRecord } from '../src/records.js';
import { controlPost } from '../src/control-client.js';

// Live-only demonstration. Each child opens only its own persistent directory.
// The coordinator reads control metadata, never peer data or core files.
const directory = resolve(process.argv[2] ?? `.relay/demo-${Date.now()}`);
await mkdir(directory, { recursive: true });
const events: unknown[] = [];
const cleanup: Array<{
  peer: string;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
}> = [];
const progress = new DemoProgress((line) => console.error(line));
let sourceCommit = process.env.RELAY_SOURCE_COMMIT ?? 'unavailable';
if (sourceCommit !== 'unavailable' && !/^[a-f0-9]{40}$/.test(sourceCommit))
  throw new Error('Invalid RELAY_SOURCE_COMMIT');
let sourceCommitBasis = sourceCommit === 'unavailable' ? 'unavailable' : 'caller archive manifest';
try {
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  sourceCommitBasis = 'git checkout';
} catch {}
const evidenceSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(16000),
});
const scenarioSchema = z
  .strictObject({
    caseId: idSchema,
    title: z.string().trim().min(1).max(500),
    task: z.string().trim().min(1).max(8000),
    evidence: z.array(evidenceSchema).min(1).max(32),
    informationNeeds: z
      .array(z.strictObject({ id: idSchema, question: z.string().trim().min(1).max(500) }))
      .length(1),
    contribution: evidenceSchema.extend({ needId: idSchema.optional() }),
    requiredQuotes: z
      .array(z.strictObject({ id: idSchema, quote: z.string().min(1).max(1000) }))
      .optional(),
    fixtureId: z.string().min(1).max(160).optional(),
    longEvidence: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const ids = [...v.evidence.map((e) => e.id), v.contribution.id];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Evidence IDs must be unique' });
    if (v.contribution.needId && v.contribution.needId !== v.informationNeeds[0]!.id)
      ctx.addIssue({ code: 'custom', message: 'Contribution needId must match the declared need' });
    if (v.requiredQuotes?.some((q) => !ids.includes(q.id)))
      ctx.addIssue({ code: 'custom', message: 'Required quote source must be scenario evidence' });
  });
const scenarioPath = process.env.RELAY_DEMO_SCENARIO_FILE;
const scenarioRaw = scenarioPath
  ? JSON.parse(await readFile(resolve(scenarioPath), 'utf8'))
  : undefined;
const scenario = scenarioPath ? scenarioSchema.parse(scenarioRaw) : undefined;
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const scenarioSHA256 = scenarioPath
  ? createHash('sha256')
      .update(JSON.stringify(canonical(scenarioRaw)))
      .digest('hex')
  : null;

interface Peer {
  child: ChildProcess;
  owner: string;
  port: number;
  control: { port: number; token: string };
  dir: string;
  output: string;
}
async function until<T>(fn: () => Promise<T | undefined>, timeout = 30_000): Promise<T> {
  const end = performance.now() + timeout;
  let last: unknown;
  while (performance.now() < end) {
    try {
      const value = await fn();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Condition timed out: ${String(last ?? 'not reached')}`);
}
async function start(name: string): Promise<Peer> {
  const dir = join(directory, name);
  await mkdir(dir, { recursive: true });
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve('src/cli.ts'), 'peer', '--dir', dir],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RELAY_SELECTOR: process.env.RELAY_SELECTOR ?? 'deterministic' },
    },
  );
  const peer: Peer = {
    child,
    owner: '',
    port: 0,
    control: { port: 0, token: '' },
    dir,
    output: '',
  };
  try {
    const ready = await waitForPeerReady(child);
    peer.owner = ready.owner;
    peer.port = ready.p2pPort;
    peer.control = JSON.parse(await readFile(join(dir, 'control.json'), 'utf8'));
    child.stdout?.resume();
    child.stderr?.resume();
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  progress.event(`peer ${name} started: ${peer.owner.slice(0, 12)}`);
  events.push({ event: 'peer-started', name, owner: peer.owner, p2pPort: peer.port });
  return peer;
}
async function stop(peer: Peer): Promise<void> {
  await stopChild(peer.child);
}
async function call(peer: Peer, command: string, args: Record<string, unknown> = {}): Promise<any> {
  return controlPost(peer.control, { command, ...args });
}
const caseId = scenario?.caseId ?? 'rollback-investigation';
const longEvidence = scenario
  ? (scenario.longEvidence ?? false)
  : process.env.RELAY_DEMO_LONG === '1';
const padding =
  'Routine shift archive: inventory counts and operator assignments were reviewed. No incident configuration was recorded in this entry.\n\n'.repeat(
    28,
  );
const evidenceText = (text: string) => (!scenario && longEvidence ? padding + text : text);
let a: Peer | undefined, b: Peer | undefined;
let observedModel: string | undefined;
const started = performance.now();
try {
  a = await start('a');
  b = await start('b');
  observedModel = (await call(a, 'status')).model;
  await call(a, 'pair', { key: b.owner });
  await call(b, 'pair', { key: a.owner });
  await call(a, 'connect', { port: b.port });
  progress.event('peers paired and connected');
  await call(a, 'create', {
    id: caseId,
    title: scenario?.title ?? 'Checkout rollback',
    needs: JSON.stringify(
      scenario?.informationNeeds ?? [
        {
          id: 'deployment-config',
          question: 'What deployment configuration changed in deployment 42?',
        },
      ],
    ),
    task:
      scenario?.task ??
      'Prepare an engineering handoff about checkout errors after deployment 42. Cover both the health log and deployment configuration. If deployment configuration is unavailable, request it from a collaborator and save a pending brief with the missing information. When supplied, update the brief using the new source. Distinguish observed timing from uncertain root cause.',
  });
  const initialEvidence = scenario?.evidence ?? [
    {
      id: 'health-log',
      title: 'Checkout health log',
      text: evidenceText(
        'Checkout errors rose from 0.2% to 8% after deployment 42 at 09:14. Rolling back at 09:22 restored errors to 0.2%. The health log does not include deployment configuration.',
      ),
    },
  ];
  for (const evidence of initialEvidence) await call(a, 'evidence', { case: caseId, ...evidence });
  progress.event(`case ${caseId} created; ${initialEvidence.length} source(s) added`);
  const poll = (peer: Peer, phase: string) => {
    let stopped = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      try {
        progress.status(
          phase,
          await controlPost(
            peer.control,
            { command: 'status' },
            { timeoutMs: 5000, signal: controller.signal },
          ),
          caseId,
        );
      } catch {
        /* Peer may be restarting. */
      }
      if (!stopped) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  };
  progress.event('initial work started; waiting for native inference');
  const stopInitialPoll = poll(a, 'initial');
  let initial: any;
  try {
    initial = await call(a, 'work', { case: caseId });
  } finally {
    stopInitialPoll();
  }
  const initialStatus = await call(a, 'status');
  events.push({
    event: 'initial-run-settled',
    cleanupError: initialStatus.cleanupError,
    active: initialStatus.active,
  });
  assert.equal(initialStatus.cleanupError, null, 'Initial model cleanup failed');
  events.push({ event: 'initial-work', checkpoint: initial });
  assert.equal(
    initial.status,
    'pending',
    `Live agent did not create pending handoff: ${JSON.stringify(initial)}`,
  );
  progress.event(`initial checkpoint ${initial.status}; waiting for request replication`);
  const request = await until(async () => {
    const records = (await call(b!, 'inspect', { case: caseId })) as RelayRecord[];
    return records.find(
      (r) =>
        r.kind === 'request' &&
        initial.requestIds.includes(r.id) &&
        (!scenario ||
          r.needId === (scenario.contribution.needId ?? scenario.informationNeeds[0]!.id)),
    );
  });
  progress.event(`request ${request.id} replicated; taking peer a offline`);
  await stop(a);
  assert.equal(a.child.exitCode, 0, 'Initial peer did not close cleanly');
  events.push({ event: 'a-offline' });
  const contribution = scenario?.contribution ?? {
    id: 'deployment-config',
    title: 'Deployment 42 configuration',
    text: evidenceText(
      'Deployment 42 changed checkout database timeout from 3000 ms to 100 ms. The rollback restored timeout to 3000 ms. This change is documented in the deployment configuration; causality still requires verification.',
    ),
  };
  await call(b, 'evidence', {
    case: caseId,
    id: contribution.id,
    title: contribution.title,
    text: contribution.text,
    request: request.id,
  });
  events.push({ event: 'b-contributed-offline', id: contribution.id, requestId: request.id });
  progress.event(`peer b contributed ${contribution.id} while a was offline`);
  const previousOwner = a.owner;
  a = await start('a');
  assert.equal(a.owner, previousOwner, 'A identity changed after restart');
  await call(a, 'connect', { port: b.port });
  progress.event('peer a reconnected; waiting for replication and automatic resumption');
  const stopResumePoll = poll(a, 'resumption');
  let final;
  try {
    final = await until(async () => {
      const records = (await call(a!, 'inspect', { case: caseId })) as RelayRecord[];
      const cp = latestCheckpoint(records, a!.owner);
      if (cp && cp.status !== 'completed' && resumptionSettled(cp, initial.runId))
        return { records, checkpoint: cp };
      if (cp?.status === 'failed' || cp?.status === 'cancelled') return { records, checkpoint: cp };
      return cp?.status === 'completed' && cp.consumed.includes(contribution.id)
        ? { records, checkpoint: cp }
        : undefined;
    }, 720_000);
  } finally {
    stopResumePoll();
  }
  progress.event(`resumption checkpoint ${final.checkpoint.status}`);
  const settled = await until(async () => {
    const status = await call(a!, 'status');
    return status.active ? undefined : status;
  }, 45_000);
  events.push({
    event: 'terminal-run-settled',
    checkpoint: final.checkpoint,
    cleanupError: settled.cleanupError,
    resumptionError: settled.resumptionError,
  });
  assert.equal(
    final.checkpoint.status,
    'completed',
    `Automatic resumption failed: ${JSON.stringify(final.checkpoint)}`,
  );
  assert.equal(settled.cleanupError, null, 'Resumed model cleanup failed');
  assert.equal(settled.resumptionError, null, 'Resumption infrastructure failed');
  events.push({ event: 'model-cleanup-verified' });
  const brief = final.records.find((r) => r.kind === 'brief' && r.id === final.checkpoint.briefId);
  assert.ok(brief?.kind === 'brief');
  if (longEvidence && !scenario) {
    assert.ok(
      brief.facts.some((f) =>
        f.sources.some((s) => s.id === 'health-log' && s.quote.includes('0.2% to 8%')),
      ),
      'Long-record handoff must quote the late health-log fact',
    );
    assert.ok(
      brief.facts.some((f) =>
        f.sources.some(
          (s) => s.id === 'deployment-config' && s.quote.includes('3000 ms to 100 ms'),
        ),
      ),
      'Long-record handoff must quote the late configuration value',
    );
  }
  assert.ok(
    brief.facts.some((f) => f.sources.some((s) => s.id === contribution.id)),
    'Resumed brief must cite contribution',
  );
  for (const expected of scenario?.requiredQuotes ?? [])
    assert.ok(
      brief.facts.some((f) =>
        f.sources.some((s) => s.id === expected.id && s.quote.includes(expected.quote)),
      ),
      `Missing required observed quote for ${expected.id}`,
    );
  events.push({ event: 'resumed', checkpoint: final.checkpoint, brief });
  progress.event('final brief saved; checking restart deduplication and cleanup');
  const runId = final.checkpoint.runId;
  await call(a, 'scan');
  await call(a, 'scan');
  await stop(a);
  a = await start('a');
  await call(a, 'scan');
  const persisted = latestCheckpoint(await call(a, 'inspect', { case: caseId }), a.owner);
  assert.equal(persisted?.runId, runId, 'Repeated scans or restart duplicated completed work');
  events.push({ event: 'restart-deduplication-verified', runId });
  await stop(a);
  assert.equal(a.child.exitCode, 0, 'Restarted A did not close cleanly');
  a = undefined;
  await stop(b);
  assert.equal(b.child.exitCode, 0, 'B did not close cleanly');
  b = undefined;
  events.push({ event: 'peers-stopped-cleanly' });
  progress.event('both peers stopped cleanly');
  const report = {
    mode: 'live-qvac-two-peer',
    sourceCommit,
    sourceCommitBasis,
    scenarioSHA256,
    fixtureId: scenario?.fixtureId ?? null,
    longEvidence,
    selector: process.env.RELAY_SELECTOR ?? 'deterministic',
    model: observedModel,
    passed: true,
    elapsedMs: performance.now() - started,
    directory,
    events,
  };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: true,
        report: join(directory, 'report.json'),
        elapsedMs: report.elapsedMs,
        calls: final.checkpoint.calls,
        repairs: final.checkpoint.repairs,
        brief,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const report = {
    mode: 'live-qvac-two-peer',
    sourceCommit,
    sourceCommitBasis,
    scenarioSHA256,
    fixtureId: scenario?.fixtureId ?? null,
    selector: process.env.RELAY_SELECTOR ?? 'deterministic',
    model: observedModel,
    passed: false,
    elapsedMs: performance.now() - started,
    error: error instanceof Error ? error.message : String(error),
    events,
  };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.error(
    JSON.stringify(
      {
        passed: false,
        report: join(directory, 'report.json'),
        error: report.error.split(': {')[0]!.split('\n')[0]!.slice(0, 400),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  for (const [name, peer] of [
    ['a', a],
    ['b', b],
  ] as const) {
    if (!peer) continue;
    let error: string | null = null;
    try {
      await stop(peer);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      progress.event(`peer ${name} cleanup failed: ${error}`);
      process.exitCode = 1;
    }
    cleanup.push({
      peer: name,
      exitCode: peer.child.exitCode,
      signal: peer.child.signalCode,
      error,
    });
    if (peer.child.exitCode !== 0) process.exitCode = 1;
  }
  // Include cleanup even when an assertion failed before normal shutdown.
  const path = join(directory, 'report.json');
  const retained = JSON.parse(await readFile(path, 'utf8'));
  retained.finalCleanup = cleanup;
  retained.cleanupPassed = cleanup.every((row) => row.exitCode === 0 && row.error === null);
  await writeFile(path, JSON.stringify(retained, null, 2));
}
