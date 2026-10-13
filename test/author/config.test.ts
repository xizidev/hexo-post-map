import { describe, expect, it } from 'vitest';

import { resolveAuthorBootstrap } from '../../src/author/config';
import { readAuthorBootstrap } from '../../src/author/protocol';
import { resolveConfig } from '../../src/config/resolve';

const rawConfig = {
  enabled: false,
  post: { default_zoom: 12 },
  amap: {
    key: 'test-key',
    map_style: 'dark',
    security: { security_js_code: 'test-code' },
  },
};
const mapBootstrap = {
  version: 1,
  mode: 'map',
  defaultZoom: 12,
  mapConfig: {
    provider: 'amap',
    amap: {
      key: 'test-key',
      mapStyle: 'amap://styles/dark',
      securityJsCode: 'test-code',
    },
  },
};

describe('resolveAuthorBootstrap', () => {
  it.each([
    [{ ...rawConfig, amap: { ...rawConfig.amap, key: '' } }, 'amap.key'],
    [
      {
        ...rawConfig,
        amap: {
          ...rawConfig.amap,
          security: { service_host: 'https://example.test', security_js_code: 'hostile-value' },
        },
      },
      'amap.security',
    ],
    [{ ...rawConfig, post: { default_zoom: 'hostile-value' } }, 'post.default_zoom'],
  ])('returns trusted field diagnostics without credentials for %j', (raw, field) => {
    const result = resolveAuthorBootstrap(raw, {});
    expect(result.mode).toBe('manual');
    if (result.mode !== 'manual') throw new Error('Expected manual fallback');
    expect(result.message).toContain(field);
    expect(JSON.stringify(result)).not.toMatch(/hostile-value|test-key|test-code|example/);
    expect(Object.keys(result).sort()).toEqual(['message', 'mode', 'version']);
  });
  it('leaves mutable input and nested objects unfrozen and unchanged', () => {
    const input = structuredClone(rawConfig);
    expect(resolveAuthorBootstrap(input, {})).toEqual(mapBootstrap);
    expect(input).toEqual(rawConfig);
    for (const value of [input, input.post, input.amap, input.amap.security]) {
      expect(Object.isFrozen(value)).toBe(false);
    }
    input.amap.key = 'updated-key';
    expect(resolveAuthorBootstrap(input, {})).toMatchObject({
      mapConfig: { amap: { key: 'updated-key' } },
    });
  });

  it('uses disabled settings without enabling publication or changing frozen input', () => {
    const input = Object.freeze({
      ...rawConfig,
      post: Object.freeze({ ...rawConfig.post }),
      amap: Object.freeze({
        ...rawConfig.amap,
        security: Object.freeze({ ...rawConfig.amap.security }),
      }),
    });
    expect(resolveAuthorBootstrap(input, {})).toEqual(mapBootstrap);
    expect(input.enabled).toBe(false);
    expect(resolveConfig(input, {})).toBeNull();
  });

  it.each([
    undefined,
    null,
    [],
    'test-key',
    {},
    { enabled: false },
    { ...rawConfig, provider: 'unsupported' },
    { ...rawConfig, post: { default_zoom: 21 } },
    { ...rawConfig, overview: { path: '../secret-test-key' } },
    { ...rawConfig, 'secret-test-key': 'test-code' },
    { ...rawConfig, amap: { ...rawConfig.amap, key: '' } },
    { ...rawConfig, amap: { ...rawConfig.amap, security: {} } },
    {
      ...rawConfig,
      amap: {
        ...rawConfig.amap,
        security: {
          service_host: 'https://proxy.example.test/',
          security_js_code: 'test-code',
        },
      },
    },
    {
      ...rawConfig,
      amap: { ...rawConfig.amap, security: { service_host: 'http://secret-test-key/' } },
    },
  ])('returns a credential-free manual payload for invalid/missing input %j', (raw) => {
    const result = resolveAuthorBootstrap(raw, {});
    expect(result).toMatchObject({ version: 1, mode: 'manual', message: expect.any(String) });
    expect(Object.keys(result).sort()).toEqual(['message', 'mode', 'version']);
    expect(JSON.stringify(result)).not.toMatch(/test-key|test-code|proxy|secret/);
  });

  it('honors resolver environment precedence while projecting only browser settings', () => {
    const env = {
      HEXO_POST_MAP_AMAP_KEY: 'env-key',
      HEXO_POST_MAP_AMAP_SERVICE_HOST: 'https://proxy.example.test/amap',
    };
    const resolved = resolveConfig({ ...rawConfig, enabled: true }, env)!;
    const result = resolveAuthorBootstrap(rawConfig, env);
    expect(result).toEqual({
      version: 1,
      mode: 'map',
      defaultZoom: 12,
      mapConfig: {
        provider: 'amap',
        amap: {
          key: 'env-key',
          mapStyle: 'amap://styles/dark',
          serviceHost: 'https://proxy.example.test/amap',
        },
      },
    });
    if (result.mode === 'map') expect(result.mapConfig.amap).toEqual(resolved.amap);
    expect(JSON.stringify(result)).not.toContain('test-code');
  });

  it.each([
    { HEXO_POST_MAP_AMAP_KEY: '' },
    { HEXO_POST_MAP_AMAP_SECURITY_JS_CODE: '' },
    {
      HEXO_POST_MAP_AMAP_SECURITY_JS_CODE: 'test-code',
      HEXO_POST_MAP_AMAP_SERVICE_HOST: 'https://proxy.example.test/',
    },
  ])('uses manual mode for invalid environment overrides %j', (env) => {
    expect(resolveAuthorBootstrap(rawConfig, env).mode).toBe('manual');
  });
});

