import { parseArgs } from 'node:util';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RelayStore } from './store.js';
import { parseRecord, stableId } from './records.js';
import { Agent, latestCheckpoint } from './agent.js';
import { QvacModel } from './qvac.js';
import { DeterministicSelector } from './context.js';
import { LayaSelector } from './laya.js';
import { Resumer } from './resume.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string' },
    port: { type: 'string' },
    api: { type: 'string' },
    key: { type: 'string' },
    case: { type: 'string' },
    id: { type: 'string' },
    title: { type: 'string' },
    task: { type: 'string' },
    text: { type: 'string' },
    file: { type: 'string' },
    request: { type: 'string' },
    help: { type: 'boolean' },
  },
});
const command = positionals[0];
const usage = `Relay: local inference and peer handoffs
  peer --dir <own-directory> --port 7001 --api 7101
  status|cancel|scan --dir <own-directory>
  pair --dir <own-directory> --key <remote-owner-key>
  connect --dir <own-directory> --port <remote-port>
  disconnect --dir <own-directory>
  create --dir <own-directory> --id <case-id> --title <title> --task <task>
  evidence --dir <own-directory> --case <case-id> --title <title> --text <text> [--request <request-id>] [--id <operation-id>]
  work|inspect --dir <own-directory> --case <case-id>
Use --file instead of --text for a local UTF-8 evidence file.
RELAY_MODEL=0.6b|1.7b RELAY_SELECTOR=deterministic|laya (default deterministic).`;
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2));
function need(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
function port(value: unknown): number {
  const p = Number(value);
  if (!Number.isInteger(p) || p < 0 || p > 65535) throw new Error('Invalid port');
  return p;
}

async function main(): Promise<void> {
  if (values.help || !command) {
    console.log(usage);
    return;
  }
  const directory = resolve(need(values.dir, 'dir'));
  const controlPath = join(directory, 'control.json');
  if (command !== 'peer') {
    const control = JSON.parse(await readFile(controlPath, 'utf8')) as {
      port: number;
      token: string;
    };
    let text = values.text;
    if (values.file) {
      const content = await readFile(resolve(values.file));
      if (content.length > 16000) throw new Error('Evidence file exceeds 16000 bytes');
      text = content.toString('utf8');
    }
    const response = await fetch(`http://127.0.0.1:${control.port}/command`, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command, ...values, text }),
      signal: AbortSignal.timeout(360_000),
    });
    const result: unknown = await response.json();
    output(result);
    if (!response.ok) process.exitCode = 1;
    return;
  }
  const mode = process.env.RELAY_SELECTOR ?? 'deterministic';
  if (mode !== 'deterministic' && mode !== 'laya')
    throw new Error('RELAY_SELECTOR must be deterministic or laya');
  const model = new QvacModel();
  const store = await RelayStore.open(directory);
  const selector = mode === 'laya' ? new LayaSelector() : new DeterministicSelector();
  const agent = new Agent(store, model);
  const resumer = new Resumer(store, agent, { selector, maxCalls: 20, timeoutMs: 300_000 });
  let manual: Promise<unknown> | undefined;
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    try {
      if (
        req.method !== 'POST' ||
        req.url !== '/command' ||
        req.headers.authorization !== `Bearer ${token}`
      ) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Unauthorized local control request' }));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 32000) throw new Error('Command exceeds32000 bytes');
        chunks.push(Buffer.from(chunk));
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        string | undefined
      >;
      let result: unknown;
      switch (input.command) {
        case 'status': {
          const records = await store.list();
          result = {
            owner: store.owner,
            active: agent.isActive,
            selector: mode,
            model: model.name,
            resumptionError: resumer.lastError ? String(resumer.lastError) : null,
            remotes: store.remoteStatus(),
            cases: records
              .filter((r) => r.kind === 'case')
              .map((r) => ({
                id: r.caseId,
                title: r.kind === 'case' ? r.title : '',
                owner: r.owner,
                checkpoint: latestCheckpoint(
                  records.filter((c) => c.caseId === r.caseId),
                  store.owner,
                ),
              })),
          };
          break;
        }
        case 'pair':
          await store.pair(need(input.key, 'key'));
          result = { paired: input.key };
          break;
        case 'connect':
          await store.connect(port(input.port));
          result = { connected: input.port };
          break;
        case 'disconnect':
          store.disconnect();
          result = { disconnected: true };
          break;
        case 'create': {
          const caseId = input.id ?? randomUUID();
          const existing = (await store.list(caseId)).filter((r) => r.kind === 'case');
          if (existing.length) throw new Error('Case already exists');
          const record = parseRecord({
            schemaVersion: 1,
            kind: 'case',
            id: stableId(store.owner, 'case', caseId),
            owner: store.owner,
            caseId,
            createdAt: new Date().toISOString(),
            title: need(input.title, 'title'),
            task: need(input.task, 'task'),
          });
          await store.put(record);
          result = record;
          break;
        }
        case 'evidence': {
          const caseId = need(input.case, 'case');
          const records = await store.list(caseId);
          if (records.filter((r) => r.kind === 'case').length !== 1)
            throw new Error('Case must be replicated before adding evidence');
          if (input.request && !records.some((r) => r.kind === 'request' && r.id === input.request))
            throw new Error('Request must exist in this case');
          const id = input.id ?? randomUUID();
          const existing = records.find((r) => r.id === id);
          const record = parseRecord({
            schemaVersion: 1,
            kind: 'evidence',
            id,
            owner: store.owner,
            caseId,
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            title: need(input.title, 'title'),
            text: need(input.text, 'text'),
            ...(input.request ? { requestId: input.request } : {}),
          });
          result = await store.put(record);
          break;
        }
        case 'inspect':
          result = await store.list(need(input.case, 'case'));
          break;
        case 'work':
          if (agent.isActive) throw new Error('Peer already working');
          manual = agent.run(need(input.case, 'case'), {
            selector,
            maxCalls: 20,
            timeoutMs: 300_000,
          });
          try {
            result = await manual;
          } finally {
            manual = undefined;
          }
          break;
        case 'cancel':
          agent.cancel();
          result = { cancellationRequested: true };
          break;
        case 'scan':
          result = await resumer.scan();
          break;
        default:
          throw new Error('Unknown command');
      }
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  try {
    const p2pPort = await store.listen(port(values.port ?? '0'));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port(values.api ?? '0'), '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Control server failed');
    await writeFile(controlPath, JSON.stringify({ port: address.port, token }), { mode: 0o600 });
    output({
      event: 'peer-ready',
      owner: store.owner,
      p2pPort,
      controlPort: address.port,
      directory,
      model: model.name,
      selector: mode,
      inference: 'lazy; weights released after each run',
      freshness: 'latest locally available records',
    });
    store.on('networkError', (error) => output({ event: 'network-error', error: String(error) }));
    resumer.start();
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } finally {
    agent.cancel();
    await resumer.close();
    await manual?.catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (selector instanceof LayaSelector) await selector.close();
    await model.close();
    await store.close();
    await unlink(controlPath).catch(() => undefined);
  }
}
main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
