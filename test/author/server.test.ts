import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection, Server } from 'node:net';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorBootstrap } from '../../src/author/protocol';
import { startAuthorServer, type AuthorServerHandle } from '../../src/author/server';

const bootstrap: AuthorBootstrap = {
  version: 1,
  mode: 'map',
  defaultZoom: 11,
  mapConfig: {
    provider: 'amap',
    amap: { key: 'test-key', mapStyle: 'amap://styles/normal', securityJsCode: 'test-code' },
  },
};
let assetDirectory: string;
const handles: AuthorServerHandle[] = [];

async function start(): Promise<AuthorServerHandle> {
  const handle = await startAuthorServer({ port: 0, assetDirectory, bootstrap });
  handles.push(handle);
  return handle;
}

function session(handle: AuthorServerHandle): string {
  return new URLSearchParams(new URL(handle.url).hash.slice(1)).get('session')!;
}

function expectSafe(headers: Headers): void {
  expect(headers.get('cache-control')).toBe('no-store');
  expect(headers.get('referrer-policy')).toBe('strict-origin');
  expect(headers.get('x-content-type-options')).toBe('nosniff');
  expect(headers.get('x-frame-options')).toBe('DENY');
  expect(headers.get('access-control-allow-origin')).toBeNull();
}

async function rawRequest(handle: AuthorServerHandle, request: string): Promise<string> {
  const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(handle.origin).port) });
  socket.setEncoding('utf8');
  let response = '';
  socket.on('data', (data: string) => {
    response += data;
  });
  await once(socket, 'connect');
  socket.write(request);
  await once(socket, 'close');
  return response;
}

