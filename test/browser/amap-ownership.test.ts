// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAMapProvider } from '../../src/browser/providers/amap';
import { createProviderLoader } from '../../src/browser/shared/provider-loader';

const sdk = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));
const config = {
  provider: 'amap' as const,
  amap: {
    key: 'key',
    mapStyle: 'amap://styles/normal',
    serviceHost: 'https://example.com/proxy',
  },
};
const globals = ['AMap', 'AMapUI', 'Loca', '_AMapSecurityConfig', '___onAPILoaded'] as const;
const get = (name: string) => Reflect.get(window, name);
const set = (name: string, value: unknown) => Reflect.set(window, name, value);
const api = {
  version: '2.0.5',
  Map: class {},
  Marker: class {},
  Polyline: class {},
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  globals.forEach((key) => Reflect.deleteProperty(window, key));
  sdk.load.mockReset().mockImplementation(async () => {
    set('AMap', api);
    return api;
  });
  sdk.reset.mockReset().mockImplementation(() => {
    for (const name of ['AMap', 'AMapUI', 'Loca']) Reflect.deleteProperty(window, name);
  });
});
afterEach(() => {
  globals.forEach((key) => Reflect.deleteProperty(window, key));
  Reflect.deleteProperty(window, Symbol.for('hexo-post-map.amap-terminal.v1'));
  document.head.replaceChildren();
  vi.useRealTimers();
});

