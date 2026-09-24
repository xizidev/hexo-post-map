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
      mapStyle: 'amap://styles/normal',
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
      mapStyle: 'amap://styles/normal',
      serviceHost: 'https://proxy.example.test/amap',
    });
  });

  it.each([
    'normal',
    'dark',
    'light',
    'whitesmoke',
    'fresh',
    'grey',
    'graffiti',
    'macaron',
    'blue',
    'darkblue',
    'wine',
  ])('normalizes the official AMap style %s', (mapStyle) => {
    const config = resolveConfig(
      { ...validConfig, amap: { ...validConfig.amap, map_style: mapStyle } },
      {},
    );

    expect(config?.amap.mapStyle).toBe(`amap://styles/${mapStyle}`);
  });

  it('preserves a complete custom AMap style URI', () => {
    const custom = resolveConfig(
      {
        ...validConfig,
        amap: {
          ...validConfig.amap,
          map_style: 'amap://styles/d6bf8c1d69cea9f5c696185ad4ac4c86',
        },
      },
      {},
    );

    expect(custom?.amap.mapStyle).toBe('amap://styles/d6bf8c1d69cea9f5c696185ad4ac4c86');
  });

  it.each([
    'night',
    'https://example.com/style',
    'amap://styles/',
    'amap://styles/dark?variant=1',
    'amap://styles/dark#variant',
    'amap://styles/dark/extra',
    ' dark',
    'dark ',
    null,
    1,
  ])('rejects an unsupported AMap style: %s', (mapStyle) => {
    expectConfigError(
      { ...validConfig, amap: { ...validConfig.amap, map_style: mapStyle } },
      'amap.map_style',
    );
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

  it('accepts AMap zoom boundaries and finite fractional zoom values', () => {
    const boundaries = resolveConfig(
      { ...validConfig, post: { default_zoom: 2 }, cluster: { max_zoom: 20 } },
      {},
    );
    const fractional = resolveConfig(
      { ...validConfig, post: { default_zoom: 11.5 }, cluster: { max_zoom: 19.5 } },
      {},
    );

    expect(boundaries?.post.defaultZoom).toBe(2);
    expect(boundaries?.cluster.maxZoom).toBe(20);
    expect(fractional?.post.defaultZoom).toBe(11.5);
    expect(fractional?.cluster.maxZoom).toBe(19.5);
  });

  it('accepts any positive finite cluster grid size', () => {
    expect(
      resolveConfig({ ...validConfig, cluster: { grid_size: 1024 } }, {})?.cluster.gridSize,
    ).toBe(1024);
    expect(
      resolveConfig({ ...validConfig, cluster: { grid_size: 0.5 } }, {})?.cluster.gridSize,
    ).toBe(0.5);
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
    expectConfigError({ ...validConfig, post: { default_zoom: 1.999 } }, 'post.default_zoom');
    expectConfigError({ ...validConfig, cluster: { max_zoom: 20.001 } }, 'cluster.max_zoom');
    expectConfigError({ ...validConfig, post: { default_zoom: Number.NaN } }, 'post.default_zoom');
    expectConfigError(
      { ...validConfig, cluster: { max_zoom: Number.POSITIVE_INFINITY } },
      'cluster.max_zoom',
    );
    expectConfigError({ ...validConfig, cluster: { grid_size: 0 } }, 'cluster.grid_size');
    expectConfigError({ ...validConfig, cluster: { grid_size: -0.5 } }, 'cluster.grid_size');
    expectConfigError({ ...validConfig, cluster: { grid_size: Number.NaN } }, 'cluster.grid_size');
    expectConfigError(
      { ...validConfig, cluster: { grid_size: Number.POSITIVE_INFINITY } },
      'cluster.grid_size',
    );
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
