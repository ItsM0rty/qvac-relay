import { revision, type RelayRecord } from './records.js';

export interface Passage {
  id: string;
  sourceId: string;
  revision: string;
  title: string;
  text: string;
  start: number;
  end: number;
}

export const RETRIEVAL_CONFIG = Object.freeze({
  version: 1,
  target: 550,
  max: 900,
  overlap: 100,
  defaultLimit: 12,
});

/** Partition at sentence or paragraph boundaries, retaining every original character. */
function windows(text: string): Array<[number, number]> {
  const boundaries = [0];
  const pattern = /(?:[.!?]+["')\]]*(?=\s|$)|\n\s*\n)/g;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end > (boundaries[boundaries.length - 1] ?? 0)) boundaries.push(end);
  }
  if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length);
  const result: Array<[number, number]> = [];
  let start = 0;
  while (start < text.length) {
    const possible = boundaries.filter((b) => b > start && b <= start + RETRIEVAL_CONFIG.max);
    let end =
      possible.find((b) => b >= start + RETRIEVAL_CONFIG.target) ?? possible[possible.length - 1];
    // A single sentence exceeding the maximum is split into overlapping hard windows.
    if (end === undefined) end = Math.min(start + RETRIEVAL_CONFIG.max, text.length);
    result.push([start, end]);
    if (end === text.length) break;
    const overlapBoundary = boundaries.find(
      (b) => b > start && b >= end - RETRIEVAL_CONFIG.overlap && b < end,
    );
    // Reuse a whole preceding sentence when possible. Hard splits use character overlap.
    const previousBoundary = boundaries.filter((b) => b > start && b < end).at(-1);
    const next =
      overlapBoundary ?? previousBoundary ?? Math.max(start + 1, end - RETRIEVAL_CONFIG.overlap);
    start = next;
  }
  return result;
}

export function projectPassages(records: readonly RelayRecord[]): Passage[] {
  const evidence = records.filter((record) => record.kind === 'evidence');
  const reserved = new Set(evidence.map((record) => record.id));
  const used = new Set<string>();
  const passages: Passage[] = [];
  for (const record of evidence) {
    const parts = windows(record.text);
    const rev = revision(record);
    for (const [start, end] of parts) {
      let id = parts.length === 1 ? record.id : `${record.id}:p${start}-${end}`;
      if (parts.length > 1) {
        while (reserved.has(id) || used.has(id)) id += ':p';
      }
      if (used.has(id)) throw new Error(`Duplicate evidence ID: ${record.id}`);
      used.add(id);
      passages.push({
        id,
        sourceId: record.id,
        revision: rev,
        title: record.title,
        text: record.text.slice(start, end),
        start,
        end,
      });
    }
  }
  return passages;
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function lexicalRetrieve(
  query: string,
  passages: readonly Passage[],
  limit: number = RETRIEVAL_CONFIG.defaultLimit,
): Array<{ passage: Passage; score: number }> {
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (!count) return [];
  const terms = [...new Set(tokens(query))];
  const sorted = [...passages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const exact = sorted.filter((passage) => passage.sourceId === query.trim());
  if (exact.length) return exact.slice(0, count).map((passage) => ({ passage, score: 1 }));
  if (!query.trim()) return sorted.slice(0, count).map((passage) => ({ passage, score: 0 }));
  if (!terms.length || !sorted.length) return [];
  const documents = sorted.map((passage) => tokens(`${passage.title} ${passage.text}`));
  const average = documents.reduce((sum, doc) => sum + doc.length, 0) / documents.length || 1;
  const frequencies = terms.map((term) => documents.filter((doc) => doc.includes(term)).length);
  return sorted
    .map((passage, i) => {
      const doc = documents[i] ?? [];
      let score = 0;
      terms.forEach((term, j) => {
        const tf = doc.filter((token) => token === term).length;
        if (!tf) return;
        const df = frequencies[j] ?? 0;
        const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
        score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / average));
      });
      return { passage, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.passage.id < b.passage.id ? -1 : a.passage.id > b.passage.id ? 1 : 0),
    )
    .slice(0, count);
}

export class PassageIndex {
  private signature = '';
  private passages: Passage[] = [];
  sync(records: readonly RelayRecord[]): void {
    const signature = JSON.stringify(
      records
        .filter((record) => record.kind === 'evidence')
        .map((record) => [record.id, revision(record)]),
    );
    if (signature !== this.signature) {
      this.passages = projectPassages(records);
      this.signature = signature;
    }
  }
  search(query: string, limit?: number): Array<{ passage: Passage; score: number }> {
    return lexicalRetrieve(query, this.passages, limit);
  }
}
