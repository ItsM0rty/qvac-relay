import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  DemoProgress,
  ReadyParser,
  stopChild,
  waitForPeerReady,
  resumptionSettled,
} from '../src/demo-progress.js';

test('new terminal pending resumption is visible while initial pending and running still wait', () => {
  assert.equal(resumptionSettled(undefined, 'initial'), false);
  assert.equal(resumptionSettled({ runId: 'initial', status: 'pending' }, 'initial'), false);
  assert.equal(resumptionSettled({ runId: 'child', status: 'running' }, 'initial'), false);
  for (const status of ['pending', 'failed', 'cancelled', 'completed'] as const)
    assert.equal(resumptionSettled({ runId: 'child', status }, 'initial'), true);
});

test('parses only complete peer-ready JSON across chunks and unrelated output', () => {
  const parser = new ReadyParser();
  assert.equal(parser.push('noise\n{"event":"other"}\n{\n "event": "peer-'), undefined);
  const ready = parser.push('ready", "owner":"abc", "p2pPort":1234\n}\n{"event":"other"}');
  assert.deepEqual(ready, { event: 'peer-ready', owner: 'abc', p2pPort: 1234 });
});

test('real child startup fails promptly, and signaled processes stop without hanging', async () => {
  const early = spawn(
    process.execPath,
    ['-e', 'process.stderr.write("startup failed"); process.exit(7)'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await assert.rejects(waitForPeerReady(early, 5000), /exited before ready/);
  await stopChild(early, 500);
  const live = spawn(
    process.execPath,
    [
      '-e',
      `console.log(JSON.stringify({event:'noise'})); console.log(JSON.stringify({event:'peer-ready',owner:'owner',p2pPort:1234},null,2)); setInterval(()=>{},1000)`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    const ready = await waitForPeerReady(live, 5000);
    assert.equal(ready.owner, 'owner');
  } finally {
    await stopChild(live, 500);
  }
  assert.ok(live.exitCode !== null || live.signalCode !== null);
  await stopChild(live, 500);
});

test('progress only emits changed states or periodic waiting heartbeat', () => {
  let now = 0;
  const output: string[] = [];
  const progress = new DemoProgress(
    (line) => output.push(line),
    () => now,
  );
  const status = {
    active: true,
    cases: [
      { id: 'case', checkpoint: { status: 'running', calls: 1, repairs: 0, requestIds: [] } },
    ],
  };
  progress.status('initial', status, 'case');
  progress.status('initial', status, 'case');
  assert.equal(output.length, 1);
  now = 30_000;
  progress.status('initial', status, 'case');
  assert.match(output[1]!, /waiting 30s/);
  now = 31_000;
  status.cases[0]!.checkpoint.calls = 2;
  progress.status('initial', status, 'case');
  assert.match(output[2]!, /calls=2/);
  assert.ok(output.every((line) => !line.includes('token')));
});
