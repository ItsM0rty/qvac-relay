import { buildContext } from './context.js';
import { RelayError } from './policy.js';
import type { Message, ToolCall, ToolSpec } from './qvac.js';
import type { RelayRecord } from './records.js';

/** Test the exact current tool group against protected context and protocol budget. */
export async function fitsToolResult(args: {
  task: string;
  records: RelayRecord[];
  requiredIds: string[];
  readIds: string[];
  tools: ToolSpec[];
  assistant: Message;
  results: Message[];
  remainingCalls: ToolCall[];
  budget: number;
  signal: AbortSignal;
  feedback?: string;
}): Promise<boolean> {
  const placeholders: Message[] = args.remainingCalls.map((call) => ({
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: '{}',
  }));
  try {
    await buildContext({
      task: args.task,
      records: args.records,
      requiredIds: args.requiredIds,
      readIds: args.readIds,
      tools: args.tools,
      history: [args.assistant, ...args.results, ...placeholders],
      selector: { select: async () => ({ ids: [], policy: 'tool-budget' }) },
      budget: args.budget,
      signal: args.signal,
      feedback: args.feedback,
    });
    return true;
  } catch (error) {
    if (error instanceof RelayError && error.code === 'CONTEXT_OVERFLOW') return false;
    throw error;
  }
}
