import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lexicalRetrieve,
  PassageIndex,
  projectPassages,
  RETRIEVAL_CONFIG,
} from '../src/retrieval.js';
import type { EvidenceRecord } from '../src/records.js';

function evidence(id: string, text: string, title = 'Notes'): EvidenceRecord {
  return {
    kind: 'evidence',
    id,
    title,
    text,
    owner: 'a'.repeat(64),
    caseId: 'case',
    createdAt: '2026-01-01T00:00:00Z',
    schemaVersion: 1,
  };
}

test('passages cover long evidence verbatim, including negation and late facts', () => {
  const text = `${'Routine deployment details are recorded here. '.repeat(35)}Do not restart the service unless the leader is offline. ${'Further harmless details follow. '.repeat(20)}The late canary was amber.`;
  const passages = projectPassages([evidence('long', text)]);
  assert.ok(passages.length > 2);
  let covered = 0;
  for (const p of passages) {
    assert.ok(p.start <= covered);
    assert.equal(p.text, text.slice(p.start, p.end));
    assert.ok(p.end - p.start <= RETRIEVAL_CONFIG.max);
    covered = Math.max(covered, p.end);
  }
  assert.equal(covered, text.length);
  assert.ok(
    passages.some((p) =>
      p.text.includes('Do not restart the service unless the leader is offline.'),
    ),
  );
  assert.ok(
    lexicalRetrieve('canary amber', passages).some((p) =>
      p.passage.text.includes('The late canary was amber.'),
    ),
  );
});

test('overlong sentences are covered with overlap and original offsets', () => {
  const text = `${'a'.repeat(2000)} end.`;
  const passages = projectPassages([evidence('long', text)]);
  assert.equal(passages[0]?.start, 0);
  assert.equal(passages.at(-1)?.end, text.length);
  for (let i = 1; i < passages.length; i++) assert.ok(passages[i]!.start < passages[i - 1]!.end);
  for (const p of passages) assert.equal(p.text, text.slice(p.start, p.end));
});

test('ranking uses full words, titles, stable ties, and explicit source lookup', () => {
  const passages = projectPassages([
    evidence('z', 'berry berry common'),
    evidence('a', 'berry berry common'),
    evidence('x', 'common berryish', 'Canary'),
  ]);
  assert.deepEqual(
    lexicalRetrieve('berry', passages).map((x) => x.passage.id),
    ['a', 'z'],
  );
  assert.equal(lexicalRetrieve('canary', passages)[0]?.passage.id, 'x');
  assert.deepEqual(lexicalRetrieve('absent', passages), []);
  assert.equal(lexicalRetrieve('', passages).length, 3);
  const multi = projectPassages([evidence('source', 'Something happens. '.repeat(100))]);
  assert.equal(lexicalRetrieve('source', multi, 100).length, multi.length);
});

test('index reflects additions, revision, removal and reconstruction', () => {
  const a = evidence('a', 'the original text');
  const b = evidence('b', 'new information');
  const index = new PassageIndex();
  index.sync([a]);
  assert.equal(index.search('original').length, 1);
  index.sync([a, b]);
  assert.equal(index.search('information').length, 1);
  const changed = evidence('a', 'replacement content');
  index.sync([changed, b]);
  assert.equal(index.search('original').length, 0);
  assert.equal(index.search('replacement').length, 1);
  index.sync([changed]);
  assert.equal(index.search('information').length, 0);
  const rebuilt = new PassageIndex();
  rebuilt.sync([changed]);
  assert.deepEqual(index.search('replacement'), rebuilt.search('replacement'));
});