describe('readAuthorBootstrap', () => {
  it('accepts the minimal map and manual unions', () => {
    expect(readAuthorBootstrap(mapBootstrap)).toEqual(mapBootstrap);
    expect(
      readAuthorBootstrap({ version: 1, mode: 'manual', message: 'Map unavailable.' }),
    ).toEqual({
      version: 1,
      mode: 'manual',
      message: 'Map unavailable.',
    });
    const proxy = {
      ...mapBootstrap,
      mapConfig: {
        provider: 'amap',
        amap: {
          key: 'test-key',
          mapStyle: 'amap://styles/normal',
          serviceHost: 'https://proxy.example.test/amap',
        },
      },
    };
    expect(readAuthorBootstrap(proxy)).toEqual(proxy);
  });

  it.each([
    null,
    [],
    { ...mapBootstrap, version: 2 },
    { ...mapBootstrap, mode: 'unknown' },
    { ...mapBootstrap, site: 'secret-test-key' },
    { ...mapBootstrap, message: 'secret-test-key' },
    { version: 1, mode: 'manual', message: 'Map unavailable.', mapConfig: mapBootstrap.mapConfig },
    { version: 1, mode: 'manual', message: '' },
    { version: 1, mode: 'manual', message: 123 },
    { ...mapBootstrap, defaultZoom: Infinity },
    { ...mapBootstrap, defaultZoom: 1 },
    { ...mapBootstrap, defaultZoom: 21 },
    { ...mapBootstrap, mapConfig: { ...mapBootstrap.mapConfig, overview: 'secret-test-key' } },
    { ...mapBootstrap, mapConfig: { ...mapBootstrap.mapConfig, provider: 'unknown' } },
    {
      ...mapBootstrap,
      mapConfig: { provider: 'amap', amap: { ...mapBootstrap.mapConfig.amap, key: '' } },
    },
    {
      ...mapBootstrap,
      mapConfig: {
        provider: 'amap',
        amap: { ...mapBootstrap.mapConfig.amap, extra: 'secret-test-key' },
      },
    },
    {
      ...mapBootstrap,
      mapConfig: { provider: 'amap', amap: { key: 'test-key', mapStyle: 'amap://styles/normal' } },
    },
    {
      ...mapBootstrap,
      mapConfig: {
        provider: 'amap',
        amap: { ...mapBootstrap.mapConfig.amap, serviceHost: 'https://proxy.example.test/' },
      },
    },
    {
      ...mapBootstrap,
      mapConfig: {
        provider: 'amap',
        amap: { key: 'test-key', mapStyle: 'amap://styles/normal', serviceHost: 'http://secret/' },
      },
    },
    {
      ...mapBootstrap,
      mapConfig: {
        provider: 'amap',
        amap: {
          key: 'test-key',
          mapStyle: 'amap://styles/normal',
          serviceHost: 'https://test-key:test-code@proxy.example.test/',
        },
      },
    },
    {
      ...mapBootstrap,
      mapConfig: {
        provider: 'amap',
        amap: { ...mapBootstrap.mapConfig.amap, mapStyle: 'https://secret-test-key/' },
      },
    },
  ])('rejects non-minimal/invalid input with a fixed sanitized error %j', (raw) => {
    let message = '';
    try {
      readAuthorBootstrap(raw);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      message = (error as Error).message;
    }
    expect(message).toBe('Invalid author bootstrap.');
    expect(message).not.toMatch(/test-key|test-code|proxy|secret/);
  });
});
