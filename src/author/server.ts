import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';

import { readAuthorBootstrap, type AuthorBootstrap } from './protocol';

export interface AuthorServerHandle {
  origin: string;
  url: string;
  closed: Promise<void>;
  close(): Promise<void>;
}

const SAFETY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'strict-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
const ASSETS: Readonly<Record<string, { filename: string; contentType: string }>> = {
  '/': { filename: 'editor.html', contentType: 'text/html; charset=utf-8' },
  '/assets/editor.js': { filename: 'editor.js', contentType: 'text/javascript; charset=utf-8' },
  '/assets/editor.css': { filename: 'editor.css', contentType: 'text/css; charset=utf-8' },
};

function rawValues(request: IncomingMessage, name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      values.push(request.rawHeaders[index + 1]!);
    }
  }
  return values;
}

function respond(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType = 'text/plain; charset=utf-8',
): void {
  response.writeHead(status, {
    ...SAFETY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

export async function startAuthorServer(options: {
  port: number;
  assetDirectory: string;
  bootstrap: AuthorBootstrap;
}): Promise<AuthorServerHandle> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('Invalid author server port.');
  }
  const bootstrap = JSON.stringify(readAuthorBootstrap(options.bootstrap));
  const token = randomBytes(32).toString('base64url');
  const expectedToken = Buffer.from(token);
  const connections = new Set<Socket>();
  let origin = '';
  let host = '';
  let closing = false;
  const server = createServer(
    { joinDuplicateHeaders: true, requireHostHeader: false },
    (request, response) => {
      const hosts = rawValues(request, 'host');
      const origins = rawValues(request, 'origin');
      if (
        closing ||
        hosts.length !== 1 ||
        hosts[0] !== host ||
        origins.length > 1 ||
        (origins.length === 1 && origins[0] !== origin)
      ) {
        respond(request, response, 403, 'Forbidden.');
        return;
      }

      if (request.url === '/api/bootstrap') {
        if (request.method !== 'GET') {
          respond(request, response, 405, 'Method not allowed.');
          return;
        }
        const sessions = rawValues(request, 'x-hpm-editor-session');
        const candidate = Buffer.from(sessions[0] ?? '');
        if (
          sessions.length !== 1 ||
          candidate.length !== expectedToken.length ||
          !timingSafeEqual(candidate, expectedToken)
        ) {
          respond(request, response, 403, 'Forbidden.');
          return;
        }
        respond(request, response, 200, bootstrap, 'application/json; charset=utf-8');
        return;
      }

      const asset = Object.hasOwn(ASSETS, request.url ?? '') ? ASSETS[request.url!] : undefined;
      if (!asset) {
        respond(request, response, 404, 'Not found.');
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        respond(request, response, 405, 'Method not allowed.');
        return;
      }
      // Only trusted fixed filenames reach the filesystem; raw request paths never do.
      void readFile(join(options.assetDirectory, asset.filename)).then(
        (body) => {
          if (!response.destroyed) respond(request, response, 200, body, asset.contentType);
        },
        () => {
          if (!response.destroyed) respond(request, response, 500, 'Asset unavailable.');
        },
      );
    },
  );
  // No author route consumes request bodies; suppress Node's automatic Expect responses.
  const rejectExpectation = (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Connection', 'close');
    respond(request, response, 417, 'Expectation not supported.');
  };
  server.on('checkExpectation', rejectExpectation);
  server.on('checkContinue', rejectExpectation);
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  server.on('clientError', (_error, socket) => {
    if (!socket.writable) {
      socket.destroy();
      return;
    }
    const headers = Object.entries(SAFETY_HEADERS).map(([name, value]) => `${name}: ${value}`);
    socket.end(
      `HTTP/1.1 400 Bad Request\r\n${headers.join('\r\n')}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 12\r\nConnection: close\r\n\r\nBad request.`,
    );
  });
  const closed = new Promise<void>((resolve) => server.once('close', resolve));
  await new Promise<void>((resolve, reject) => {
    const onError = () => {
      for (const socket of connections) socket.destroy();
      reject(new Error('Unable to start author server.'));
    };
    server.once('error', onError);
    server.listen(options.port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to start author server.');
  }
  host = `127.0.0.1:${address.port}`;
  origin = `http://${host}`;
  return {
    origin,
    url: `${origin}/#session=${token}`,
    closed,
    close() {
      if (!closing) {
        closing = true;
        expectedToken.fill(0);
        server.close();
        server.closeIdleConnections();
        for (const socket of connections) socket.destroy();
      }
      return closed;
    },
  };
}
