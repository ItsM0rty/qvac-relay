import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { controlPost } from '../src/control-client.js';

async function server(
  handler: RequestListener,
  body: (control: { port: number; token: string }) => Promise<void>,
) {
  const service = createServer(handler);
  service.listen(0, '127.0.0.1');
  await once(service, 'listening');
  const address = service.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await body({ port: address.port, token: 'local-test-token' });
  } finally {
    service.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      service.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('delayed headers succeed within the wall-clock deadline with loopback command and auth', async () => {
  await server(
    (req, res) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/command');
      assert.equal(req.headers.authorization, 'Bearer local-test-token');
      assert.equal(req.headers['content-type'], 'application/json');
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () =>
        setTimeout(() => {
          assert.deepEqual(JSON.parse(body), { command: 'status' });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }, 150),
      );
    },
    async (control) => {
      assert.deepEqual(await controlPost(control, { command: 'status' }, { timeoutMs: 1500 }), {
        ok: true,
      });
    },
  );
});

test('wall-clock timeout covers headers and response body', async () => {
  await server(
    (_req, res) => {
      res.writeHead(200);
      res.write('{"slow":');
    },
    async (control) => {
      await assert.rejects(controlPost(control, {}, { timeoutMs: 150 }), /timed out/i);
    },
  );
  await server(
    () => {},
    async (control) => {
      await assert.rejects(controlPost(control, {}, { timeoutMs: 150 }), /timed out/i);
    },
  );
});

test('abort before request and during response rejects and tears down the connection', async () => {
  const early = new AbortController();
  early.abort();
  await assert.rejects(controlPost({ port: 1, token: 'token' }, {}, { signal: early.signal }), {
    name: 'AbortError',
  });
  await server(
    (_req, res) => {
      res.writeHead(200);
      res.write('{');
    },
    async (control) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 150);
      try {
        await assert.rejects(
          controlPost(control, {}, { timeoutMs: 1500, signal: controller.signal }),
          { name: 'AbortError' },
        );
      } finally {
        clearTimeout(timer);
      }
    },
  );
});

test('non-2xx JSON details, malformed JSON, and oversized responses reject', async () => {
  await server(
    (_req, res) => {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'already running' }));
    },
    async (control) => {
      await assert.rejects(controlPost(control, {}), /409.*already running/);
    },
  );
  await server(
    (_req, res) => {
      res.end('{invalid');
    },
    async (control) => {
      await assert.rejects(controlPost(control, {}), /malformed json/i);
    },
  );
  await server(
    (_req, res) => {
      res.end('x'.repeat(8 * 1024 * 1024 + 1));
    },
    async (control) => {
      await assert.rejects(controlPost(control, {}, { timeoutMs: 5000 }), /8 MiB/);
    },
  );
});
