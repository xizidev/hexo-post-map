import { DEFAULT_CONFIG } from './defaults';
import type { ResolvedPluginConfig } from './types';

const MIN_ZOOM = 3;
const MAX_ZOOM = 20;
const MIN_GRID_SIZE = 1;
const MAX_GRID_SIZE = 256;
const CSS_LENGTH_PATTERN =
  /^(?:0(?:\.0+)?|(?:\d+(?:\.\d+)?|\.\d+)(?:%|cap|ch|cm|em|ex|ic|in|lh|mm|pc|pt|px|Q|rcap|rch|rem|rex|ric|rlh|rrem|vh|vmax|vmin|vw))$/u;

type ConfigObject = Record<string, unknown>;

export class ConfigValidationError extends Error {
  constructor(
    readonly fieldPath: string,
    reason: string,
  ) {
    super(`[hexo-post-map] ${fieldPath}: ${reason}`);
    this.name = 'ConfigValidationError';
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value;
}

function isConfigObject(value: unknown): value is ConfigObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireConfigObject(value: unknown, fieldPath: string): ConfigObject {
  if (!isConfigObject(value)) {
    throw new ConfigValidationError(fieldPath, 'must be an object');
  }

  return value;
}

function rejectUnknownFields(
  value: ConfigObject,
  fieldPath: string,
  allowed: readonly string[],
): void {
  const unknownField = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownField !== undefined) {
    throw new ConfigValidationError(`${fieldPath}.${unknownField}`, 'is not supported');
  }
}

function optionalBoolean(value: unknown, fieldPath: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new ConfigValidationError(fieldPath, 'must be a boolean');
  }

  return value;
}

function optionalEnum<T extends string>(
  value: unknown,
  fieldPath: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ConfigValidationError(fieldPath, `must be one of: ${allowed.join(', ')}`);
  }

  return value as T;
}

function optionalBoundedInteger(
  value: unknown,
  fieldPath: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigValidationError(fieldPath, `must be an integer from ${minimum} to ${maximum}`);
  }

  return value;
}

function optionalHeight(value: unknown): string {
  if (value === undefined) {
    return DEFAULT_CONFIG.post.height;
  }
  if (typeof value !== 'string' || !CSS_LENGTH_PATTERN.test(value)) {
    throw new ConfigValidationError(
      'post.height',
      'must be a non-negative CSS length or percentage',
    );
  }

  return value;
}

function optionalPath(value: unknown): string {
  if (value === undefined) {
    return DEFAULT_CONFIG.overview.path;
  }
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new ConfigValidationError('overview.path', 'must be a non-empty relative route path');
  }

  const normalizedPath = value.endsWith('/') ? value : `${value}/`;
  if (
    normalizedPath.startsWith('/') ||
    normalizedPath.includes('\\') ||
    /[\u0000-\u001f\u007f?#]/u.test(normalizedPath)
  ) {
    throw new ConfigValidationError('overview.path', 'must be a safe relative route path');
  }

  const segments = normalizedPath.slice(0, -1).split('/');
  if (
    segments.some((segment) => {
      const decodedSegment = decodePathSegment(segment);
      return (
        segment.length === 0 ||
        decodedSegment === '.' ||
        decodedSegment === '..' ||
        decodedSegment.includes('/') ||
        decodedSegment.includes('\\')
      );
    })
  ) {
    throw new ConfigValidationError('overview.path', 'must not contain traversal segments');
  }

  return normalizedPath;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ConfigValidationError('overview.path', 'contains invalid percent encoding');
  }
}

function optionalTitle(value: unknown): string {
  if (value === undefined) {
    return DEFAULT_CONFIG.overview.title;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigValidationError('overview.title', 'must be a non-empty string');
  }

  return value.trim();
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined;
}

function requireCredential(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigValidationError(fieldPath, 'must be a non-empty string');
  }

  return value;
}

function validateServiceHost(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigValidationError('amap.security.service_host', 'must be an absolute HTTPS URL');
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.length === 0 ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new ConfigValidationError(
      'amap.security.service_host',
      'must be an HTTPS URL without embedded credentials',
    );
  }

  return value;
}

