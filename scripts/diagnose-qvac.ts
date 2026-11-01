import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { errorDetails } from './error-details.js';

// Starts a real QVAC worker and checks IPC, without downloading or loading weights.
const logging = await import('@qvac/sdk/logging');
logging.setGlobalLogLevel('debug');
logging.setGlobalConsoleOutput(true);
const sdk = await import('@qvac/sdk');
const started = performance.now();
console.log(
  JSON.stringify({
    mode: 'native-worker-heartbeat',
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    expectedWorkerEntry: resolve('qvac/worker.entry.mjs'),
    rpcTimeoutOverride: process.env.QVAC_RPC_INIT_TIMEOUT_MS ?? null,
  }),
);
try {
  const response = await sdk.heartbeat();
  console.log(
    JSON.stringify({
      mode: 'native-worker-heartbeat',
      passed: true,
      elapsedMs: performance.now() - started,
      response,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        mode: 'native-worker-heartbeat',
        passed: false,
        elapsedMs: performance.now() - started,
        error: errorDetails(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await sdk.close();
}