describe('AMap page global ownership', () => {
  it('restores an accessor security descriptor without invoking the host setter', async () => {
    const oldSecurity = { serviceHost: 'https://theme.test/proxy' };
    const setter = vi.fn();
    const descriptor = {
      configurable: true,
      enumerable: false,
      get: () => oldSecurity,
      set: setter,
    };
    Object.defineProperty(window, '_AMapSecurityConfig', descriptor);
    sdk.load.mockRejectedValueOnce(new Error('offline'));
    await expect(createAMapProvider(config)).rejects.toThrow('offline');
    expect(Object.getOwnPropertyDescriptor(window, '_AMapSecurityConfig')).toEqual(descriptor);
    expect(get('_AMapSecurityConfig')).toBe(oldSecurity);
    expect(setter).not.toHaveBeenCalled();
    expect(sdk.reset).toHaveBeenCalledTimes(1);
  });

  it('keeps the page terminal after the current fixed-name callback and old promise arrive late', async () => {
    vi.useFakeTimers();
    const old = deferred<typeof api>();
    const oldCallback = vi.fn();
    sdk.load.mockImplementationOnce(() => {
      set('___onAPILoaded', oldCallback);
      return old.promise;
    });
    const load = createProviderLoader(createAMapProvider);
    const first = load(config);
    await Promise.resolve();
    const rejection = expect(first).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    set('AMap', api);
    const currentCallback = get('___onAPILoaded') as () => void;
    expect(typeof currentCallback).toBe('function');
    currentCallback();
    old.reject(new Error('late rejection'));
    await vi.advanceTimersByTimeAsync(1);
    expect(oldCallback).not.toHaveBeenCalled();
    await expect(load(config)).rejects.toThrow('reload page');
    expect(sdk.load).toHaveBeenCalledTimes(1);
    expect(sdk.reset).not.toHaveBeenCalled();
  });

  it('reuses an existing compatible SDK without changing security or sibling globals', async () => {
    const originals = {
      AMap: api,
      AMapUI: {},
      Loca: {},
      _AMapSecurityConfig: { serviceHost: 'https://theme.test/proxy' },
    };
    Object.entries(originals).forEach(([name, value]) => set(name, value));
    await expect(createAMapProvider(config)).resolves.toHaveProperty('mountDetail');
    for (const [name, value] of Object.entries(originals)) expect(get(name)).toBe(value);
    expect(sdk.load).not.toHaveBeenCalled();
    expect(sdk.reset).not.toHaveBeenCalled();
  });

  it.each([{ ...api, version: '1.4.15' }, { ...api, version: undefined }, { version: '2.0' }])(
    'rejects an incompatible or unverifiable host SDK without mutation (%j)',
    async (existing) => {
      const originals = {
        AMap: existing,
        AMapUI: {},
        Loca: {},
        _AMapSecurityConfig: { securityJsCode: 'theme-code' },
      };
      Object.entries(originals).forEach(([name, value]) => set(name, value));
      await expect(createAMapProvider(config)).rejects.toThrow('existing');
      for (const [name, value] of Object.entries(originals)) expect(get(name)).toBe(value);
      expect(sdk.load).not.toHaveBeenCalled();
      expect(sdk.reset).not.toHaveBeenCalled();
    },
  );

  it('does not take over an incomplete host SDK loading state', async () => {
    const existing = {};
    set('AMapUI', existing);
    await expect(createAMapProvider(config)).rejects.toThrow('existing');
    expect(get('AMapUI')).toBe(existing);
    expect(sdk.load).not.toHaveBeenCalled();
    expect(sdk.reset).not.toHaveBeenCalled();
  });

  it.each([undefined, { serviceHost: 'https://theme.test/proxy' }])(
    'restores the exact prior security state after owned failure (%j)',
    async (security) => {
      if (security !== undefined) set('_AMapSecurityConfig', security);
      sdk.load.mockRejectedValueOnce(new Error('offline'));
      await expect(createAMapProvider(config)).rejects.toThrow('offline');
      expect(get('_AMapSecurityConfig')).toBe(security);
      expect(Object.hasOwn(window, '_AMapSecurityConfig')).toBe(security !== undefined);
      expect(sdk.reset).toHaveBeenCalledTimes(1);
      await expect(createAMapProvider(config)).resolves.toHaveProperty('mountDetail');
    },
  );

  it('leaves replacement host globals and security untouched when a pending load rejects', async () => {
    const pending = deferred<typeof api>();
    sdk.load.mockReturnValueOnce(pending.promise);
    const loading = createAMapProvider(config);
    const replacement = {
      AMap: { ...api },
      AMapUI: {},
      Loca: {},
      _AMapSecurityConfig: { securityJsCode: 'replacement' },
    };
    Object.entries(replacement).forEach(([name, value]) => set(name, value));
    pending.reject(new Error('old failure'));
    await expect(loading).rejects.toThrow();
    for (const [name, value] of Object.entries(replacement)) expect(get(name)).toBe(value);
    expect(sdk.reset).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'requires a page reload after timeout even when the old promise later %s',
    async (late) => {
      vi.useFakeTimers();
      const priorSecurity = { serviceHost: 'https://old.test/proxy' };
      set('_AMapSecurityConfig', priorSecurity);
      const old = deferred<typeof api>();
      sdk.load.mockReturnValueOnce(old.promise);
      const load = createProviderLoader(createAMapProvider);
      const first = load(config);
      const timedOut = expect(first).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(20_000);
      await timedOut;
      expect(get('_AMapSecurityConfig')).toBe(priorSecurity);
      expect(sdk.reset).not.toHaveBeenCalled();
      await expect(load(config)).rejects.toThrow('reload page');
      set('AMap', api);
      if (late === 'resolve') old.resolve({ ...api });
      else old.reject(new Error('late network failure'));
      await vi.advanceTimersByTimeAsync(1);
      expect(get('AMap')).toBe(api);
      expect(get('_AMapSecurityConfig')).toBe(priorSecurity);
      expect(sdk.reset).not.toHaveBeenCalled();
      await expect(load(config)).rejects.toThrow('reload page');
      expect(sdk.load).toHaveBeenCalledTimes(1);
    },
  );

  it('removes only the owned script and leaves a fixed-name tombstone on timeout', async () => {
    vi.useFakeTimers();
    const themeScript = document.createElement('script');
    themeScript.type = 'application/json';
    themeScript.src = 'https://theme.test/app.js';
    document.head.append(themeScript);
    let owned!: HTMLScriptElement;
    sdk.load.mockImplementationOnce(() => {
      owned = document.createElement('script');
      owned.type = 'application/json';
      owned.src = 'https://webapi.amap.com/maps?key=test';
      document.head.append(owned);
      set('___onAPILoaded', () => {});
      return new Promise(() => {});
    });
    const loading = createAMapProvider(config);
    const timedOut = expect(loading).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20_000);
    await timedOut;
    expect(themeScript.isConnected).toBe(true);
    expect(owned.isConnected).toBe(false);
    expect(typeof get('___onAPILoaded')).toBe('function');
    expect(sdk.reset).not.toHaveBeenCalled();
  });
});
