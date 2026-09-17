// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const config = {
  provider: 'amap' as const,
  amap: { key: 'test-key', serviceHost: 'https://example.test/proxy' },
};
const api = () => ({
  version: '2.0.5',
  Map: class {},
  Marker: class {},
  Polyline: class {},
  InfoWindow: class {},
});
let createAMapProvider: typeof import('../../src/browser/providers/amap').createAMapProvider;
let vendor: { reset(): void };
let scripts: HTMLScriptElement[];
let append: MockInstance<typeof document.body.appendChild>;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function respond(script: HTMLScriptElement, error?: string) {
  // A JSONP response looks up its URL's fixed global callback when it executes.
  const name = new URL(script.src).searchParams.get('callback')!;
  const callback: unknown = Reflect.get(window, name);
  expect(typeof callback).toBe('function');
  Reflect.apply(callback as (...args: unknown[]) => void, window, error ? [error] : []);
}
async function timeoutFirst() {
  const first = createAMapProvider(config);
  const rejected = expect(first).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(20_000);
  await rejected;
  return scripts[0]!;
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vendor = (await import('@amap/amap-jsapi-loader')).default as unknown as typeof vendor;
  vendor.reset();
  scripts = [];
  append = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    scripts.push(node as HTMLScriptElement);
    return node;
  });
  ({ createAMapProvider } = await import('../../src/browser/providers/amap'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  for (const key of ['AMap', 'AMapUI', 'Loca', '_AMapSecurityConfig', '___onAPILoaded'])
    Reflect.deleteProperty(window, key);
  Reflect.deleteProperty(window, Symbol.for('hexo-post-map.amap-attempt.v1'));
  Reflect.deleteProperty(window, Symbol.for('hexo-post-map.amap-terminal.v1'));
});

describe('real vendor loader JSONP transport', () => {
  it.each(['callback error', 'script error'])(
    'allows a same-page retry after an explicit %s',
    async (kind) => {
      const reset = vi.spyOn(vendor, 'reset');
      const first = createAMapProvider(config);
      const rejected = expect(first).rejects.toBeDefined();
      if (kind === 'callback error') respond(scripts[0]!, 'rejected request');
      else Reflect.apply(scripts[0]!.onerror!, scripts[0], [new Event('error')]);
      await rejected;
      expect(reset).toHaveBeenCalledTimes(1);
      const next = createAMapProvider(config);
      expect(scripts).toHaveLength(2);
      const fresh = scripts[1]!;
      expect(new URL(fresh.src).searchParams.get('v')).toBe('2.0');
      Reflect.set(window, 'AMap', api());
      respond(fresh);
      await expect(next).resolves.toHaveProperty('mountDetail');
    },
  );

  it('never starts a second request after timeout or reuses a late SDK after fixed-name JSONP', async () => {
    const reset = vi.spyOn(vendor, 'reset');
    const old = await timeoutFirst();
    let outcome = 'pending';
    void createAMapProvider(config).then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );
    await flush();
    expect(outcome).toBe('rejected');
    expect(scripts).toHaveLength(1);
    const lateSdk = api();
    Reflect.set(window, 'AMap', lateSdk);
    respond(old);
    await flush();
    await expect(createAMapProvider(config)).rejects.toThrow('reload page');
    expect(Reflect.get(window, 'AMap')).toBe(lateSdk);
    expect(scripts).toHaveLength(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not reset or remove external globals when onerror arrives after timeout', async () => {
    const reset = vi.spyOn(vendor, 'reset');
    const old = await timeoutFirst();
    const external = { AMap: api(), AMapUI: {}, Loca: {} };
    Object.entries(external).forEach(([key, value]) => Reflect.set(window, key, value));
    Reflect.apply(old.onerror!, old, [new Event('error')]);
    await flush();
    await expect(createAMapProvider(config)).rejects.toThrow('reload page');
    for (const [key, value] of Object.entries(external))
      expect(Reflect.get(window, key)).toBe(value);
    expect(reset).not.toHaveBeenCalled();
    expect(scripts).toHaveLength(1);
  });

  it('does not replace an external fixed callback on timeout', async () => {
    const pending = createAMapProvider(config);
    const rejected = expect(pending).rejects.toThrow('timed out');
    const external = vi.fn();
    Reflect.set(window, '___onAPILoaded', external);
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(Reflect.get(window, '___onAPILoaded')).toBe(external);
    expect(external).not.toHaveBeenCalled();
  });

  it('leaves the original appendChild method and descriptor intact when append throws', async () => {
    append.mockImplementation(() => {
      throw new Error('append failed');
    });
    const previous = Object.getOwnPropertyDescriptor(document.body, 'appendChild');
    await expect(createAMapProvider(config)).rejects.toThrow('append failed');
    expect(Object.getOwnPropertyDescriptor(document.body, 'appendChild')).toEqual(previous);
    expect(document.body.appendChild).toBe(append);
  });
});
