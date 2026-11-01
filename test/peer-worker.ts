import { RelayStore } from '../src/store.js';
import { parseRecord } from '../src/records.js';

const directory = process.argv[2];
if (!directory || !process.send) throw new Error('Worker requires one private directory and IPC');
const store = await RelayStore.open(directory);
const port = await store.listen();
store.on('networkError', error => process.stderr.write(`network: ${String(error)}\n`));
process.send({ type: 'ready', owner: store.owner, port });
let queue = Promise.resolve();
process.on('message', (value: unknown) => {
  queue = queue.then(async () => {
    const request = value as { id: number; command: string; value?: unknown };
    try {
      let result: unknown;
      switch (request.command) {
        case 'pair': result = await store.pair(String(request.value)); break;
        case 'connect': result = await store.connect(Number(request.value)); break;
        case 'disconnect': result = store.disconnect(); break;
        case 'put': result = await store.put(parseRecord(request.value)); break;
        case 'get': result = await store.get(String(request.value)); break;
        case 'list': result = await store.list(request.value === undefined ? undefined : String(request.value)); break;
        case 'refresh': result = await store.refresh(); break;
        case 'status': result = store.remoteStatus(); break;
        case 'close': await store.close(); process.send?.({ id: request.id, result: true }); process.disconnect?.(); return;
        default: throw new Error(`Unknown worker command ${request.command}`);
      }
      process.send?.({ id: request.id, result });
    } catch (error) { process.send?.({ id: request.id, error: String(error) }); }
  });
});
process.on('disconnect', () => { void store.close().then(() => process.exit(0)); });
