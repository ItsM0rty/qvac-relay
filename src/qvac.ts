import {
  cancel,
  close as closeSdk,
  completion,
  loadModel,
  toolSchema,
  unloadModel,
  QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4,
  type CompletionRun,
} from '@qvac/sdk';
import { performance } from 'node:perf_hooks';
import { RelayError, SAMPLING } from './policy.js';

type Candidate = '0.6b' | '1.7b';
/** SDK side effects are injectable for lifecycle checks without native inference. */
export interface QvacRuntime {
  load(candidate: Candidate): Promise<string> & { requestId: string };
  completion(
    params: Parameters<typeof completion>[0],
  ): Pick<CompletionRun, 'requestId' | 'events' | 'final'>;
  cancel(requestId: string): Promise<void>;
  unload(modelId: string): Promise<void>;
  close(): Promise<void>;
}
const nativeRuntime: QvacRuntime = {
  load: (candidate) =>
    loadModel({
      modelSrc: candidate === '0.6b' ? QWEN3_600M_INST_Q4 : QWEN3_1_7B_INST_Q4,
      modelType: 'llamacpp-completion',
      modelConfig: { device: 'cpu', ctx_size: 8192, tools: true, parallel: 1 },
      modelFitPolicy: 'log',
    }),
  completion,
  cancel: (requestId) => cancel({ requestId }),
  unload: async (modelId) => {
    await unloadModel({ modelId, clearStorage: false });
  },
  close: closeSdk,
};

