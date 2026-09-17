import AMapLoader from '@amap/amap-jsapi-loader';
import type { Coordinate } from '../../domain/types';
import type { BrowserProviderConfig, DetailMapModel, MapHandle, MapProvider } from './types';

// Local structural types deliberately keep all vendor API details inside the adapter.
interface AMapMap {
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  add(overlays: unknown[]): void;
  setFitView(overlays: unknown[], immediately: boolean, padding: number[]): void;
  setStatus(status: Record<string, boolean>): void;
  destroy(): void;
}
interface AMapInfoWindow {
  open(map: AMapMap, coordinate: Coordinate): void;
  close(): void;
}
interface AMapApi {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => unknown;
  Polyline: new (options: Record<string, unknown>) => unknown;
  InfoWindow: new (options: Record<string, unknown>) => AMapInfoWindow;
}
const loader = AMapLoader as unknown as {
  load(options: { key: string; version: string }): Promise<AMapApi>;
  reset(): void;
};
const LOAD_TIMEOUT_MS = 20_000;
const attemptKey = Symbol.for('hexo-post-map.amap-attempt.v1');

function existingApi(value: unknown): value is AMapApi {
  if (value === null || typeof value !== 'object') return false;
  const api = value as Record<string, unknown>;
  return (
    typeof api.version === 'string' &&
    /^2(?:\.|$)/u.test(api.version) &&
    ['Map', 'Marker', 'Polyline', 'InfoWindow'].every((name) => typeof api[name] === 'function')
  );
}

function isSdkScript(script: HTMLScriptElement): boolean {
  return /^https:\/\/webapi\.amap\.com\/maps(?:\?|$)/u.test(script.src);
}

/** Own only the request started here, never an SDK or configuration belonging to the theme. */
function loadApi(config: BrowserProviderConfig): Promise<AMapApi> {
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
      () => fail(new Error('Map SDK loading timed out')),
      LOAD_TIMEOUT_MS,
    );
    const ownsAttempt = () => Reflect.get(window, attemptKey) === attempt;
    function release() {
      clearTimeout(timer);
      if (ownsAttempt()) Reflect.deleteProperty(window, attemptKey);
    }
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      if (ownsAttempt()) {
        const ownsSecurity = Reflect.get(window, '_AMapSecurityConfig') === security;
        const currentCallback: unknown = Reflect.get(window, '___onAPILoaded');
        const ownsCallback = currentCallback === undefined || currentCallback === ownedCallback;
        ownedScripts.forEach((script) => script.remove());
        if (currentCallback === ownedCallback && ownedCallback !== undefined)
          Reflect.deleteProperty(window, '___onAPILoaded');
        // reset() deletes all three SDK globals. Only use it while none has been supplied by another owner.
        if (
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

function interaction(active: boolean): Record<string, boolean> {
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

function mountDetail(
  api: AMapApi,
  container: HTMLElement,
  model: DetailMapModel,
): Promise<MapHandle> {
  return new Promise((resolve, reject) => {
    if (model.signal?.aborted) {
      reject(new Error('Map initialization cancelled'));
      return;
    }
    const point = model.map.points[0];
    if (!point) {
      reject(new Error('Missing map points'));
      return;
    }
    const map = new api.Map(container, {
      center: point.coordinate,
      zoom: model.map.zoom ?? model.defaultZoom,
      ...interaction(false),
      animateEnable: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    });
    let complete = false;
    let destroyed = false;
    let info: AMapInfoWindow | undefined;
    const buttons: HTMLButtonElement[] = [];
    const cleanups: (() => void)[] = [];
    const markers: unknown[] = [];
    const timeout = window.setTimeout(fail, LOAD_TIMEOUT_MS);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timeout);
      map.off('complete', ready);
      map.off('error', fail);
      model.signal?.removeEventListener('abort', cancel);
      cleanups.forEach((cleanup) => cleanup());
      info?.close();
      map.destroy();
    }
    function fail() {
      if (destroyed) return;
      destroy();
      if (complete) model.onError?.();
      else reject(new Error('Map initialization failed'));
    }
    function cancel() {
      destroy();
      if (!complete) reject(new Error('Map initialization cancelled'));
    }
    function ready() {
      if (destroyed || complete) return;
      try {
        if (markers.length > 1) map.setFitView(markers, true, [24, 24, 24, 24]);
        clearTimeout(timeout);
        complete = true;
        resolve({
          destroy,
          setInteractive(active) {
            if (destroyed) return;
            try {
              map.setStatus(interaction(active));
              buttons.forEach((button) => {
                button.tabIndex = active ? 0 : -1;
                button.disabled = !active;
              });
            } catch {
              fail();
            }
          },
        });
      } catch {
        fail();
      }
    }
    map.on('complete', ready);
    map.on('error', fail);
    model.signal?.addEventListener('abort', cancel, { once: true });

    try {
      for (const point of model.map.points) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hpm-marker';
        button.setAttribute('aria-label', point.name);
        button.tabIndex = -1;
        button.disabled = true;
        const sequence = model.map.route.flatMap((item, index) =>
          item.id === point.id ? [index + 1] : [],
        );
        button.textContent = sequence.length ? sequence.join(', ') : point.name;
        const select = () => {
          if (destroyed) return;
          try {
            info?.close();
            const content = document.createElement('div');
            content.className = 'hpm-place-card';
            const name = document.createElement('p');
            name.textContent = point.name;
            const link = document.createElement('a');
            const url = new URL('https://uri.amap.com/marker');
            url.searchParams.set('position', point.coordinate.join(','));
            url.searchParams.set('name', point.name);
            url.searchParams.set('coordinate', 'gaode');
            link.href = url.href;
            link.textContent = '在高德地图中查看';
            content.append(name, link);
            info = new api.InfoWindow({ content });
            info.open(map, point.coordinate);
          } catch {
            fail();
          }
        };
        button.addEventListener('click', select);
        cleanups.push(() => button.removeEventListener('click', select));
        buttons.push(button);
        markers.push(
          new api.Marker({ position: point.coordinate, content: button, anchor: 'bottom-center' }),
        );
      }
      const overlays = [...markers];
      if (model.map.route.length > 1)
        overlays.push(
          new api.Polyline({
            path: model.map.route.map((point) => point.coordinate),
            strokeColor: '#2563eb',
            strokeWeight: 4,
          }),
        );
      map.add(overlays);
    } catch {
      fail();
    }
  });
}

export async function createAMapProvider(config: BrowserProviderConfig): Promise<MapProvider> {
  const api = await loadApi(config);
  return {
    mountDetail: (container, model) => mountDetail(api, container, model),
    mountOverview: async () => {
      throw new Error('Overview maps are not implemented yet');
    },
  };
}
