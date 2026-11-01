import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCancelled, classify, failureSignature, RelayError, repairDecision, type FailureKind } from '../src/policy.js';
test('classification distinguishes model, tool, validation, overflow, infrastructure and cancellation', () => {
  const kinds: FailureKind[] = ['validation','model','tool','infrastructure','cancelled','overflow'];
  for(const kind of kinds) assert.equal(classify(new RelayError('CODE','details',kind)),kind);
  assert.equal(classify(new DOMException('Cancelled','AbortError')),'cancelled');
  const cancelled = new Error('Native cancellation'); cancelled.name='InferenceCancelledError';
  assert.equal(classify(cancelled),'cancelled');
  for(const error of [null,undefined,'failure',new Error('Disk failure')]) assert.equal(classify(error),'infrastructure');
});
test('cancel check prevents work only after signal is aborted', () => {
  const controller = new AbortController(); checkCancelled(controller.signal); controller.abort();
  assert.throws(()=>checkCancelled(controller.signal),(error:unknown)=>error instanceof RelayError && error.code==='CANCELLED' && error.kind==='cancelled');
});
test('repair stops on equivalent failures, exhausted budgets and nonvalidation errors', () => {
  const failure = failureSignature(new RelayError('BAD_CITATION','Unknown evidence ID'));
  assert.equal(repairDecision(0,undefined,failure,'validation'),'repair');
  assert.equal(repairDecision(1,'different',failure,'validation'),'repair');
  assert.equal(repairDecision(1,failure,failure,'validation'),'stop');
  assert.equal(repairDecision(2,'different',failure,'validation'),'stop');
  assert.equal(repairDecision(0,undefined,failure,'validation',0),'stop');
  for(const kind of ['model','tool','infrastructure','cancelled','overflow'] as const) assert.equal(repairDecision(0,undefined,failure,kind),'stop');
  assert.equal(failureSignature(new RelayError('BAD_CITATION','Unknown evidence ID')),failure);
  assert.notEqual(failureSignature(new RelayError('STALE_CITATION','Unknown evidence ID')),failure);
});
