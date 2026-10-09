import AMapLoader from '@amap/amap-jsapi-loader';
import type { Coordinate } from '../../domain/types';
import type { BrowserProviderConfig } from './types';

/** Structural SDK surface shared by the separately bundled detail and overview adapters. */
export interface AMapSdkMap {
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  add(overlays: unknown[]): void;
  remove?(overlays: unknown[]): void;
  setFitView(overlays: unknown[], immediately: boolean, padding: number[]): void;
  setStatus(status: Record<string, boolean>): void;
  destroy(): void;
  getZoom(): number;
  getCenter?(): { getLng(): number; getLat(): number };
  setZoomAndCenter?(
    zoom: number,
    center: Coordinate,
    immediately: boolean,
    duration?: number,
  ): void;
  setZoom(zoom: number, immediately: boolean): void;
  setBounds(bounds: unknown, immediately: boolean, padding: number[]): void;
}

export interface AMapSdkApi {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapSdkMap;
  Marker: new (options: Record<string, unknown>) => unknown;
  Polyline: new (options: Record<string, unknown>) => unknown;
  Bounds?: new (southwest: Coordinate, northeast: Coordinate) => unknown;
  Pixel?: new (x: number, y: number) => unknown;
  plugin?(names: string[], ready: () => void): void;
  convertFrom?: unknown;
  MarkerCluster?: unknown;
}

const loader = AMapLoader as unknown as {
  load(options: { key: string; version: string }): Promise<AMapSdkApi>;
  reset(): void;
};

export const AMAP_LOAD_TIMEOUT_MS = 20_000;
const attemptKey = Symbol.for('hexo-post-map.amap-attempt.v1');
const terminalKey = Symbol.for('hexo-post-map.amap-terminal.v1');
const sharedLoadKey = Symbol.for('hexo-post-map.amap-load.v1');

interface SharedLoad {
  readonly identity: string;
  readonly pending: Promise<AMapSdkApi>;
  api?: AMapSdkApi;
}

function configIdentity(config: BrowserProviderConfig): string {
  return JSON.stringify([
    config.provider,
    config.amap.key,
    config.amap.mapStyle,
    config.amap.serviceHost,
    config.amap.securityJsCode,
  ]);
}

// A timed-out JSONP response may still execute. Keep one inert callback, without attempt state.
function ignoreLateApiResponse(): void {}

function existingApi(value: unknown): value is AMapSdkApi {
  if (value === null || typeof value !== 'object') return false;
  const api = value as Record<string, unknown>;
  return (
    typeof api.version === 'string' &&
    /^2(?:\.|$)/u.test(api.version) &&
    ['Map', 'Marker', 'Polyline'].every((name) => typeof api[name] === 'function')
  );
}

function isSdkScript(script: HTMLScriptElement): boolean {
  return /^https:\/\/webapi\.amap\.com\/maps(?:\?|$)/u.test(script.src);
}

