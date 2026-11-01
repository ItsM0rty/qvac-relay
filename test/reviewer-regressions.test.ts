import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RelayStore } from '../src/store.js';

test(
  'store cleanup attempts every tree and core, shares concurrent close and retries only failed steps',
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-close-regression-'));
    const a = await RelayStore.open(join(directory, 'a'));
    const b = await RelayStore.open(join(directory, 'b'));
    const c = await RelayStore.open(join(directory, 'c'));
    await a.pair(b.owner);
    await a.pair(c.owner);
    const port = await a.listen();
    await b.connect(port);
    const internals = a as unknown as {
      remotes: Map<string, { close(): Promise<void> }>;
      local: { close(): Promise<void> };
      cores: { close(): Promise<void> };
      server: { listening: boolean };
      sockets: Map<unknown, unknown>;
    };
    const resources = [...internals.remotes.values(), internals.local, internals.cores];
    const originals = resources.map((resource) => resource.close.bind(resource));
    const attempts = resources.map(() => 0);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    resources.forEach((resource, index) => {
      resource.close = async () => {
        attempts[index] = attempts[index]! + 1;
        if (index === 0 && attempts[index] === 1) {
          await blocked;
          throw new Error('Injected remote-tree close failure');
        }
        // Also fail local close once to verify error aggregation and retry selection.
        if (index === 2 && attempts[index] === 1)
          throw new Error('Injected local-tree close failure');
        await originals[index]!();
      };
    });
    try {
      const first = a.close();
      const concurrent = a.close();
      assert.equal(first, concurrent, 'Concurrent callers share the same close attempt');
      release();
      const results = await Promise.allSettled([first, concurrent]);
      assert.deepEqual(
        attempts,
        [1, 1, 1, 1],
        'One failed close must not skip remaining resources',
      );
      assert.ok(
        results.every((result) => result.status === 'rejected'),
        'Concurrent callers must observe cleanup failure',
      );
      const error = (results[0] as PromiseRejectedResult).reason;
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(String(error.errors[0].cause), /Injected remote-tree/);
      assert.match(String(error.errors[1].cause), /Injected local-tree/);
      assert.equal(internals.server.listening, false);
      await assert.rejects(a.list(), /Store is closed/);
      await a.close();
      assert.deepEqual(attempts, [2, 1, 2, 1], 'Retry only resource steps that rejected');
      await a.close();
      assert.deepEqual(attempts, [2, 1, 2, 1], 'Successful cleanup is idempotent');
      assert.equal(a.listenerCount('change'), 0);
      assert.equal(internals.sockets.size, 0);
      const reopened = await RelayStore.open(a.directory);
      await reopened.close();
    } finally {
      // The pre-fix implementation cannot retry; release actual resources explicitly.
      release();
      for (const close of originals) await close().catch(() => {});
      await Promise.allSettled([b.close(), c.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

for (const fail of [true, false])
  test(
    `controlled diagnostic subprocess retains report and exits ${fail ? 'nonzero on failure' : 'zero on success'}`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'relay-diagnostic-regression-'));
      const output = join(directory, 'report.json');
      try {
        const source = `
      import { Agent } from './src/agent.ts';
      ${fail ? "Agent.prototype.run = async () => { throw new Error('Injected controlled diagnostic failure'); };" : ''}
      process.argv[2] = ${JSON.stringify(output)};
      await import('./scripts/review-diagnostics.ts');
    `;
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', source],
          {
            cwd: process.cwd(),
            env: { ...process.env, RELAY_SOURCE_COMMIT: 'regression-subprocess' },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let logs = '';
        child.stdout.on('data', (chunk) => {
          logs += chunk;
        });
        child.stderr.on('data', (chunk) => {
          logs += chunk;
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
        let code: number | null;
        let signal: NodeJS.Signals | null;
        try {
          [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(
            (resolve, reject) => {
              child.once('error', reject);
              child.once('exit', (code, signal) => resolve([code, signal]));
            },
          );
        } finally {
          clearTimeout(timer);
        }
        assert.equal(signal, null, logs);
        const report = JSON.parse(await readFile(output, 'utf8'));
        assert.equal(report.nativeInference, false);
        assert.equal(report.rows.length, 3);
        assert.ok(
          report.rows.every((row: { passed: boolean; reason?: string }) =>
            fail
              ? !row.passed && row.reason === 'Injected controlled diagnostic failure'
              : row.passed,
          ),
        );
        assert.equal(code, fail ? 1 : 0, `Report persisted but wrong process status: ${logs}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
