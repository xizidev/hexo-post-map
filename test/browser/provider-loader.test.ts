// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderLoader, loadProvider } from '../../src/browser/shared/provider-loader';
import type { MapProvider } from '../../src/browser/providers/types';

const config = {
  provider: 'amap' as const,
  amap: { key: 'public-key', mapStyle: 'amap://styles/normal', serviceHost: '/proxy' },
};
const provider = { mountDetail: vi.fn(), mountOverview: vi.fn() } satisfies MapProvider;
const factory = vi.hoisted(() => vi.fn());
vi.mock('../../src/browser/providers/amap', () => ({ createAMapProvider: factory }));
afterEach(() => {
  Reflect.deleteProperty(window, Symbol.for('hexo-post-map.provider-loader.v1'));
  factory.mockReset();
});

describe('provider loader', () => {
  it('shares one provider across independent bundle module instances', async () => {
    factory.mockResolvedValue(provider);
    const first = loadProvider(config);
    vi.resetModules();
    const otherBundle = await import('../../src/browser/shared/provider-loader');
    expect(otherBundle.loadProvider(config)).toBe(first);
    expect(await first).toBe(provider);
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it('shares the pending promise and caches a successful provider', async () => {
    const factory = vi.fn(async () => provider);
    const load = createProviderLoader(factory);
    const pending = load(config);
    expect(load(config)).toBe(pending);
    expect(await pending).toBe(provider);
    expect(await load(config)).toBe(provider);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('drops a rejected promise so a subsequent caller can retry', async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(provider);
    const load = createProviderLoader(factory);
    const pending = load(config);
    expect(load(config)).toBe(pending);
    await expect(pending).rejects.toThrow('offline');
    expect(await load(config)).toBe(provider);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('handles synchronous factory failures without poisoning the cache', async () => {
    let attempts = 0;
    const load = createProviderLoader(() => {
      if (++attempts === 1) throw new Error('unavailable');
      return Promise.resolve(provider);
    });
    await expect(load(config)).rejects.toThrow('unavailable');
    expect(await load(config)).toBe(provider);
  });

  it('rejects conflicting credentials without silently sharing a cached provider', async () => {
    const factory = vi.fn(async () => provider);
    const load = createProviderLoader(factory);
    await load(config);
    await expect(load({ ...config, amap: { ...config.amap, key: 'other-key' } })).rejects.toThrow(
      'configuration',
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('rejects conflicting map styles without silently sharing a cached provider', async () => {
    const factory = vi.fn(async () => provider);
    const load = createProviderLoader(factory);
    await load(config);

    await expect(
      load({ ...config, amap: { ...config.amap, mapStyle: 'amap://styles/dark' } }),
    ).rejects.toThrow('configuration');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
