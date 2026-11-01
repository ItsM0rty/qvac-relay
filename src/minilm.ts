import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Candidate, Selection, Selector } from './context.js';
import { checkCancelled, RelayError } from './policy.js';
import { stableId } from './records.js';

export const MINILM = Object.freeze({
  model: 'Xenova/ms-marco-MiniLM-L-6-v2',
  revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec',
  runtime: '@huggingface/transformers@4.3.2',
  dtype: 'int8' as const,
  limit: 512,
  batch: 4,
  maxCandidates: 12,
  threads: 2,
  version: 1,
});
export const MINILM_FILES = Object.freeze({
  'config.json': 'd827779a72d27ae68cf878a6fc2e954542663fe21ca515d9f4783fc96be2d37e',
  'tokenizer_config.json': '0b29c7bfc889e53b36d9dd3e686dd4300f6525110eaa98c76a5dafceb2029f53',
  'tokenizer.json': 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66',
  'onnx/model_int8.onnx': 'a13ec391ca99f49886694e12d3e800521f36d4267d7d448c34421c541a2baf50',
});
export function minilmDirectory(): string {
  return resolve(
    process.env.RELAY_RANKER_CACHE ?? '.relay/reranker-cache',
    MINILM.model,
    MINILM.revision,
  );
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Explicit one-time download. Inference never silently contacts the model hub. */
export async function prepareMiniLM(signal: AbortSignal): Promise<void> {
  for (const [file, sha] of Object.entries(MINILM_FILES)) {
    checkCancelled(signal);
    const path = join(minilmDirectory(), file);
    try {
      if (hash(await readFile(path)) === sha) continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const response = await fetch(
      `https://huggingface.co/${MINILM.model}/resolve/${MINILM.revision}/${file}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) },
    );
    if (!response.ok) throw new Error(`MiniLM download ${file}: HTTP${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 25_000_000 || hash(bytes) !== sha)
      throw new Error(`MiniLM checksum mismatch: ${file}`);
    checkCancelled(signal);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, bytes);
    await rename(`${path}.tmp`, path);
  }
}
export interface RankRuntime {
  score(query: string, passages: Candidate[]): Promise<{ scores: number[]; pairTokens: number[] }>;
  dispose(): Promise<void>;
}
export type RankLoader = () => Promise<RankRuntime>;
export async function loadMiniLM(): Promise<RankRuntime> {
  const directory = minilmDirectory();
  for (const [file, sha] of Object.entries(MINILM_FILES)) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(directory, file));
    } catch {
      throw new Error(
        'MiniLM is not prepared. Run npm run ranker:prepare before offline inference.',
      );
    }
    if (hash(bytes) !== sha) throw new Error(`MiniLM artifact checksum mismatch: ${file}`);
  }
  const { AutoTokenizer, AutoModelForSequenceClassification } =
    await import('@huggingface/transformers');
  const tokenizer = await AutoTokenizer.from_pretrained(directory, { local_files_only: true });
  const model = await AutoModelForSequenceClassification.from_pretrained(directory, {
    local_files_only: true,
    dtype: 'int8',
    device: 'cpu',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  return {
    score: async (query, passages) => {
      const inputs = tokenizer(
        passages.map(() => query),
        {
          text_pair: passages.map((p) => `${p.title}\n${p.text}`),
          padding: true,
          truncation: false,
        },
      );
      const tokens = inputs.input_ids.dims[1];
      if (tokens === undefined || tokens > MINILM.limit)
        throw new RelayError(
          'RANK_INPUT_LIMIT',
          'Combined query and passage exceed512 tokens. No passage tail was truncated.',
        );
      const { logits } = await model(inputs);
      if (logits.dims.length !== 2 || logits.dims[0] !== passages.length || logits.dims[1] !== 1)
        throw new Error('MiniLM must return one raw scalar logit per query-passage pair.');
      return { scores: Array.from(logits.data, Number), pairTokens: passages.map(() => tokens) };
    },
    dispose: async () => {
      await model.dispose();
    },
  };
}
/** Relevance logits only order optional passages; permissions and required context are external. */
export class MiniLMSelector implements Selector {
  readonly configuration = MINILM;
  private active?: Promise<Selection>;
  private resource?: RankRuntime;
  private closed = false;
  private failure?: RelayError;
  private readonly shutdown = new AbortController();
  private readonly cache = new Map<string, Selection>();
  constructor(private readonly loader: RankLoader = loadMiniLM) {}
  select(query: string, candidates: Candidate[], signal: AbortSignal): Promise<Selection> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('MiniLM selector is closed'));
    if (this.active) return Promise.reject(new Error('MiniLM permits one ranking at a time'));
    const operation = this.run(query, candidates, AbortSignal.any([signal, this.shutdown.signal]));
    this.active = operation;
    void operation.then(
      () => {
        this.active = undefined;
      },
      () => {
        this.active = undefined;
      },
    );
    return operation;
  }
  private async run(
    query: string,
    candidates: Candidate[],
    signal: AbortSignal,
  ): Promise<Selection> {
    checkCancelled(signal);
    if (
      query.length > 1500 ||
      candidates.length > 12 ||
      new Set(candidates.map((c) => c.id)).size !== candidates.length
    )
      throw new Error('MiniLM input outside bounded query/candidate contract');
    const key = stableId(JSON.stringify(MINILM), query, JSON.stringify(candidates));
    const cached = this.cache.get(key);
    if (cached)
      return { ...structuredClone(cached), usage: { cacheHit: true, model: MINILM, rankingMs: 0 } };
    if (!candidates.length)
      return { ids: [], policy: 'minilm-int8-v1', usage: { decisionCalls: 0, cacheHit: false } };
    const started = performance.now();
    const scores: number[] = [],
      batchMs: number[] = [],
      pairTokens: number[] = [];
    let loadMs = 0;
    try {
      this.resource = await this.loader();
      loadMs = performance.now() - started;
      checkCancelled(signal);
      for (let i = 0; i < candidates.length; i += MINILM.batch) {
        checkCancelled(signal);
        const batch = candidates.slice(i, i + MINILM.batch);
        const before = performance.now();
        const result = await this.resource.score(query, batch);
        checkCancelled(signal);
        if (
          result.scores.length !== batch.length ||
          result.scores.some((score) => !Number.isFinite(score)) ||
          result.pairTokens.length !== batch.length ||
          result.pairTokens.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 512)
        )
          throw new Error('MiniLM returned malformed scores or token counts');
        scores.push(...result.scores);
        pairTokens.push(...result.pairTokens);
        batchMs.push(performance.now() - before);
      }
    } finally {
      await this.release();
    }
    const selection: Selection = {
      ids: candidates
        .map((c, i) => ({ id: c.id, score: scores[i]!, i }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((p) => p.id),
      policy: 'minilm-int8-v1',
      usage: {
        model: MINILM,
        cacheHit: false,
        scores: candidates.map((c, i) => ({ id: c.id, score: scores[i] })),
        pairTokens,
        loadMs,
        batchMs,
        rankingMs: performance.now() - started,
        cancellation:
          'Cooperative before/after ONNX batches; active native batch is awaited, not interrupted',
      },
    };
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, structuredClone(selection));
    return selection;
  }
  private async release(): Promise<void> {
    if (!this.resource) return;
    try {
      await this.resource.dispose();
      this.resource = undefined;
      this.failure = undefined;
    } catch (cause) {
      this.failure = new RelayError(
        'MODEL_RELEASE_FAILED',
        'MiniLM cleanup failed; ranking and generator fallback are quarantined.',
        'infrastructure',
        { cause },
      );
      throw this.failure;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.shutdown.abort();
    await this.active?.catch(() => undefined);
    await this.release();
    this.cache.clear();
  }
}
