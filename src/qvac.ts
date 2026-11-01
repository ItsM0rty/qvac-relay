import {
  cancel, close as closeSdk, completion, loadModel, toolSchema, unloadModel,
  QWEN3_600M_INST_Q4, QWEN3_1_7B_INST_Q4,
} from '@qvac/sdk';
import { performance } from 'node:perf_hooks';

export interface ToolCall { id: string; name: string; arguments: unknown }
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ModelReply {
  content: string;
  calls: ToolCall[];
  toolErrors: unknown[];
  stopReason: string;
  stats?: unknown;
}
export interface Model {
  name: string;
  complete(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply>;
  close(): Promise<void>;
  release?(): Promise<void>;
}

function objectArguments(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Assistant tool-call history arguments must be objects');
  }
  return value as Record<string, unknown>;
}

/** One process owns this adapter and the SDK lifecycle. No cloud fallback. */
export class QvacModel implements Model {
  readonly name: string;
  readonly measurements = {
    loadMs: 0, generationMs: 0, calls: 0, cancellations: 0,
    cancellationErrors: [] as string[],
  };
  private readonly candidate: '0.6b' | '1.7b';
  private modelId?: string;
  private active?: Promise<ModelReply>;
  private readonly shutdown = new AbortController();
  private closing?: Promise<void>;
  private closed = false;

  constructor(candidate = process.env.RELAY_MODEL ?? '0.6b',private readonly toolChoice:'auto'|'required'='required') {
    if (candidate !== '0.6b' && candidate !== '1.7b') {
      throw new Error('RELAY_MODEL must be 0.6b or 1.7b');
    }
    this.candidate = candidate;
    this.name = `qvac-0.22.0/qwen3-${candidate}-q4/cpu/tools-${toolChoice}`;
  }

  complete(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    if (this.closed) return Promise.reject(new Error('MODEL_CLOSED: adapter is closed'));
    if (this.active) return Promise.reject(new Error('MODEL_BUSY: one inference per adapter'));
    const combined = AbortSignal.any([signal, this.shutdown.signal]);
    const operation = this.generate(history, tools, combined);
    this.active = operation;
    // Attach both outcomes without creating a detached rejecting finally promise.
    void operation.then(() => { this.active = undefined; }, () => { this.active = undefined; });
    return operation;
  }

  private async cancellable<T>(operation: Promise<T>, requestId: string, signal: AbortSignal): Promise<T> {
    let requested = false;
    let cancellation:Promise<void>|undefined;
    const abort = () => {
      if (requested) return;
      requested = true;
      this.measurements.cancellations++;
      // Keep awaiting native settlement; a Promise.race would abandon native work.
      cancellation=cancel({ requestId }).catch((error: unknown) => {
        this.measurements.cancellationErrors.push(error instanceof Error ? error.message : String(error));
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try { return await operation; }
    finally { signal.removeEventListener('abort', abort); await cancellation; }
  }

  private async generate(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    signal.throwIfAborted();
    // Validate SDK-shaped definitions before downloading or loading any weights.
    const definitions = tools.map((tool) => toolSchema.parse({ type: 'function', ...tool }));
    const messages = history.map(({ toolCalls, ...message }) => ({
      ...message,
      ...(toolCalls ? { toolCalls: toolCalls.map((call) => ({
        ...call, arguments: objectArguments(call.arguments),
      })) } : {}),
    }));
    let turnLoadMs = 0;
    if (!this.modelId) {
      const started = performance.now();
      const loading = loadModel({
        modelSrc: this.candidate === '0.6b' ? QWEN3_600M_INST_Q4 : QWEN3_1_7B_INST_Q4,
        modelType: 'llamacpp-completion',
        modelConfig: { device: 'cpu', ctx_size: 8192, tools: true, parallel: 1 },
        modelFitPolicy: 'log',
      });
      this.modelId = await this.cancellable(loading, loading.requestId, signal);
      turnLoadMs = performance.now() - started;
      this.measurements.loadMs += turnLoadMs;
    }
    signal.throwIfAborted();
    const started = performance.now();
    const run = completion({
      modelId: this.modelId, history: messages, tools: definitions,
      stream: true, captureThinking: true,
      generationParams: { temp: 0, predict: 768, parallel_tool_calls: false, tool_choice: this.toolChoice },
    });
    this.measurements.calls++;
    let stopReason='unknown';
    const events=(async()=>{for await(const event of run.events)if(event.type==='completionDone')stopReason=event.stopReason??'unknown';})();
    const final = await this.cancellable(Promise.all([run.final,events]).then(([result])=>result), run.requestId, signal);
    const generationMs = performance.now() - started;
    this.measurements.generationMs += generationMs;
    signal.throwIfAborted();
    return {
      content: final.contentText,
      calls: final.toolCalls.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })),
      toolErrors: final.toolErrors ?? [],
      stopReason,
      stats: { ...final.stats, loadMs: turnLoadMs, generationMs },
    };
  }

  async release(): Promise<void> {
    if (this.active) throw new Error('MODEL_BUSY: cannot release active generation');
    if (this.modelId) {const id=this.modelId;this.modelId=undefined;await unloadModel({modelId:id,clearStorage:false});}
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.shutdown.abort(new DOMException('Model closed', 'AbortError'));
    this.closing = (async () => {
      await this.active?.catch(() => undefined);
      try {
        if (this.modelId) await unloadModel({ modelId: this.modelId, clearStorage: false });
      } finally {
        this.modelId = undefined;
        await closeSdk();
      }
    })();
    return this.closing;
  }
}
