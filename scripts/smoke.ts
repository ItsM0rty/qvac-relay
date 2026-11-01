import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { freemem, totalmem } from 'node:os';
import { QvacModel, type Message, type ToolSpec } from '../src/qvac.js';
import { errorDetails } from './error-details.js';

// This is a live SDK probe. No scripted model responses or cloud APIs are used.
const model = new QvacModel(process.env.RELAY_MODEL??'0.6b','auto');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(new DOMException('Smoke deadline exceeded', 'AbortError')), 300_000);
const interrupt = () => controller.abort(new DOMException('Interrupted', 'AbortError'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const started = performance.now();
let peakParentRss = process.memoryUsage().rss;
let minimumHostFree = freemem();
const sample = setInterval(() => {
  peakParentRss = Math.max(peakParentRss, process.memoryUsage().rss);
  minimumHostFree = Math.min(minimumHostFree, freemem());
}, 250);
const trustedNonce = randomBytes(8).toString('hex');
const tools: ToolSpec[] = [{
  name: 'read_probe',
  description: 'Read the private verification token from the local trusted probe.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
}];
const history: Message[] = [
  { role: 'system', content: 'You verify local tool access. Use read_probe to obtain the private token. After its result, reply with exactly the token. Do not invent a token. /no_think' },
  { role: 'user', content: 'Read the private verification token with the tool, then return it.' },
];
const turns: unknown[] = [];
let toolExecuted = false;
let completed = false;
let exactFormat = false;
async function report(value:unknown):Promise<void>{await mkdir('artifacts',{recursive:true});await writeFile('artifacts/live-smoke.json',JSON.stringify(value,null,2));console.log(JSON.stringify(value,null,2));}
try {
  for (let turn = 0; turn < 4; turn++) {
    const reply = await model.complete(history, tools, controller.signal);
    turns.push({ turn, calls: reply.calls.map(({ id, name }) => ({ id, name })),
      toolErrors: reply.toolErrors, stopReason: reply.stopReason, stats: reply.stats });
    assert.equal(reply.toolErrors.length, 0, 'Native tool parser reported malformed calls');
    assert.notEqual(reply.stopReason, 'length', 'Generation exceeded its output budget');
    history.push({ role: 'assistant', content: reply.content, toolCalls: reply.calls });
    if (reply.calls.length) {
      for (const call of reply.calls) {
        assert.equal(call.name, 'read_probe', 'Model called an undeclared tool');
        assert.ok(call.id, 'Native tool call has no ID');
        assert.deepEqual(call.arguments, {}, 'Probe takes no arguments');
        toolExecuted = true;
        history.push({ role: 'tool', toolCallId: call.id, toolName: call.name,
          content: JSON.stringify({ token: trustedNonce }) });
      }
    } else {
      assert.ok(toolExecuted, 'Model answered without reading the tool');
      const tokens=reply.content.match(/\b[a-f0-9]{16}\b/g)??[];
      assert.deepEqual(tokens,[trustedNonce],'Model did not reproduce exactly the dynamic tool result token');
      exactFormat=reply.content.trim()===trustedNonce;
      completed = true;
      break;
    }
  }
  assert.ok(completed, 'Native loop did not finish within four calls');
  await report({
    mode: 'live-qvac', passed: true, model: model.name, toolExecuted,exactFormat,
    elapsedMs: performance.now() - started, measurements: model.measurements, turns,
    memory: { scope: 'Node parent RSS only; excludes QVAC Bare worker. Host free memory is system-wide, not model attribution.',
      peakParentRssBytes: peakParentRss, minimumHostFreeBytes: minimumHostFree, hostTotalBytes: totalmem() },
  });
} catch (error) {
  await report({ mode: 'live-qvac', passed: false, model: model.name,
    error: errorDetails(error), turns,
    measurements: model.measurements });
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  clearInterval(sample);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  await model.close();
}
