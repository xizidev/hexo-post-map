import type { BrowserProviderConfig } from '../browser/providers/types';

export type AuthorBootstrap =
  | { version: 1; mode: 'map'; mapConfig: BrowserProviderConfig; defaultZoom: number }
  | { version: 1; mode: 'manual'; message: string };

type DataObject = Record<string, unknown>;

function objectWithFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is DataObject {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    required.every((field) => Object.hasOwn(value, field)) &&
    Object.keys(value).every((field) => required.includes(field) || optional.includes(field))
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readMapConfig(raw: unknown): BrowserProviderConfig | undefined {
  if (!objectWithFields(raw, ['provider', 'amap']) || raw.provider !== 'amap') return;
  const amap = raw.amap;
  if (
    !objectWithFields(amap, ['key', 'mapStyle'], ['serviceHost', 'securityJsCode']) ||
    !nonEmptyString(amap.key) ||
    typeof amap.mapStyle !== 'string' ||
    !/^amap:\/\/styles\/[A-Za-z0-9_-]+$/u.test(amap.mapStyle)
  )
    return;

  const hasServiceHost = Object.hasOwn(amap, 'serviceHost');
  const hasSecurityCode = Object.hasOwn(amap, 'securityJsCode');
  if (hasServiceHost === hasSecurityCode) return;
  const shared = { key: amap.key, mapStyle: amap.mapStyle };
  if (hasServiceHost) {
    if (!nonEmptyString(amap.serviceHost)) return;
    const url = new URL(amap.serviceHost);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return;
    return { provider: 'amap', amap: { ...shared, serviceHost: amap.serviceHost } };
  }
  if (!nonEmptyString(amap.securityJsCode)) return;
  return { provider: 'amap', amap: { ...shared, securityJsCode: amap.securityJsCode } };
}

/** Browser-safe parser for the minimal authoring wire protocol. */
export function readAuthorBootstrap(raw: unknown): AuthorBootstrap {
  try {
    if (objectWithFields(raw, ['version', 'mode', 'message'])) {
      if (raw.version === 1 && raw.mode === 'manual' && nonEmptyString(raw.message)) {
        return { version: 1, mode: 'manual', message: raw.message };
      }
    }
    if (objectWithFields(raw, ['version', 'mode', 'mapConfig', 'defaultZoom'])) {
      const mapConfig = readMapConfig(raw.mapConfig);
      if (
        raw.version === 1 &&
        raw.mode === 'map' &&
        mapConfig &&
        typeof raw.defaultZoom === 'number' &&
        Number.isFinite(raw.defaultZoom) &&
        raw.defaultZoom >= 2 &&
        raw.defaultZoom <= 20
      ) {
        return { version: 1, mode: 'map', mapConfig, defaultZoom: raw.defaultZoom };
      }
    }
  } catch {
    // Invalid URL/getter errors must not disclose arbitrary input strings.
  }
  throw new Error('Invalid author bootstrap.');
}