function resolveSecurity(
  fileSecurity: ConfigObject | undefined,
  env: NodeJS.ProcessEnv,
): Pick<ResolvedPluginConfig['amap'], 'serviceHost' | 'securityJsCode'> {
  const environmentServiceHost = environmentValue(env, 'HEXO_POST_MAP_AMAP_SERVICE_HOST');
  const environmentSecurityCode = environmentValue(env, 'HEXO_POST_MAP_AMAP_SECURITY_JS_CODE');
  const hasEnvironmentSecurity =
    environmentServiceHost !== undefined || environmentSecurityCode !== undefined;

  const rawServiceHost = hasEnvironmentSecurity
    ? environmentServiceHost
    : fileSecurity?.service_host;
  const rawSecurityCode = hasEnvironmentSecurity
    ? environmentSecurityCode
    : fileSecurity?.security_js_code;

  const hasServiceHost = rawServiceHost !== undefined;
  const hasSecurityCode = rawSecurityCode !== undefined;

  if (hasServiceHost && hasSecurityCode) {
    throw new ConfigValidationError('amap.security', 'must set exactly one security mode');
  }
  if (!hasServiceHost && !hasSecurityCode) {
    throw new ConfigValidationError('amap.security', 'must set exactly one security mode');
  }

  if (hasServiceHost) {
    return {
      serviceHost: validateServiceHost(
        requireCredential(rawServiceHost, 'amap.security.service_host'),
      ),
    };
  }

  return { securityJsCode: requireCredential(rawSecurityCode, 'amap.security.security_js_code') };
}

/**
 * Resolves the explicitly enabled `post_map` configuration without reading Hexo globals.
 * Environment credentials have precedence over file credentials and are never interpolated.
 */
export function resolveConfig(raw: unknown, env: NodeJS.ProcessEnv): ResolvedPluginConfig | null {
  if (!isConfigObject(raw) || raw.enabled !== true) {
    return null;
  }

  rejectUnknownFields(raw, 'post_map', [
    'enabled',
    'provider',
    'post',
    'overview',
    'cluster',
    'amap',
  ]);

  const post = raw.post === undefined ? undefined : requireConfigObject(raw.post, 'post');
  const overview =
    raw.overview === undefined ? undefined : requireConfigObject(raw.overview, 'overview');
  const cluster =
    raw.cluster === undefined ? undefined : requireConfigObject(raw.cluster, 'cluster');
  const amap = requireConfigObject(raw.amap, 'amap');
  const security =
    amap.security === undefined ? undefined : requireConfigObject(amap.security, 'amap.security');

  if (post !== undefined) {
    rejectUnknownFields(post, 'post', ['enabled', 'position', 'height', 'default_zoom']);
  }
  if (overview !== undefined) {
    rejectUnknownFields(overview, 'overview', ['enabled', 'path', 'title', 'layout']);
  }
  if (cluster !== undefined) {
    rejectUnknownFields(cluster, 'cluster', ['grid_size', 'max_zoom']);
  }
  rejectUnknownFields(amap, 'amap', ['key', 'security']);
  if (security !== undefined) {
    rejectUnknownFields(security, 'amap.security', ['service_host', 'security_js_code']);
  }

  const environmentKey = environmentValue(env, 'HEXO_POST_MAP_AMAP_KEY');
  const key = requireCredential(environmentKey ?? amap.key, 'amap.key');
  const resolvedSecurity = resolveSecurity(security, env);

  const resolved: ResolvedPluginConfig = {
    provider: optionalEnum(raw.provider, 'provider', ['amap'], DEFAULT_CONFIG.provider),
    post: {
      enabled: optionalBoolean(post?.enabled, 'post.enabled', DEFAULT_CONFIG.post.enabled),
      position: optionalEnum(
        post?.position,
        'post.position',
        ['before', 'after', 'manual'],
        DEFAULT_CONFIG.post.position,
      ),
      height: optionalHeight(post?.height),
      defaultZoom: optionalBoundedInteger(
        post?.default_zoom,
        'post.default_zoom',
        DEFAULT_CONFIG.post.defaultZoom,
        MIN_ZOOM,
        MAX_ZOOM,
      ),
    },
    overview: {
      enabled: optionalBoolean(
        overview?.enabled,
        'overview.enabled',
        DEFAULT_CONFIG.overview.enabled,
      ),
      path: optionalPath(overview?.path),
      title: optionalTitle(overview?.title),
      layout: optionalEnum(
        overview?.layout,
        'overview.layout',
        ['page', 'standalone'],
        DEFAULT_CONFIG.overview.layout,
      ),
    },
    cluster: {
      gridSize: optionalBoundedInteger(
        cluster?.grid_size,
        'cluster.grid_size',
        DEFAULT_CONFIG.cluster.gridSize,
        MIN_GRID_SIZE,
        MAX_GRID_SIZE,
      ),
      maxZoom: optionalBoundedInteger(
        cluster?.max_zoom,
        'cluster.max_zoom',
        DEFAULT_CONFIG.cluster.maxZoom,
        MIN_ZOOM,
        MAX_ZOOM,
      ),
    },
    amap: { key, ...resolvedSecurity },
  };

  return deepFreeze(resolved);
}