/** Own only the request started here, never an SDK or configuration belonging to the theme. */
function startOwnedLoad(config: BrowserProviderConfig): Promise<AMapSdkApi> {
  if (Reflect.get(window, terminalKey)) {
    return Promise.reject(new Error('Map SDK loading timed out; reload page to retry'));
  }
  const currentApi: unknown = Reflect.get(window, 'AMap');
  if (currentApi !== undefined) {
    return existingApi(currentApi)
      ? Promise.resolve(currentApi)
      : Promise.reject(new Error('Cannot reuse existing map SDK'));
  }
  if (
    Reflect.get(window, attemptKey) ||
    ['AMapUI', 'Loca', '___onAPILoaded'].some((key) => Reflect.get(window, key) !== undefined) ||
    Array.from(document.scripts).some(isSdkScript)
  ) {
    return Promise.reject(new Error('Cannot take ownership of existing map SDK loading state'));
  }
  const previousSecurity = Object.getOwnPropertyDescriptor(window, '_AMapSecurityConfig');
  const security =
    config.amap.serviceHost !== undefined
      ? { serviceHost: config.amap.serviceHost }
      : { securityJsCode: config.amap.securityJsCode };
  const attempt = {};
  const scriptsBefore = new Set(document.scripts);
  return new Promise((resolve, reject) => {
    let settled = false;
    let ownedScripts: HTMLScriptElement[] = [];
    let ownedCallback: unknown;
    const timer = window.setTimeout(
      () => fail(new Error('Map SDK loading timed out; reload page to retry'), true),
      AMAP_LOAD_TIMEOUT_MS,
    );
    const ownsAttempt = () => Reflect.get(window, attemptKey) === attempt;
    function release() {
      clearTimeout(timer);
      if (ownsAttempt()) Reflect.deleteProperty(window, attemptKey);
    }
    function fail(error: unknown, terminal = false) {
      if (settled) return;
      settled = true;
      if (terminal) Reflect.set(window, terminalKey, true);
      if (ownsAttempt()) {
        const ownsSecurity = Reflect.get(window, '_AMapSecurityConfig') === security;
        const currentCallback: unknown = Reflect.get(window, '___onAPILoaded');
        const ownsCallback = currentCallback === undefined || currentCallback === ownedCallback;
        ownedScripts.forEach((script) => script.remove());
        if (currentCallback === ownedCallback && ownedCallback !== undefined) {
          if (terminal) Reflect.set(window, '___onAPILoaded', ignoreLateApiResponse);
          else Reflect.deleteProperty(window, '___onAPILoaded');
        }
        // reset() deletes all three SDK globals. Only use it while none has been supplied by another owner.
        if (
          !terminal &&
          ownsSecurity &&
          ownsCallback &&
          ['AMap', 'AMapUI', 'Loca'].every((key) => Reflect.get(window, key) === undefined)
        )
          loader.reset();
        if (ownsSecurity) {
          if (previousSecurity)
            Object.defineProperty(window, '_AMapSecurityConfig', previousSecurity);
          else Reflect.deleteProperty(window, '_AMapSecurityConfig');
        }
      }
      release();
      reject(error);
    }
    try {
      if (
        !Reflect.defineProperty(window, '_AMapSecurityConfig', {
          configurable: previousSecurity?.configurable ?? true,
          enumerable: previousSecurity?.enumerable ?? true,
          writable: true,
          value: security,
        })
      )
        throw new Error('Cannot configure map SDK');
      Reflect.set(window, attemptKey, attempt);
      const pending = loader.load({ key: config.amap.key, version: '2.0' });
      ownedScripts = Array.from(document.scripts).filter(
        (script) => !scriptsBefore.has(script) && isSdkScript(script),
      );
      const callback: unknown = Reflect.get(window, '___onAPILoaded');
      if (typeof callback === 'function') {
        ownedCallback = (...args: unknown[]) => {
          if (!settled && ownsAttempt()) Reflect.apply(callback, window, args);
        };
        Reflect.set(window, '___onAPILoaded', ownedCallback);
      }
      pending.then((api) => {
        if (settled) return;
        const installed: unknown = Reflect.get(window, 'AMap');
        if (!ownsAttempt() || (installed !== undefined && installed !== api)) {
          fail(new Error('Map SDK ownership changed during loading'));
          return;
        }
        settled = true;
        release();
        resolve(api);
      }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Detail and overview ship as separate IIFEs, so module-local promises cannot coordinate them.
 * Keep the configuration identity and in-flight/successful SDK promise on the page instead.
 */
export function loadAMapApi<TApi extends AMapSdkApi>(config: BrowserProviderConfig): Promise<TApi> {
  const page = window as unknown as Record<symbol, SharedLoad | undefined>;
  const identity = configIdentity(config);
  let existing = page[sharedLoadKey];
  if (existing?.api && Reflect.get(window, 'AMap') !== existing.api) {
    Reflect.deleteProperty(page, sharedLoadKey);
    existing = undefined;
  }
  if (existing) {
    return existing.identity === identity
      ? (existing.pending as Promise<TApi>)
      : Promise.reject(new Error('Conflicting map provider configuration'));
  }
  const pending = startOwnedLoad(config);
  const shared: SharedLoad = { identity, pending };
  page[sharedLoadKey] = shared;
  void pending.then(
    (api) => {
      shared.api = api;
      // The real SDK installs this exact object. Test doubles and removed host SDKs must not
      // leave a stale successful cache that masks a later ownership attempt.
      if (Reflect.get(window, 'AMap') !== api && page[sharedLoadKey] === shared)
        Reflect.deleteProperty(page, sharedLoadKey);
    },
    () => {
      if (page[sharedLoadKey] === shared) Reflect.deleteProperty(page, sharedLoadKey);
    },
  );
  return pending as Promise<TApi>;
}

export function amapInteraction(active: boolean): Record<string, boolean> {
  return {
    scrollWheel: active,
    touchZoom: active,
    dragEnable: active,
    keyboardEnable: active,
    doubleClickZoom: active,
    zoomEnable: active,
    rotateEnable: false,
  };
}
