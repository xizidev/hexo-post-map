// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTrackAsset } from '../../src/browser/detail/track-data';

const validAsset = {
  version: 1,
  coordinateSystem: 'wgs84',
  segments: [
    [
      [118.7, 32, 15.25],
      [118.8, 32.1],
    ],
  ],
  stats: {
    distanceMeters: 14_320.4,
    elevationGainMeters: 126.8,
    durationSeconds: 4_860,
  },
};

function jsonResponse(
  value: unknown,
  options: { status?: number; contentType?: string; url?: string } = {},
): Response {
  const response = new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers: { 'content-type': options.contentType ?? 'application/json; charset=utf-8' },
  });
  if (options.url !== undefined) Object.defineProperty(response, 'url', { value: options.url });
  return response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

afterEach(() => {
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('loadTrackAsset', () => {
  it('resolves against the document base, fetches with same-origin credentials and returns a fresh deeply frozen asset', async () => {
    document.head.innerHTML = '<base href="/blog/articles/trip/">';
    const source = structuredClone(validAsset);
    const response = {
      ok: true,
      url: '',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => source,
    } as Response;
    const fetcher = vi.fn<typeof fetch>(async () => response);
    const abort = new AbortController();

    const result = await loadTrackAsset(
      '../../hexo-post-map/tracks/hash.json',
      abort.signal,
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      `${window.location.origin}/blog/hexo-post-map/tracks/hash.json`,
      {
        credentials: 'same-origin',
        signal: abort.signal,
      },
    );
    expect(result).toEqual(validAsset);
    expect(result).not.toBe(source);
    expect(result.segments).not.toBe(source.segments);
    expect(result.segments[0]).not.toBe(source.segments[0]);
    expect(result.segments[0]![0]).not.toBe(source.segments[0]![0]);
    expect(result.stats).not.toBe(source.stats);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.segments)).toBe(true);
    expect(Object.isFrozen(result.segments[0])).toBe(true);
    expect(Object.isFrozen(result.segments[0]![0])).toBe(true);
    expect(Object.isFrozen(result.stats)).toBe(true);
  });

  it('accepts a structured JSON media type', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse(validAsset, { contentType: 'application/vnd.hexo-post-map+json' }),
    );

    await expect(
      loadTrackAsset('/track.json', new AbortController().signal, fetcher),
    ).resolves.toEqual(validAsset);
  });

  it.each([
    ['wrong version', { ...validAsset, version: 2 }],
    ['wrong coordinate system', { ...validAsset, coordinateSystem: 'gcj02' }],
    ['unknown root field', { ...validAsset, source: '/private/track.gpx' }],
    ['empty segments', { ...validAsset, segments: [] }],
    ['empty segment', { ...validAsset, segments: [[]] }],
    [
      'no usable segment',
      {
        ...validAsset,
        segments: [
          [
            [118.7, 32],
            [118.7, 32],
          ],
        ],
      },
    ],
    ['short coordinate', { ...validAsset, segments: [[[118.7], [118.8, 32.1]]] }],
    [
      'extra coordinate dimension',
      {
        ...validAsset,
        segments: [
          [
            [118.7, 32, 1, 2],
            [118.8, 32.1],
          ],
        ],
      },
    ],
    [
      'longitude outside WGS84',
      {
        ...validAsset,
        segments: [
          [
            [181, 32],
            [118.8, 32.1],
          ],
        ],
      },
    ],
    [
      'latitude outside WGS84',
      {
        ...validAsset,
        segments: [
          [
            [118.7, -91],
            [118.8, 32.1],
          ],
        ],
      },
    ],
    [
      'invalid elevation',
      {
        ...validAsset,
        segments: [
          [
            [118.7, 32, 'high'],
            [118.8, 32.1],
          ],
        ],
      },
    ],
    ['missing distance', { ...validAsset, stats: {} }],
    ['negative distance', { ...validAsset, stats: { distanceMeters: -1 } }],
    ['unknown statistic', { ...validAsset, stats: { distanceMeters: 1, speed: 2 } }],
  ])('rejects %s without exposing response data', async (_name, body) => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(body));

    const rejection = loadTrackAsset(
      '/PRIVATE_TRACK_NAME.json',
      new AbortController().signal,
      fetcher,
    );

    await expect(rejection).rejects.toThrow('Track data unavailable');
    await expect(rejection).rejects.not.toThrow(/PRIVATE_TRACK_NAME|source|speed|response/i);
  });

  it('rejects more than 2,000 aggregate points', async () => {
    const segments = [
      Array.from({ length: 2_001 }, (_, index) => [118 + index / 100_000, 32] as const),
    ];
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ ...validAsset, segments }));

    await expect(
      loadTrackAsset('/track.json', new AbortController().signal, fetcher),
    ).rejects.toThrow('Track data unavailable');
  });

  it('rejects non-finite JSON numbers', async () => {
    const response = new Response(
      '{"version":1,"coordinateSystem":"wgs84","segments":[[[118,32],[119,33]]],"stats":{"distanceMeters":1e9999}}',
      { headers: { 'content-type': 'application/json' } },
    );
    const fetcher = vi.fn<typeof fetch>(async () => response);

    await expect(
      loadTrackAsset('/track.json', new AbortController().signal, fetcher),
    ).rejects.toThrow('Track data unavailable');
  });

  it.each([
    ['non-success response', jsonResponse(validAsset, { status: 503 })],
    ['non-JSON response', jsonResponse(validAsset, { contentType: 'text/plain' })],
    ['corrupt JSON', new Response('{', { headers: { 'content-type': 'application/json' } })],
    [
      'cross-origin redirect',
      jsonResponse(validAsset, { url: 'https://cdn.example.net/private-track.json' }),
    ],
  ])('normalizes a %s failure to a fixed safe error', async (_name, response) => {
    const fetcher = vi.fn<typeof fetch>(async () => response);

    const rejection = loadTrackAsset(
      '/PRIVATE_TRACK_NAME.json',
      new AbortController().signal,
      fetcher,
    );

    await expect(rejection).rejects.toThrow(/^Track data unavailable$/);
    await expect(rejection).rejects.not.toThrow(/PRIVATE_TRACK_NAME|cdn\.example|503|\{/);
  });

  it('rejects a cross-origin descriptor before issuing a request', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      loadTrackAsset('https://evil.example/track.json', new AbortController().signal, fetcher),
    ).rejects.toThrow('Track data unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a relative descriptor when a cross-origin base changes its resolution', async () => {
    document.head.innerHTML = '<base href="https://evil.example/articles/">';
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      loadTrackAsset('./track.json', new AbortController().signal, fetcher),
    ).rejects.toThrow('Track data unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never resolves successfully when aborted while fetch is pending', async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(() => pending.promise);
    const abort = new AbortController();
    const result = loadTrackAsset('/track.json', abort.signal, fetcher);

    abort.abort();
    pending.resolve(jsonResponse(validAsset));

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects promptly on abort even when an injected fetcher ignores the signal', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const abort = new AbortController();
    const outcome = loadTrackAsset('/track.json', abort.signal, fetcher).then(
      () => 'resolved',
      (error: Error) => error.name,
    );

    abort.abort();
    await Promise.resolve();
    await Promise.resolve();

    await expect(Promise.race([outcome, Promise.resolve('pending')])).resolves.toBe('AbortError');
  });

  it('never resolves successfully when aborted while JSON parsing is pending', async () => {
    const pending = deferred<unknown>();
    const response = {
      ok: true,
      url: '',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => pending.promise,
    } as Response;
    const fetcher = vi.fn<typeof fetch>(async () => response);
    const abort = new AbortController();
    const result = loadTrackAsset('/track.json', abort.signal, fetcher);
    await Promise.resolve();

    abort.abort();
    pending.resolve(validAsset);

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