beforeEach(async () => {
  assetDirectory = await mkdtemp(join(tmpdir(), 'hpm-author-server-'));
  await Promise.all([
    writeFile(join(assetDirectory, 'editor.html'), '<!doctype html><title>Editor fixture</title>'),
    writeFile(join(assetDirectory, 'editor.js'), 'console.log("editor fixture");'),
    writeFile(join(assetDirectory, 'editor.css'), 'body { color: black; }'),
    writeFile(join(assetDirectory, 'private.txt'), 'private-file-secret'),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await rm(assetDirectory, { recursive: true, force: true });
});

describe('startAuthorServer', () => {
  it('authorizes canonical browser Host and Origin at HTTP port 80 without a privileged bind', async () => {
    const original = Server.prototype.address;
    let actualPort = 0;
    vi.spyOn(Server.prototype, 'address').mockImplementation(function (this: Server) {
      const address = original.call(this);
      if (address && typeof address !== 'string') {
        actualPort = address.port;
        return { ...address, port: 80 };
      }
      return address;
    });
    const handle = await start();
    expect(handle.origin).toBe('http://127.0.0.1');
    for (const [host, origin, status] of [
      ['127.0.0.1', 'http://127.0.0.1', 200],
      ['127.0.0.1:80', 'http://127.0.0.1', 403],
      ['127.0.0.1', 'http://127.0.0.1:80', 403],
      ['127.0.0.1:080', 'http://127.0.0.1', 403],
    ] as const) {
      const response = await rawRequest(
        { ...handle, origin: `http://127.0.0.1:${actualPort}` },
        `GET /api/bootstrap HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nX-HPM-Editor-Session: ${session(handle)}\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toContain(`HTTP/1.1 ${status}`);
    }
  });
  it('does not expose credentials before authorization', async () => {
    const handle = await start();
    const response = await fetch(handle.origin + '/api/bootstrap');
    expect(response.status).toBe(403);
    expectSafe(response.headers);
    expect(await response.text()).not.toMatch(/test-key|test-code/);
  });

  it('provides a loopback URL with a 256-bit fragment token and authenticated bootstrap', async () => {
    const handle = await start();
    const url = new URL(handle.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.origin).toBe(handle.origin);
    expect(url.search).toBe('');
    expect(session(handle)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(session(handle), 'base64url').byteLength).toBe(32);
    const response = await fetch(handle.origin + '/api/bootstrap', {
      headers: { 'X-HPM-Editor-Session': session(handle), Origin: handle.origin },
    });
    expect(response.status).toBe(200);
    expectSafe(response.headers);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(bootstrap);
  });

  it.each(['wrong-token', 'a'.repeat(43)])(
    'rejects incorrect session %s without reflection',
    async (token) => {
      const handle = await start();
      const response = await fetch(handle.origin + '/api/bootstrap', {
        headers: { 'X-HPM-Editor-Session': token },
      });
      expect(response.status).toBe(403);
      expectSafe(response.headers);
      expect(await response.text()).not.toMatch(/wrong-token|test-key|test-code|a{43}/);
    },
  );

  it('rejects a previous server token after restart', async () => {
    const previous = await start();
    const token = session(previous);
    await previous.close();
    const handle = await start();
    expect(session(handle)).not.toBe(token);
    const response = await fetch(handle.origin + '/api/bootstrap', {
      headers: { 'X-HPM-Editor-Session': token },
    });
    expect(response.status).toBe(403);
  });

  it.each(['localhost', 'localhost:4001', 'evil.example.test', '127.0.0.1:1'])(
    'rejects non-exact Host %s',
    async (host) => {
      const handle = await start();
      const response = await rawRequest(
        handle,
        `GET /api/bootstrap HTTP/1.1\r\nHost: ${host}\r\nX-HPM-Editor-Session: ${session(handle)}\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toContain('403 Forbidden');
      expect(response).not.toMatch(/test-key|test-code|evil\.example\.test/);
    },
  );

  it.each(['missing', 'duplicate'])('rejects %s Host from raw TCP requests', async (variant) => {
    const handle = await start();
    const host = new URL(handle.origin).host;
    const headers = variant === 'missing' ? '' : `Host: ${host}\r\nHost: ${host}\r\n`;
    const response = await rawRequest(
      handle,
      `GET / HTTP/1.1\r\n${headers}Connection: close\r\n\r\n`,
    );
    expect(response).toContain('403 Forbidden');
    expect(response.toLowerCase()).toContain('cache-control: no-store');
  });

  it.each(['https://evil.example.test', 'null', 'http://localhost:4001'])(
    'rejects foreign Origin %s',
    async (origin) => {
      const handle = await start();
      const response = await fetch(handle.origin + '/api/bootstrap', {
        headers: { Origin: origin, 'X-HPM-Editor-Session': session(handle) },
      });
      expect(response.status).toBe(403);
      expectSafe(response.headers);
      expect(await response.text()).not.toMatch(/test-key|test-code|evil|localhost/);
    },
  );

  it.each(['Origin', 'X-HPM-Editor-Session'])('rejects duplicate %s headers', async (name) => {
    const handle = await start();
    const origin =
      name === 'Origin' ? `Origin: ${handle.origin}\r\nOrigin: ${handle.origin}\r\n` : '';
    const token = `X-HPM-Editor-Session: ${session(handle)}\r\n`;
    const response = await rawRequest(
      handle,
      `GET /api/bootstrap HTTP/1.1\r\nHost: ${new URL(handle.origin).host}\r\n${origin}${token}${name === 'Origin' ? '' : token}Connection: close\r\n\r\n`,
    );
    expect(response).toContain('403 Forbidden');
    expect(response).not.toMatch(/test-key|test-code/);
  });

  it.each(['/', '/assets/editor.js', '/assets/editor.css'])(
    'serves only fixed credential-free assets at %s',
    async (path) => {
      const handle = await start();
      const response = await fetch(handle.origin + path);
      expect(response.status).toBe(200);
      expectSafe(response.headers);
      const text = await response.text();
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/test-key|test-code/);
      const head = await fetch(handle.origin + path, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expectSafe(head.headers);
      expect(await head.text()).toBe('');
      expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'));
    },
  );

  it.each(['HEAD', 'POST', 'OPTIONS'])('rejects bootstrap method %s', async (method) => {
    const handle = await start();
    const response = await fetch(handle.origin + '/api/bootstrap', {
      method,
      headers: { 'X-HPM-Editor-Session': session(handle) },
    });
    expect(response.status).toBe(405);
    expectSafe(response.headers);
    expect(await response.text()).not.toMatch(/test-key|test-code/);
  });

  it('rejects static POST', async () => {
    const handle = await start();
    const response = await fetch(handle.origin + '/', { method: 'POST' });
    expect(response.status).toBe(405);
    expectSafe(response.headers);
  });

  it.each([
    '/private.txt',
    '/editor.html',
    '/editor.js',
    '/editor.css',
    '/%2e%2e/private.txt',
    '/%2feditor.js',
    '/assets/editor.js?secret-test-key',
    '/api/bootstrap?session=test-key',
  ])('rejects unknown or encoded path %s without exposing data', async (path) => {
    const handle = await start();
    const response = await rawRequest(
      handle,
      `GET ${path} HTTP/1.1\r\nHost: ${new URL(handle.origin).host}\r\nConnection: close\r\n\r\n`,
    );
    expect(response).toContain('404 Not Found');
    expect(response).not.toMatch(/private-file-secret|test-key|test-code/);
    expect(response.toLowerCase()).toContain('referrer-policy: strict-origin');
  });

  it('sanitizes missing-asset failures', async () => {
    const handle = await start();
    await rm(join(assetDirectory, 'editor.js'));
    const response = await fetch(handle.origin + '/assets/editor.js');
    expect(response.status).toBe(500);
    expectSafe(response.headers);
    expect(await response.text()).not.toContain(assetDirectory);
  });

  it('returns safety headers for parser-level errors', async () => {
    const handle = await start();
    const response = await rawRequest(
      handle,
      `GET / HTTP/1.1\r\nHost: ${new URL(handle.origin).host}\r\nInvalid Header: secret-test-key\r\n\r\n`,
    );
    expect(response).toContain('400 Bad Request');
    expect(response.toLowerCase()).toContain('cache-control: no-store');
    expect(response.toLowerCase()).toContain('referrer-policy: strict-origin');
    expect(response.toLowerCase()).toContain('x-content-type-options: nosniff');
    expect(response.toLowerCase()).toContain('x-frame-options: deny');
    expect(response).not.toContain('secret-test-key');
  });

  it.each(['secret-test-key', '100-continue'])(
    'rejects Expect %s with safe final response without accepting a request body',
    async (expectation) => {
      const handle = await start();
      const response = await rawRequest(
        handle,
        `POST /api/bootstrap HTTP/1.1\r\nHost: ${new URL(handle.origin).host}\r\nExpect: ${expectation}\r\nContent-Length: 9\r\n\r\n`,
      );
      expect(response).not.toContain('100 Continue');
      expect(response.toLowerCase()).toContain('cache-control: no-store');
      expect(response.toLowerCase()).toContain('referrer-policy: strict-origin');
      expect(response.toLowerCase()).toContain('x-content-type-options: nosniff');
      expect(response.toLowerCase()).toContain('x-frame-options: deny');
      expect(response.toLowerCase()).toContain('connection: close');
      expect(response.toLowerCase()).not.toContain('access-control-allow-origin');
      expect(response).toContain('417 Expectation Failed');
      expect(response).not.toMatch(/test-key|test-code/);
    },
  );

  it('closes idempotently, destroys owned partial clients, and releases its port', async () => {
    const handle = await start();
    const port = Number(new URL(handle.origin).port);
    const socket = createConnection({ host: '127.0.0.1', port });
    await once(socket, 'connect');
    socket.write('GET / HTTP/1.1\r\n');
    const errors: string[] = [];
    socket.on('error', (error: NodeJS.ErrnoException) => errors.push(error.code ?? 'unknown'));
    const socketClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await Promise.all([handle.close(), handle.close(), handle.closed, socketClosed]);
    expect(socket.destroyed).toBe(true);
    expect(errors.every((code) => code === 'ECONNRESET')).toBe(true);
    const replacement = await startAuthorServer({ port, assetDirectory, bootstrap });
    handles.push(replacement);
    const response = await fetch(replacement.origin + '/');
    expect(response.status).toBe(200);
  });

  it('fails on an occupied port without disrupting its owner', async () => {
    const handle = await start();
    await expect(
      startAuthorServer({ port: Number(new URL(handle.origin).port), assetDirectory, bootstrap }),
    ).rejects.toMatchObject({ code: 'HPM_AUTHOR_PORT_IN_USE' });
    expect((await fetch(handle.origin + '/')).status).toBe(200);
  });
});
