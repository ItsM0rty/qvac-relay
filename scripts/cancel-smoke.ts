import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  cancel,
  close,
  completion,
  InferenceCancelledError,
  loadModel,
  unloadModel,
  QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4,
} from '@qvac/sdk';
import { errorDetails } from './error-details.js';

// Run separately from smoke.ts so two processes never hold generators for this check.
let modelId: string | undefined;
let activeRequest: string | undefined;
let expired = false;
const started = performance.now();
async function report(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/live-cancellation.json', JSON.stringify(value, null, 2));
  console.log(JSON.stringify(value, null, 2));
}
const timer = setTimeout(() => {
  expired = true;
  if (activeRequest) void cancel({ requestId: activeRequest }).catch(() => undefined);
}, 300_000);
try {
  const candidate = process.env.RELAY_MODEL ?? '1.7b';
  assert.ok(candidate === '0.6b' || candidate === '1.7b', 'RELAY_MODEL must be 0.6b or 1.7b');
  const loading = loadModel({
    modelSrc: candidate === '0.6b' ? QWEN3_600M_INST_Q4 : QWEN3_1_7B_INST_Q4,
    modelType: 'llamacpp-completion',
    modelConfig: { device: 'cpu', ctx_size: 8192, parallel: 1 },
  });
  activeRequest = loading.requestId;
  modelId = await loading;
  assert.equal(expired, false, 'Deadline expired while loading');
  const run = completion({
    modelId,
    history: [
      {
        role: 'user',
        content: 'Count every integer from 1 to 10000, one per line. Keep going. /no_think',
      },
    ],
    stream: true,
    captureThinking: true,
    generationParams: { temp: 0, predict: 1024 },
  });
  activeRequest = run.requestId;
  const outcome = run.final.then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  let observedNativeOutput = false;
  let cancellationSent = false;
  let cancelMs = 0;
  try {
    for await (const event of run.events) {
      if (event.type === 'contentDelta' || event.type === 'thinkingDelta') {
        observedNativeOutput = true;
        const cancelling = performance.now();
        await cancel({ requestId: run.requestId });
        cancelMs = performance.now() - cancelling;
        cancellationSent = true;
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof InferenceCancelledError)) throw error;
  }
  const settled = await outcome;
  assert.equal(expired, false, 'Deadline expired');
  assert.ok(observedNativeOutput, 'No native output was observed before cancellation');
  assert.ok(cancellationSent, 'Cancellation was not sent to an active decode');
  assert.ok(
    settled.error instanceof InferenceCancelledError,
    'Native completion did not reject with InferenceCancelledError',
  );
  await report({
    mode: 'live-qvac-cancellation',
    passed: true,
    candidate,
    observedNativeOutput,
    cancellationSent,
    cancelMs,
    elapsedMs: performance.now() - started,
    cancellationError: errorDetails(settled.error),
  });
} catch (error) {
  await report({ mode: 'live-qvac-cancellation', passed: false, error: errorDetails(error) });
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try {
    if (modelId) await unloadModel({ modelId, clearStorage: false });
  } finally {
    await close();
  }
}
