import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
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
  child.stdout!.on('data', (chunk) => (peer.output += chunk));
  child.stderr!.on('data', (chunk) => (peer.output += chunk));
  await until(async () => {
    if (child.exitCode !== null) throw new Error(peer.output);
    try {
      const ready = JSON.parse(peer.output) as { owner: string; p2pPort: number };
      const control = JSON.parse(await readFile(join(dir, 'control.json'), 'utf8'));
      peer.owner = ready.owner;
      peer.port = ready.p2pPort;
      peer.control = control;
      return true;
    } catch {
      return undefined;
    }
  }, 45_000);
  events.push({ event: 'peer-started', name, owner: peer.owner, p2pPort: peer.port });
  return peer;
}
async function stop(peer: Peer): Promise<void> {
  if (peer.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => peer.child.once('exit', () => resolve()));
  peer.child.kill('SIGTERM');
  const timer = setTimeout(() => peer.child.kill('SIGKILL'), 15_000);
  await exited;
  clearTimeout(timer);
}
async function call(peer: Peer, command: string, args: Record<string, unknown> = {}): Promise<any> {
  return controlPost(peer.control, { command, ...args });
}
const caseId = 'rollback-investigation';
const longEvidence = process.env.RELAY_DEMO_LONG === '1';
const padding =
  'Routine shift archive: inventory counts and operator assignments were reviewed. No incident configuration was recorded in this entry.\n\n'.repeat(
    28,
  );
const evidenceText = (text: string) => (longEvidence ? padding + text : text);
let a: Peer | undefined, b: Peer | undefined;
const started = performance.now();
try {
  a = await start('a');
  b = await start('b');
  await call(a, 'pair', { key: b.owner });
  await call(b, 'pair', { key: a.owner });
  await call(a, 'connect', { port: b.port });
  await call(a, 'create', {
    id: caseId,
    title: 'Checkout rollback',
    needs: JSON.stringify([
      {
        id: 'deployment-config',
        question: 'What deployment configuration changed in deployment 42?',
      },
    ]),
    task: 'Prepare an engineering handoff about checkout errors after deployment 42. Cover both the health log and deployment configuration. If deployment configuration is unavailable, request it from a collaborator and save a pending brief with the missing information. When supplied, update the brief using the new source. Distinguish observed timing from uncertain root cause.',
  });
  await call(a, 'evidence', {
    case: caseId,
    id: 'health-log',
    title: 'Checkout health log',
    text: evidenceText(
      'Checkout errors rose from 0.2% to 8% after deployment 42 at 09:14. Rolling back at 09:22 restored errors to 0.2%. The health log does not include deployment configuration.',
    ),
  });
  const initial = await call(a, 'work', { case: caseId });
  assert.equal((await call(a, 'status')).cleanupError, null, 'Initial model cleanup failed');
  events.push({ event: 'initial-work', checkpoint: initial });
  assert.equal(
    initial.status,
    'pending',
    `Live agent did not create pending handoff: ${JSON.stringify(initial)}`,
  );
  const request = await until(async () => {
    const records = (await call(b!, 'inspect', { case: caseId })) as RelayRecord[];
    return records.find((r) => r.kind === 'request' && initial.requestIds.includes(r.id));
  });
  await stop(a);
  assert.equal(a.child.exitCode, 0, 'Initial peer did not close cleanly');
  events.push({ event: 'a-offline' });
  await call(b, 'evidence', {
    case: caseId,
    id: 'deployment-config',
    title: 'Deployment 42 configuration',
    request: request.id,
    text: evidenceText(
      'Deployment 42 changed checkout database timeout from 3000 ms to 100 ms. The rollback restored timeout to 3000 ms. This change is documented in the deployment configuration; causality still requires verification.',
    ),
  });
  events.push({ event: 'b-contributed-offline', id: 'deployment-config', requestId: request.id });
  const previousOwner = a.owner;
  a = await start('a');
  assert.equal(a.owner, previousOwner, 'A identity changed after restart');
  await call(a, 'connect', { port: b.port });
  const final = await until(async () => {
    const records = (await call(a!, 'inspect', { case: caseId })) as RelayRecord[];
    const cp = latestCheckpoint(records, a!.owner);
    if (cp?.status === 'failed' || cp?.status === 'cancelled') return { records, checkpoint: cp };
    return cp?.status === 'completed' && cp.consumed.includes('deployment-config')
      ? { records, checkpoint: cp }
      : undefined;
  }, 720_000);
  assert.equal(
    final.checkpoint.status,
    'completed',
    `Automatic resumption failed: ${JSON.stringify(final.checkpoint)}`,
  );
  const settled = await until(async () => {
    const status = await call(a!, 'status');
    return status.active ? undefined : status;
  }, 45_000);
  assert.equal(settled.cleanupError, null, 'Resumed model cleanup failed');
  assert.equal(settled.resumptionError, null, 'Resumption infrastructure failed');
  events.push({ event: 'model-cleanup-verified' });
  const brief = final.records.find((r) => r.kind === 'brief' && r.id === final.checkpoint.briefId);
  assert.ok(brief?.kind === 'brief');
  if (longEvidence) {
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
    brief.facts.some((f) => f.sources.some((s) => s.id === 'deployment-config')),
    'Resumed brief must cite contribution',
  );
  events.push({ event: 'resumed', checkpoint: final.checkpoint, brief });
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
  const report = {
    mode: 'live-qvac-two-peer',
    longEvidence,
    selector: process.env.RELAY_SELECTOR ?? 'deterministic',
    passed: true,
    elapsedMs: performance.now() - started,
    directory,
    events,
  };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    mode: 'live-qvac-two-peer',
    passed: false,
    elapsedMs: performance.now() - started,
    error: error instanceof Error ? error.message : String(error),
    events,
  };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  if (a) await stop(a);
  if (b) await stop(b);
}
