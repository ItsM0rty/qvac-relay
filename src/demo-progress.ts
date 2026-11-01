import { type ChildProcess } from 'node:child_process';

const TAIL_LIMIT = 16 * 1024;
export interface PeerReady {
  event: 'peer-ready';
  owner: string;
  p2pPort: number;
}
/** Incremental JSON object framing handles both pretty-printed and line-oriented output. */
export class ReadyParser {
  private buffer = '';
  private depth = 0;
  private quoted = false;
  private escaped = false;
  push(chunk: string): PeerReady | undefined {
    for (const char of chunk) {
      if (!this.depth) {
        if (char !== '{') continue;
        this.buffer = '';
        this.quoted = false;
        this.escaped = false;
      }
      this.buffer += char;
      if (this.buffer.length > TAIL_LIMIT) {
        this.buffer = '';
        this.depth = 0;
        this.quoted = false;
        continue;
      }
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') this.quoted = false;
      } else if (char === '"') this.quoted = true;
      else if (char === '{') this.depth++;
      else if (char === '}' && --this.depth === 0) {
        try {
          const value: unknown = JSON.parse(this.buffer);
          if (
            typeof value === 'object' &&
            value !== null &&
            'event' in value &&
            value.event === 'peer-ready' &&
            'owner' in value &&
            typeof value.owner === 'string' &&
            'p2pPort' in value &&
            typeof value.p2pPort === 'number' &&
            Number.isInteger(value.p2pPort) &&
            value.p2pPort > 0
          )
            return value as PeerReady;
        } catch {
          /* Ignore unrelated output. */
        }
      }
    }
    return undefined;
  }
}
export function waitForPeerReady(child: ChildProcess, timeoutMs = 45_000): Promise<PeerReady> {
  return new Promise((resolve, reject) => {
    const parser = new ReadyParser();
    let tail = '';
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', stdout);
      child.stderr?.off('data', stderr);
      child.off('error', error);
      child.off('exit', exit);
    };
    const fail = (reason: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(reason);
      }
    };
    const stdout = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-TAIL_LIMIT);
      const ready = parser.push(chunk.toString());
      if (ready && !settled) {
        settled = true;
        cleanup();
        resolve(ready);
      }
    };
    const stderr = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-TAIL_LIMIT);
    };
    const error = (e: Error) => fail(e);
    const exit = (code: number | null, signal: NodeJS.Signals | null) =>
      fail(new Error(`Peer exited before ready (${code ?? signal}): ${tail}`));
    const timer = setTimeout(() => fail(new Error(`Peer startup timed out: ${tail}`)), timeoutMs);
    child.stdout?.on('data', stdout);
    child.stderr?.on('data', stderr);
    child.once('error', error);
    child.once('exit', exit);
    if (child.exitCode !== null || child.signalCode !== null)
      exit(child.exitCode, child.signalCode);
  });
}
export async function stopChild(child: ChildProcess, graceMs = 15_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimeout(timer);
      resolve();
      return;
    }
    child.kill('SIGTERM');
  });
}
export class DemoProgress {
  private last = '';
  private lastAt = 0;
  constructor(
    private readonly emit: (line: string) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}
  event(message: string): void {
    this.emit(`[relay] ${message}`);
  }
  status(
    phase: string,
    status: {
      active?: boolean;
      cases?: Array<{
        id?: string;
        checkpoint?: { status?: string; calls?: number; repairs?: number; requestIds?: string[] };
      }>;
    },
    caseId: string,
  ): void {
    const cp = status.cases?.find((c) => c.id === caseId)?.checkpoint;
    const summary = `${phase}: ${status.active ? 'working' : 'idle'}${cp ? `, checkpoint=${cp.status ?? 'unknown'}, calls=${cp.calls ?? 0}, repairs=${cp.repairs ?? 0}, requests=${cp.requestIds?.length ?? 0}` : ', waiting for checkpoint'}`;
    const now = this.now();
    if (summary !== this.last) {
      this.emit(`[relay] ${summary}`);
      this.last = summary;
      this.lastAt = now;
    } else if (now - this.lastAt >= 30_000) {
      this.emit(`[relay] ${summary}; waiting ${Math.floor((now - this.lastAt) / 1000)}s`);
      this.lastAt = now;
    }
  }
}
