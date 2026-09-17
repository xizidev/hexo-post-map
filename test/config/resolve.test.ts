import { describe, expect, it } from 'vitest';

import { ConfigValidationError, resolveConfig } from '../../src/config/resolve';

const validConfig = {
  enabled: true,
  amap: {
    key: 'file-key',
    security: { security_js_code: 'file-security-code' },
  },
};

function expectConfigError(raw: unknown, fieldPath: string, env: NodeJS.ProcessEnv = {}): Error {
  try {
    resolveConfig(raw, env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    const validationError = error as ConfigValidationError;
    expect(validationError.fieldPath).toBe(fieldPath);
    expect(validationError.message).toContain(fieldPath);
    return validationError;
  }

  throw new Error('expected resolveConfig to throw ConfigValidationError');
}

describe('resolveConfig', () => {
  it('is a no-op without explicit enablement', () => {
    expect(resolveConfig(undefined, {})).toBeNull();
    expect(resolveConfig({ enabled: false }, {})).toBeNull();
    expect(resolveConfig({ enabled: 'true' }, {})).toBeNull();
  });

  it('applies public defaults and environment overrides', () => {
    const config = resolveConfig(validConfig, {
      HEXO_POST_MAP_AMAP_KEY: 'env-key',
      HEXO_POST_MAP_AMAP_SERVICE_HOST: 'https://maps.example.test/',
    });

    expect(config?.post).toMatchObject({ position: 'before', height: '220px', defaultZoom: 11 });
    expect(config?.overview).toMatchObject({ path: 'map/', title: '足迹地图', layout: 'page' });
    expect(config?.cluster).toMatchObject({ gridSize: 60, maxZoom: 18 });
    expect(config?.amap).toMatchObject({
      key: 'env-key',
      serviceHost: 'https://maps.example.test/',
    });
    expect(config?.amap.securityJsCode).toBeUndefined();
  });

  it('uses file credentials when no environment override is present', () => {
    const config = resolveConfig(
      {
        enabled: true,
        amap: {
          key: 'file-key',
          security: { service_host: 'https://proxy.example.test/amap' },
        },
      },
      {},
    );

    expect(config?.amap).toEqual({
      key: 'file-key',
      serviceHost: 'https://proxy.example.test/amap',
    });
  });

  it('returns a deeply immutable resolved configuration', () => {
    const config = resolveConfig(validConfig, {});

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config?.post)).toBe(true);
    expect(Object.isFrozen(config?.overview)).toBe(true);
    expect(Object.isFrozen(config?.cluster)).toBe(true);
    expect(Object.isFrozen(config?.amap)).toBe(true);
  });

  it('requires a non-empty AMap key without leaking the configured security code', () => {
    const securityCode = 'super-secret-code';
    const error = expectConfigError(
      { enabled: true, amap: { security: { security_js_code: securityCode } } },
      'amap.key',
    );

    expect(error.message).not.toContain(securityCode);
  });

  it('requires exactly one security mode without leaking configured values', () => {
    const securityCode = 'super-secret-code';
    const proxyUrl = 'https://proxy.example.test/private';
    const configuredKey = 'super-secret-key';
    const noMode = expectConfigError(
      { enabled: true, amap: { key: configuredKey, security: {} } },
      'amap.security',
    );
    const twoModes = expectConfigError(
      {
        enabled: true,
        amap: {
          key: 'file-key',
          security: { security_js_code: securityCode, service_host: proxyUrl },
        },
      },
      'amap.security',
    );

    expect(noMode.message).not.toContain(configuredKey);
    expect(twoModes.message).not.toContain('file-key');
    expect(twoModes.message).not.toContain(securityCode);
    expect(twoModes.message).not.toContain(proxyUrl);
  });

  it('rejects unsafe overview paths and malformed presentation values', () => {
    expectConfigError({ ...validConfig, overview: { path: '../private/' } }, 'overview.path');
    expectConfigError({ ...validConfig, overview: { path: '%2e%2e%2fprivate/' } }, 'overview.path');
    expectConfigError({ ...validConfig, overview: { path: '/absolute/' } }, 'overview.path');
    expectConfigError(
      { ...validConfig, post: { height: 'url(javascript:alert(1))' } },
      'post.height',
    );
    expectConfigError({ ...validConfig, post: { position: 'middle' } }, 'post.position');
    expectConfigError({ ...validConfig, overview: { layout: 'custom' } }, 'overview.layout');
  });

  it('rejects unsupported providers, unsafe service hosts, and invalid numeric bounds', () => {
    expectConfigError({ ...validConfig, provider: 'google' }, 'provider');
    expectConfigError(
      {
        ...validConfig,
        amap: { key: 'file-key', security: { service_host: 'http://proxy.example.test/' } },
      },
      'amap.security.service_host',
    );
    expectConfigError({ ...validConfig, post: { default_zoom: 2 } }, 'post.default_zoom');
    expectConfigError({ ...validConfig, cluster: { grid_size: 0 } }, 'cluster.grid_size');
    expectConfigError({ ...validConfig, cluster: { max_zoom: 21 } }, 'cluster.max_zoom');
  });

  it('does not interpolate environment syntax in file values', () => {
    const config = resolveConfig(
      {
        enabled: true,
        amap: {
          key: '${HEXO_POST_MAP_AMAP_KEY}',
          security: { security_js_code: 'file-security-code' },
        },
      },
      {},
    );

    expect(config?.amap.key).toBe('${HEXO_POST_MAP_AMAP_KEY}');
  });
});
