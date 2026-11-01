import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RelayStore } from '../src/store.js';
import { type RelayRecord, stableId } from '../src/records.js';

const createdAt = '2026-10-31T00:00:00.000Z';
function evidence(owner: string, name: string, requestId?: string): RelayRecord {
  return { schemaVersion: 1, kind: 'evidence', owner, id: stableId(owner, name), caseId: 'handoff', createdAt, title: name, text: `Observed ${name}`, ...(requestId ? { requestId } : {}) };
}

test('owned immutable records survive reopen; duplicate writes are safe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'relay-store-'));
  let store = await RelayStore.open(directory);
  try {
    const record = evidence(store.owner, 'trace');
    const writes = await Promise.all([store.put(record), store.put(record)]);
    assert.deepEqual(writes.map(result => result.duplicate), [false, true]);
    await assert.rejects(store.put({ ...record, text: 'changed' } as RelayRecord), /Immutable record conflict/);
    await assert.rejects(store.put({ ...record, owner: 'a'.repeat(64) }), /Permission denied/);
    await assert.rejects(store.put({ ...record, schemaVersion: null } as unknown as RelayRecord));
    const owner = store.owner;
    await store.close();
    store = await RelayStore.open(directory);
    assert.equal(store.owner, owner);
    assert.deepEqual(await store.get(record.id), record);
    assert.equal((await store.list('handoff')).length, 1);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

interface Ready { owner: string; port: number }
class Peer {
  readonly child: ChildProcess;
  readonly ready: Promise<Ready>;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  diagnostics = '';
  constructor(directory: string) {
    this.child = fork(fileURLToPath(new URL('./peer-worker.ts', import.meta.url)), [directory], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child.stdout?.on('data', data => { this.diagnostics += String(data); });
    this.child.stderr?.on('data', data => { this.diagnostics += String(data); });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Peer startup timeout: ${this.diagnostics}`)), 15000);
      this.child.on('message', (message: { type?: string; id?: number; result?: unknown; error?: string } & Partial<Ready>) => {
        if (message.type === 'ready') { clearTimeout(timer); resolve({ owner: message.owner!, port: message.port! }); return; }
        if (message.id === undefined) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
      });
      this.child.once('exit', code => {
        clearTimeout(timer);
        const error = new Error(`Peer exited (${code}): ${this.diagnostics}`);
        reject(error);
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear();
      });
    });
  }
  async command<T = unknown>(command: string, value?: unknown): Promise<T> {
    await this.ready;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Peer ${command} timeout: ${this.diagnostics}`)); }, 10000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child.send({ id, command, value }, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    try { await this.command('close'); } catch { /* Forced cleanup below remains bounded. */ }
    if (this.child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 3000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 12000;
  let last: unknown;
  do {
    try { const value = await read(); if (accept(value)) return value; last = value; }
    catch (error) { last = String(error); }
    await delay(80);
  } while (Date.now() < deadline);
  throw new Error(`Replication condition not met: ${JSON.stringify(last)}`);
}

test('real separate peers replicate, disconnect, reconnect and retain remote blocks across restart', { timeout: 70000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'relay-peers-'));
  const peers: Peer[] = [];
  const start = (name: string) => { const peer = new Peer(join(directory, name)); peers.push(peer); return peer; };
  try {
    let a = start('a');
    const b = start('b');
    const [aa, bb] = await Promise.all([a.ready, b.ready]);
    assert.notEqual(aa.owner, bb.owner);
    await a.command('pair', bb.owner);
    await b.command('pair', aa.owner);
    const initial = evidence(aa.owner, 'initial incident log');
    const request: RelayRecord = { schemaVersion: 1, kind: 'request', id: stableId(aa.owner, 'request'), owner: aa.owner, caseId: 'handoff', createdAt, question: 'What changed in the deployment?' };
    await a.command('put', initial);
    await a.command('put', request);
    await b.command('connect', aa.port);
    assert.deepEqual(await eventually(() => b.command('get', request.id), value => Boolean(value)), request);
    assert.deepEqual(await b.command('get', initial.id), initial);
    await assert.rejects(b.command('put', initial), /Permission denied/);
    await a.command('disconnect');
    await a.close();
    const contribution = evidence(bb.owner, 'deployment evidence', request.id);
    await b.command('put', contribution);
    a = start('a');
    assert.equal((await a.ready).owner, aa.owner);
    assert.equal(await a.command('get', contribution.id), undefined);
    await a.command('connect', bb.port);
    assert.deepEqual(await eventually(() => a.command('get', contribution.id), value => Boolean(value)), contribution);
    // Repeated refreshes and duplicate writes must not create additional records.
    await a.command('refresh');
    await a.command('refresh');
    const duplicate = await b.command<{ duplicate: boolean }>('put', contribution);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await a.command<RelayRecord[]>('list', 'handoff')).length, 3);
    // A third sparse reader learns B's signed length, then loses transport
    // before requesting any value blocks. A read must fail, not report absence.
    const c = start('c');
    await c.command('pair', bb.owner);
    await c.command('connect', bb.port);
    await eventually(() => c.command<Array<{ knownBlocks: number }>>('status'), status => (status[0]?.knownBlocks ?? 0) > 0);
    await c.command('disconnect');
    await assert.rejects(c.command('get', contribution.id), /Cannot read peer|REQUEST_TIMEOUT|BLOCK_NOT_AVAILABLE/);
    await c.close();
    await a.close();
    await b.close();
    a = start('a');
    // No server B is alive: A must read its own persisted replicated blocks.
    assert.deepEqual(await a.command('get', contribution.id), contribution);
    assert.equal((await a.command<Array<{ owner: string }>>('status'))[0]?.owner, bb.owner);
  } finally {
    await Promise.all(peers.map(peer => peer.close()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('unavailable uninitialised peer is visible and bounded; invalid pairing is rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'relay-unavailable-'));
  const store = await RelayStore.open(directory);
  try {
    await assert.rejects(store.pair('../other-store'), /Peer key/);
    await store.pair('f'.repeat(64));
    assert.deepEqual(store.remoteStatus(), [{ owner: 'f'.repeat(64), knownBlocks: 0 }]);
    assert.equal(await store.get('not-known-locally'), undefined);
    await assert.rejects(store.connect(0), /Invalid TCP port/);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
