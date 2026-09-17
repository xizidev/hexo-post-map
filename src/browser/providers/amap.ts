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
    const timeout = window.setTimeout(fail, 20_000);

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
  const security =
    config.amap.serviceHost !== undefined
      ? { serviceHost: config.amap.serviceHost }
      : { securityJsCode: config.amap.securityJsCode };
  (window as unknown as { _AMapSecurityConfig: typeof security })._AMapSecurityConfig = security;
  let api: AMapApi;
  try {
    api = await loader.load({ key: config.amap.key, version: '2.0' });
  } catch (error) {
    loader.reset();
    throw error;
  }
  return {
    mountDetail: (container, model) => mountDetail(api, container, model),
    mountOverview: async () => {
      throw new Error('Overview maps are not implemented yet');
    },
  };
}
