import Corestore from 'corestore';
import Hyperbee2 from 'hyperbee2';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { parseRecord, revision, stableId, type RelayRecord } from './records.js';

const KEY = /^[a-f0-9]{64}$/;
const MAX_PEERS = 16;
const MAX_RECORDS = 2048;
const READ_TIMEOUT_MS = 1500;
const SCAN_TIMEOUT_MS = 5000;

export class StoreReadError extends Error {
  readonly code = 'STORE_READ';
  constructor(readonly owner: string, detail: string, options?: ErrorOptions) {
    super(`Cannot read peer ${owner}: ${detail}`, options);
    this.name = 'StoreReadError';
  }
}

/** One writable tree and explicitly paired, read-only remote trees. */
export class RelayStore extends EventEmitter {
  readonly directory: string;
  readonly owner: string;
  private readonly remotes = new Map<string, Hyperbee2>();
  private readonly sockets = new Map<Socket, Duplex>();
  private server?: Server;
  private writes: Promise<unknown> = Promise.resolve();
  private pairing: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(directory: string, private readonly cores: Corestore, private readonly local: Hyperbee2) {
    super();
    this.directory = directory;
    this.owner = local.core.key.toString('hex');
  }

  static async open(directory: string): Promise<RelayStore> {
    const absolute = resolve(directory);
    await mkdir(absolute, { recursive: true });
    const cores = new Corestore(join(absolute, 'cores'));
    try {
      await cores.ready();
      const local = new Hyperbee2(cores.session(), { timeout: READ_TIMEOUT_MS, autoUpdate: false });
      await local.ready();
      const store = new RelayStore(absolute, cores, local);
      local.on('update', () => store.emit('change', { owner: store.owner, remote: false }));
      let keys: unknown;
      try { keys = JSON.parse(await readFile(join(absolute, '.peers.json'), 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        keys = [];
      }
      if (!Array.isArray(keys) || keys.length > MAX_PEERS || keys.some(key => typeof key !== 'string' || !KEY.test(key)) || new Set(keys).size !== keys.length) {
        throw new Error('Invalid persisted peer list; refusing to discard configuration');
      }
      for (const key of keys as string[]) await store.openRemote(key);
      return store;
    } catch (error) {
      await cores.close();
      throw error;
    }
  }

  private assertOpen(): void { if (this.closed) throw new Error('Store is closed'); }

  private async openRemote(key: string): Promise<void> {
    if (key === this.owner || this.remotes.has(key)) return;
    const tree = new Hyperbee2(this.cores.session(), { key: Buffer.from(key, 'hex'), writable: false, autoUpdate: true, timeout: READ_TIMEOUT_MS });
    await tree.ready();
    this.remotes.set(key, tree);
    tree.on('update', () => this.emit('change', { owner: key, remote: true }));
  }

  async pair(key: string): Promise<void> {
    this.assertOpen();
    if (!KEY.test(key)) throw new Error('Peer key must be 64 lowercase hexadecimal characters');
    const operation = this.pairing.then(async () => {
      if (key === this.owner || this.remotes.has(key)) return;
      if (this.remotes.size >= MAX_PEERS) throw new Error(`At most ${MAX_PEERS} paired peers are supported`);
      await this.openRemote(key);
      const target = join(this.directory, '.peers.json');
      await writeFile(`${target}.tmp`, JSON.stringify([...this.remotes.keys()].sort()), 'utf8');
      await rename(`${target}.tmp`, target);
    });
    this.pairing = operation.catch(() => {});
    await operation;
  }

  /** Immutable operation IDs make retries safe, while conflicting payloads fail. */
  async put(input: RelayRecord): Promise<{ record: RelayRecord; duplicate: boolean }> {
    this.assertOpen();
    const record = parseRecord(input);
    if (record.owner !== this.owner) throw new Error('Permission denied: only the local owner may write this tree');
    const operation = this.writes.then(async () => {
      this.assertOpen();
      const entry = await this.local.get(Buffer.from(record.id));
      if (entry) {
        const previous = this.decode(entry.value, this.owner);
        if (revision(previous) !== revision(record)) throw new Error(`Immutable record conflict: ${record.id}`);
        return { record: previous, duplicate: true };
      }
      const batch = this.local.write();
      try {
        batch.tryPut(Buffer.from(record.id), Buffer.from(JSON.stringify(record)));
        // flush takes and releases Hyperbee2's batch lock, even when it fails.
        await batch.flush();
      } finally {
        if (!batch.closed) await batch.close();
      }
      return { record, duplicate: false };
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  private decode(value: Buffer, owner: string): RelayRecord {
    if (value.byteLength > 128 * 1024) throw new StoreReadError(owner, 'record exceeds 128 KiB');
    const record = parseRecord(JSON.parse(value.toString('utf8')));
    if (record.owner !== owner) throw new StoreReadError(owner, 'record owner does not match its signed tree');
    return record;
  }

  async refresh(): Promise<void> {
    this.assertOpen();
    for (const tree of this.remotes.values()) {
      await tree.core.update({ wait: false });
      tree.update();
    }
  }

  private async readTree(tree: Hyperbee2, owner: string): Promise<RelayRecord[]> {
    const snapshot = tree.snapshot({ timeout: READ_TIMEOUT_MS, wait: true });
    const stream = snapshot.createReadStream({ limit: MAX_RECORDS + 1 });
    const timer = setTimeout(() => stream.destroy(new StoreReadError(owner, 'scan deadline exceeded')), SCAN_TIMEOUT_MS);
    try {
      const records: RelayRecord[] = [];
      for await (const entry of stream) {
        const record = this.decode(entry.value, owner);
        if (entry.key.toString('utf8') !== record.id) throw new StoreReadError(owner, 'key does not match record ID');
        records.push(record);
        if (records.length > MAX_RECORDS) throw new StoreReadError(owner, `scan exceeds ${MAX_RECORDS} records`);
      }
      return records;
    } catch (cause) {
      if (cause instanceof StoreReadError) throw cause;
      throw new StoreReadError(owner, cause instanceof Error ? cause.message : String(cause), { cause });
    } finally {
      clearTimeout(timer);
      stream.destroy();
      await snapshot.close();
    }
  }

  async list(caseId?: string): Promise<RelayRecord[]> {
    this.assertOpen();
    await this.refresh();
    const records = new Map<string, RelayRecord>();
    for (const [owner, tree] of [[this.owner, this.local] as const, ...this.remotes.entries()]) {
      for (const record of await this.readTree(tree, owner)) {
        if (caseId !== undefined && record.caseId !== caseId) continue;
        const previous = records.get(record.id);
        if (previous && revision(previous) !== revision(record)) throw new StoreReadError(owner, `cross-tree record ID conflict: ${record.id}`);
        records.set(record.id, record);
      }
    }
    return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<RelayRecord | undefined> {
    this.assertOpen();
    await this.refresh();
    let result: RelayRecord | undefined;
    for (const [owner, tree] of [[this.owner, this.local] as const, ...this.remotes.entries()]) {
      try {
        const entry = await tree.get(Buffer.from(id), { timeout: READ_TIMEOUT_MS, wait: true });
        if (!entry) continue;
        const record = this.decode(entry.value, owner);
        if (record.id !== id) throw new StoreReadError(owner, 'key does not match record ID');
        if (result && revision(result) !== revision(record)) throw new StoreReadError(owner, `cross-tree record ID conflict: ${id}`);
        result = record;
      } catch (cause) {
        if (cause instanceof StoreReadError) throw cause;
        throw new StoreReadError(owner, cause instanceof Error ? cause.message : String(cause), { cause });
      }
    }
    return result;
  }

  async snapshot(caseId: string): Promise<{ records: RelayRecord[]; fingerprint: string }> {
    const records = await this.list(caseId);
    const relevant = records.filter(record => record.kind === 'case' || record.kind === 'evidence' || record.kind === 'request');
    return { records, fingerprint: stableId(...relevant.map(record => `${record.id}:${revision(record)}`)) };
  }

  remoteStatus(): Array<{ owner: string; knownBlocks: number }> {
    return [...this.remotes].map(([owner, tree]) => ({ owner, knownBlocks: tree.core.length }));
  }

  private attach(socket: Socket, initiator: boolean): void {
    if (this.closed || this.sockets.size >= MAX_PEERS) { socket.destroy(); return; }
    const protocol = this.cores.replicate(initiator);
    this.sockets.set(socket, protocol);
    socket.on('error', error => this.emit('networkError', error));
    protocol.on('error', error => { this.emit('networkError', error); socket.destroy(); });
    socket.on('close', () => { this.sockets.delete(socket); protocol.destroy(); });
    protocol.on('close', () => socket.destroy());
    socket.pipe(protocol).pipe(socket);
  }

  async listen(port = 0): Promise<number> {
    this.assertOpen();
    if (this.server) throw new Error('Peer is already listening');
    const server = createServer(socket => this.attach(socket, false));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    server.on('error', error => this.emit('networkError', error));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Listener has no TCP address');
    return address.port;
  }

  async connect(port: number): Promise<void> {
    this.assertOpen();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TCP port');
    const socket = createConnection({ host: '127.0.0.1', port });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Peer connection timed out')); }, 3000);
      socket.once('error', failed);
      function failed(error: Error): void { clearTimeout(timer); reject(error); }
      socket.once('connect', () => { clearTimeout(timer); socket.removeListener('error', failed); resolve(); });
    });
    this.attach(socket, true);
  }

  disconnect(): void { for (const socket of this.sockets.keys()) socket.destroy(); }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([this.writes, this.pairing]);
    this.disconnect();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    await Promise.all([...this.remotes.values()].map(tree => tree.close()));
    await this.local.close();
    await this.cores.close();
    this.removeAllListeners();
  }
}