function cleanupError(code: string, message: string, cause: unknown): RelayError {
  const error = new RelayError(code, message, 'infrastructure');
  error.cause = cause;
  return error;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ModelReply {
  content: string;
  calls: ToolCall[];
  toolErrors: unknown[];
  stopReason: string;
  stats?: unknown;
}
export interface Model {
  name: string;
  readonly configuration?: Record<string, unknown>;
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
  get configuration(): Record<string, unknown> {
    return {
      sdkVersion: '0.22.0',
      candidate: this.candidate,
      device: 'cpu',
      ctxSize: 8192,
      predict: 768,
      sampling: SAMPLING,
      toolChoice: this.toolChoice,
      parallel: 1,
    };
  }
  readonly measurements = {
    loadMs: 0,
    generationMs: 0,
    calls: 0,
    cancellations: 0,
    cancellationErrors: [] as string[],
  };
  private readonly candidate: '0.6b' | '1.7b';
  private modelId?: string;
  private active?: Promise<ModelReply>;
  private releasing?: Promise<void>;
  private releaseFailure?: RelayError;
  private readonly shutdown = new AbortController();
  private closing?: Promise<void>;
  private closed = false;

  constructor(
    candidate = process.env.RELAY_MODEL ?? '1.7b',
    private readonly toolChoice: 'auto' | 'required' = 'required',
    private readonly runtime: QvacRuntime = nativeRuntime,
  ) {
    if (candidate !== '0.6b' && candidate !== '1.7b') {
      throw new Error('RELAY_MODEL must be 0.6b or 1.7b');
    }
    this.candidate = candidate;
    this.name = `qvac-0.22.0/qwen3-${candidate}-q4/cpu/tools-${toolChoice}`;
  }

  complete(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    if (this.closed) return Promise.reject(new Error('MODEL_CLOSED: adapter is closed'));
    if (this.active) return Promise.reject(new Error('MODEL_BUSY: one inference per adapter'));
    if (this.releasing)
      return Promise.reject(
        new RelayError('MODEL_RELEASING', 'Model cleanup is still in progress.', 'infrastructure'),
      );
    if (this.releaseFailure)
      return Promise.reject(
        cleanupError(
          'MODEL_CLEANUP_REQUIRED',
          'Previous model unload failed. Retry release or close the adapter before generating.',
          this.releaseFailure,
        ),
      );
    const combined = AbortSignal.any([signal, this.shutdown.signal]);
    const operation = this.generate(history, tools, combined);
    this.active = operation;
    // Attach both outcomes without creating a detached rejecting finally promise.
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

  private async cancellable<T>(
    operation: Promise<T>,
    requestId: string,
    signal: AbortSignal,
  ): Promise<T> {
    let requested = false;
    let cancellation: Promise<void> | undefined;
    const abort = () => {
      if (requested) return;
      requested = true;
      this.measurements.cancellations++;
      // Keep awaiting native settlement; a Promise.race would abandon native work.
      cancellation = this.runtime.cancel(requestId).catch((error: unknown) => {
        this.measurements.cancellationErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try {
      return await operation;
    } finally {
      signal.removeEventListener('abort', abort);
      await cancellation;
    }
  }

  private async generate(
    history: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
  ): Promise<ModelReply> {
    signal.throwIfAborted();
    // Validate SDK-shaped definitions before downloading or loading any weights.
    const definitions = tools.map((tool) => toolSchema.parse({ type: 'function', ...tool }));
    const messages = history.map(({ toolCalls, ...message }) => ({
      ...message,
      ...(toolCalls
        ? {
            toolCalls: toolCalls.map((call) => ({
              ...call,
              arguments: objectArguments(call.arguments),
            })),
          }
        : {}),
    }));
    let turnLoadMs = 0;
    if (!this.modelId) {
      const started = performance.now();
      const loading = this.runtime.load(this.candidate);
      this.modelId = await this.cancellable(loading, loading.requestId, signal);
      turnLoadMs = performance.now() - started;
      this.measurements.loadMs += turnLoadMs;
    }
    signal.throwIfAborted();
    const started = performance.now();
    const run = this.runtime.completion({
      modelId: this.modelId,
      history: messages,
      tools: definitions,
      stream: true,
      captureThinking: true,
      generationParams: {
        ...SAMPLING,
        predict: 768,
        parallel_tool_calls: false,
        tool_choice: this.toolChoice,
      },
    });
    this.measurements.calls++;
    let stopReason = 'unknown';
    const events = (async () => {
      for await (const event of run.events)
        if (event.type === 'completionDone') stopReason = event.stopReason ?? 'unknown';
    })();
    const final = await this.cancellable(
      Promise.all([run.final, events]).then(([result]) => result),
      run.requestId,
      signal,
    );
    const generationMs = performance.now() - started;
    this.measurements.generationMs += generationMs;
    signal.throwIfAborted();
    return {
      content: final.contentText,
      calls: final.toolCalls.map(({ id, name, arguments: args }) => ({
        id,
        name,
        arguments: args,
      })),
      toolErrors: final.toolErrors ?? [],
      stopReason,
      stats: {
        ...final.stats,
        loadMs: turnLoadMs,
        generationMs,
        thinkingChars: (final.thinkingText ?? '').length,
        contentChars: final.contentText.length,
      },
    };
  }

  release(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('MODEL_CLOSED: adapter is closed'));
    if (this.active)
      return Promise.reject(new Error('MODEL_BUSY: cannot release active generation'));
    if (this.releasing) return this.releasing;
    if (!this.modelId) return Promise.resolve();
    const id = this.modelId;
    const operation = (async () => {
      try {
        await this.runtime.unload(id);
        // Retain the resource identity until native cleanup actually succeeds.
        this.modelId = undefined;
        this.releaseFailure = undefined;
      } catch (cause) {
        this.releaseFailure = cleanupError(
          'MODEL_RELEASE_FAILED',
          'Native model unload failed; further generation is quarantined.',
          cause,
        );
        throw this.releaseFailure;
      }
    })();
    this.releasing = operation;
    void operation.then(
      () => {
        this.releasing = undefined;
      },
      () => {
        this.releasing = undefined;
      },
    );
    return operation;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.shutdown.abort(new DOMException('Model closed', 'AbortError'));
    this.closing = (async () => {
      await this.active?.catch(() => undefined);
      await this.releasing?.catch(() => undefined);
      const failures: unknown[] = [];
      try {
        if (this.modelId) {
          await this.runtime.unload(this.modelId);
          this.modelId = undefined;
        }
      } catch (error) {
        failures.push(error);
      } finally {
        try {
          await this.runtime.close();
          this.modelId = undefined;
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw cleanupError(
          'MODEL_CLOSE_FAILED',
          'Native model cleanup failed during adapter shutdown.',
          failures.length === 1
            ? failures[0]
            : new AggregateError(failures, 'Unload and SDK shutdown failed'),
        );
    })();
    return this.closing;
  }
}
