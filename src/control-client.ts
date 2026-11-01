import { request, type IncomingMessage } from 'node:http';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 720_000;

/** Send a bounded JSON command to the authenticated local control server. */
export function controlPost<T>(
  control: { port: number; token: string },
  body: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return Promise.reject(new Error('Invalid control deadline'));
  let payload: string;
  try {
    const encoded = JSON.stringify(body);
    if (encoded === undefined) throw new Error('Control command must be JSON serializable');
    payload = encoded;
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let response: IncomingMessage | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      response?.destroy();
      req.destroy();
      reject(error);
    };
    const abort = () => {
      const error = new Error('Control request cancelled');
      error.name = 'AbortError';
      fail(error);
    };
    if (options.signal?.aborted) {
      const error = new Error('Control request cancelled');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const req = request(
      {
        hostname: '127.0.0.1',
        port: control.port,
        path: '/command',
        method: 'POST',
        headers: {
          authorization: `Bearer ${control.token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        response = res;
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (part: Buffer) => {
          bytes += part.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            fail(new Error('Control response exceeds 8 MiB'));
            return;
          }
          chunks.push(part);
        });
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('Control response aborted')));
        res.on('end', () => {
          if (settled) return;
          let value: unknown;
          try {
            value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            fail(new Error('Malformed JSON in control response'));
            return;
          }
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            fail(new Error(`Control HTTP ${res.statusCode ?? 0}: ${JSON.stringify(value)}`));
            return;
          }
          settled = true;
          cleanup();
          resolve(value as T);
        });
      },
    );
    req.on('error', fail);
    options.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(
      () => fail(new Error(`Control request timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
    req.end(payload);
  });
}
