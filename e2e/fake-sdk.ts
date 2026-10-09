/** Only the remote SDK is replaced; published controllers and AMap adapter run unchanged. */
export const fakeSdk = String.raw`
(() => {
  const maps = [];
  const markerLayout = window.__hpmSdkMarkerLayout ?? [];
  window.__hpmSdk = {
    maps,
    paths: [],
    markers: [],
    polylines: [],
    conversionBatches: [],
    polylineUpdates: [],
    markerPositions: [],
    destroyedTrackOverlays: 0,
    destroyedMaps: 0,
  };
  class Map {
    constructor(container, options) {
      this.container = container; this.options = options; this.zoom = options.zoom;
      this.center = [...(options.center ?? [104, 35])]; this.destroyed = false;
      this.events = {}; this.bounds = []; this.status = options; this.overlays = []; maps.push(this);
      this.onCanvasClick = event => { if (event.target === container) this.emit('click'); };
      container.addEventListener('click', this.onCanvasClick);
      setTimeout(() => this.emit('complete'), 0);
    }
    on(event, callback) { (this.events[event] ??= new Set()).add(callback); }
    off(event, callback) { this.events[event]?.delete(callback); }
    emit(event) { if (!this.destroyed) this.events[event]?.forEach(callback => callback()); }
    add(overlays) { this.overlays.push(...overlays); overlays.forEach((overlay, index) => {
      if (!overlay.options.content) return;
      const content = overlay.options.content;
      const wrapper = overlay.element;
      const layout = markerLayout[index] ?? {};
      wrapper.style.position = 'absolute';
      wrapper.style.left = layout.left ?? 'calc(50% + ' + (index * 56 - 56) + 'px)';
      wrapper.style.top = layout.top ?? '50%';
      content.style.position = 'relative';
      wrapper.append(content); this.container.append(wrapper);
    }); }
    remove(overlays) { this.overlays = this.overlays.filter(overlay => !overlays.includes(overlay)); }
    setFitView(overlays, immediately, padding) { this.fitted = true; this.fitPadding = padding; }
    setStatus(status) { this.status = status; }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      window.__hpmSdk.destroyedMaps++;
      Object.values(this.events).forEach(listeners => listeners.clear());
      this.container.removeEventListener('click', this.onCanvasClick); this.container.replaceChildren();
    }
    getZoom() { return this.zoom; }
    getCenter() {
      const [longitude, latitude] = this.center;
      return { getLng: () => longitude, getLat: () => latitude };
    }
    setZoom(zoom) {
      if (this.destroyed) return;
      this.zoom = zoom; this.cluster?.render(); this.emit('zoomend');
    }
    setZoomAndCenter(zoom, center, immediately = false) {
      if (this.destroyed) return;
      this.center = [...center]; this.lastImmediately = immediately;
      this.zoom = zoom; this.cluster?.render(); this.emit('moveend'); this.emit('zoomend');
    }
    setBounds(bounds, immediately, padding) { this.bounds.push(bounds); (this.boundsPadding ??= []).push(padding); }
  }
  class Marker {
    constructor(options) {
      this.options = options; this.top = false; this.element = document.createElement('div');
      this.element.className = 'amap-marker'; this.element.style.zIndex = '0';
      window.__hpmSdk.markers.push(this);
    }
    setTop(top) { this.top = top; this.element.style.zIndex = top ? '1000' : '0'; }
    setPosition(position) {
      this.options.position = [...position];
      window.__hpmSdk.markerPositions.push([...position]);
    }
    setMap(map) {
      this.map = map;
      if (!map && this.options.content?.classList.contains('hpm-track-marker') && !this.destroyed) {
        this.destroyed = true; window.__hpmSdk.destroyedTrackOverlays++;
      }
      if (!map) this.element.remove();
    }
  }
  class Polyline {
    constructor(options) {
      this.options = options;
      this.isTrack = options.strokeWeight === 5;
      window.__hpmSdk.paths.push(options.path);
      window.__hpmSdk.polylines.push(this);
    }
    setPath(path) {
      this.options.path = path;
      window.__hpmSdk.polylineUpdates.push(path);
    }
    hide() { this.hidden = true; }
    show() { this.hidden = false; }
    setMap(map) {
      this.map = map;
      if (!map && this.isTrack && !this.destroyed) {
        this.destroyed = true; window.__hpmSdk.destroyedTrackOverlays++;
      }
    }
  }
  class Bounds { constructor(southwest, northeast) { this.southwest = southwest; this.northeast = northeast; } }
  class Pixel { constructor(x, y) { this.x = x; this.y = y; } }
  class MarkerCluster {
    constructor(map, data, options) { this.map = map; this.data = data; this.options = options; map.cluster = this; this.render(); }
    render() {
      this.map.container.replaceChildren();
      this.markers = [];
      const groups = this.map.zoom <= 4 ? [this.data] : Object.values(this.data.reduce((groups, point) => {
        (groups[point.lnglat.join(',')] ??= []).push(point); return groups;
      }, {}));
      for (const group of groups) {
        const marker = {
          content: undefined,
          offset: undefined,
          setContent: content => { marker.content = content; this.map.container.append(content); },
          setOffset: offset => { marker.offset = offset; },
        };
        this.markers.push(marker);
        // Real AMap keeps count but collapses exact-coordinate representatives.
        const representatives = [...new window.Map(group.map(point => [point.lnglat.join(','), point])).values()];
        if (group.length > 1) this.options.renderClusterMarker({ marker, count: group.length, clusterData: representatives });
        else this.options.renderMarker({ marker, data: group });
      }
    }
    setMap(map) { if (!map) this.map.container.replaceChildren(); }
  }
  function convertFrom(batch, source, callback) {
    window.__hpmSdk.conversionBatches.push(batch.map(coordinate => [...coordinate]));
    if (window.__hpmSdkConversionFailure) {
      callback('error'); return;
    }
    callback('complete', {
      locations: batch.map(([longitude, latitude]) => [longitude + 0.001, latitude + 0.001]),
    });
  }
  window.AMap = { version: '2.0', Map, Marker, Polyline, Bounds, Pixel, MarkerCluster, convertFrom, plugin(names, callback) { callback(); } };
  window.___onAPILoaded();
})();
`;
