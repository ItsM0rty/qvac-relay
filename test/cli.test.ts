import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test(
  'CLI process exposes authenticated control, persistent case and evidence, and cleans up',
  { timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-cli-'));
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve('src/cli.ts'), 'peer', '--dir', directory],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      let control: { port: number; token: string } | undefined;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        try {
          control = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
          break;
        } catch {}
        if (child.exitCode !== null) throw new Error(`${stdout}\n${stderr}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(control, `No ready control. ${stdout} ${stderr}`);
      const url = `http://127.0.0.1:${control.port}/command`;
      assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
      const call = async (body: unknown) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${control!.token}` },
          body: JSON.stringify(body),
        });
        return { status: response.status, data: (await response.json()) as any };
      };
      assert.equal(
        (await call({ command: 'create', id: 'cli-case', title: 'CLI', task: 'Inspect state.' }))
          .status,
        200,
      );
      const evidence = {
        command: 'evidence',
        case: 'cli-case',
        id: 'cli-evidence',
        title: 'Log',
        text: 'service recovered',
      };
      assert.equal((await call(evidence)).data.duplicate, false);
      assert.equal((await call(evidence)).data.duplicate, true);
      const records = (await call({ command: 'inspect', case: 'cli-case' })).data;
      assert.equal(records.filter((r: any) => r.kind === 'case').length, 1);
      assert.equal(records.filter((r: any) => r.kind === 'evidence').length, 1);
      assert.equal((await call({ command: 'work', case: 'missing' })).status, 400);
      assert.equal((await call({ command: 'cancel' })).status, 200);
    } finally {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
