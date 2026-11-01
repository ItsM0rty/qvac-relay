import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecord, revision, stableId, type EvidenceRecord } from '../src/records.js';
const owner = 'a'.repeat(64);
const base = { id: 'evidence-1', owner, caseId: 'handoff:demo.1', createdAt: '2026-10-31T10:00:00.000Z', schemaVersion: 1 };
const evidence = { ...base, kind: 'evidence', title: 'Deployment log', text: 'Version 2 failed at 10:00.' };
const source = { id: evidence.id, revision: stableId('evidence revision'), quote: 'Version 2 failed at 10:00.' };
const brief = {
  ...base, id: 'brief-1', kind: 'brief', facts: [{ text: 'Deployment failed.', sources: [source] }],
  uncertainty: ['The cause is not established.'], missing: ['The failure log is unavailable.'], basedOn: stableId('snapshot'),
};
test('parses each record kind and retains source revisions', () => {
  const records = [evidence,
    { ...base, id: 'case-1', kind: 'case', task: 'Investigate deployment', title: 'Deployment' },
    { ...base, id: 'request-1', kind: 'request', question: 'What is the error log?' }, brief,
    { ...base, id: 'checkpoint-1', kind: 'checkpoint', runId: 'run-1', status: 'pending', task: 'Investigate', calls: 3, repairs: 1, consumed: ['remote-1'], requestIds: ['request-1'] },
  ];
  for (const record of records) assert.equal(parseRecord(record).kind, record.kind);
  const accepted = parseRecord(brief);
  assert.equal(accepted.kind, 'brief');
  if (accepted.kind === 'brief') assert.deepEqual(accepted.facts[0]?.sources[0], source);
});
test('rejects missing, null, malformed and unknown record fields', () => {
  for (const input of [undefined, null, [], {}, { ...evidence, text: null },
    { ...evidence, title: undefined }, { ...evidence, kind: 'unsupported' },
    { ...evidence, extra: true }, { ...evidence, schemaVersion: 2 },
    { ...evidence, owner: 'not-a-key' }, { ...evidence, createdAt: '2026-10-31' },
    { ...evidence, createdAt: '2026-10-31T10:00:00' },
    { ...evidence, caseId: '../other' }, { ...evidence, id: 'x/y' },
    { ...evidence, id: 'a'.repeat(161) }, { ...evidence, title: '   ' },
    { ...evidence, text: 'x'.repeat(16001) }, { ...evidence, requestId: null }]) {
    assert.throws(() => parseRecord(input));
  }
});
test('brief requires facts, citation shape and distinct references', () => {
  for (const input of [
    { ...brief, facts: [] }, { ...brief, facts: [{ text: 'Claim', sources: [] }] },
    { ...brief, facts: [{ text: 'Claim', sources: [source, source] }] },
    { ...brief, facts: [{ text: 'Claim', sources: [{ ...source, revision: 'old' }] }] },
    { ...brief, facts: [{ text: 'Claim', sources: [{ ...source, quote: '' }] }] },
    { ...brief, facts: [brief.facts[0], brief.facts[0]] }, { ...brief, facts: [{ text: 'Claim', sources: [{ ...source, quote: '   ' }] }] },
    { ...brief, uncertainty: ['same', 'same'] }, { ...brief, missing: ['same', 'same'] },
    { ...brief, basedOn: 'not-a-fingerprint' },
  ]) assert.throws(() => parseRecord(input));
});
test('checkpoint rejects duplicate operation references and invalid counters/status', () => {
  const checkpoint = { ...base, kind: 'checkpoint', runId: 'run-1', status: 'running', task: 'Investigate', calls: 0, repairs: 0, consumed: [], requestIds: [] };
  for (const fields of [{ calls: -1 }, { repairs: 0.5 }, { calls: NaN }, { status: 'done' },
    { consumed: ['contribution-1', 'contribution-1'] }, { requestIds: ['request-1', 'request-1'] },
    { consumed: null }, { briefId: null }]) assert.throws(() => parseRecord({ ...checkpoint, ...fields }));
});
test('stable identities preserve boundaries, order and empty parts', () => {
  assert.match(stableId('peer', 'operation'), /^[a-f0-9]{64}$/);
  assert.equal(stableId('peer', 'operation'), stableId('peer', 'operation'));
  assert.notEqual(stableId('ab', 'c'), stableId('a', 'bc'));
  assert.notEqual(stableId('a', 'b'), stableId('b', 'a'));
  assert.notEqual(stableId('a'), stableId('a', ''));
});
test('revision ignores property order and changes when accepted content changes', () => {
  const accepted = parseRecord(evidence) as EvidenceRecord;
  const reordered = Object.fromEntries(Object.entries(accepted).reverse()) as EvidenceRecord;
  assert.equal(revision(accepted), revision(reordered));
  assert.notEqual(revision(accepted), revision({ ...accepted, text: 'Different evidence' }));
  assert.notEqual(revision(accepted), revision({ ...accepted, owner: 'b'.repeat(64) }));
  assert.throws(() => revision({ ...accepted, text: null } as unknown as EvidenceRecord));
});

