/** Only the remote SDK is replaced; published controllers and AMap adapter run unchanged. */
export const fakeSdk = String.raw`
(() => {
  const maps = [];
  const markerLayout = window.__hpmSdkMarkerLayout ?? [];
  window.__hpmSdk = { maps, paths: [], markers: [] };
  class Map {
    constructor(container, options) {
      this.container = container; this.options = options; this.zoom = options.zoom;
      this.events = {}; this.bounds = []; this.status = options; maps.push(this);
      this.onCanvasClick = event => { if (event.target === container) this.emit('click'); };
      container.addEventListener('click', this.onCanvasClick);
      setTimeout(() => this.emit('complete'), 0);
    }
    on(event, callback) { (this.events[event] ??= new Set()).add(callback); }
    off(event, callback) { this.events[event]?.delete(callback); }
    emit(event) { this.events[event]?.forEach(callback => callback()); }
    add(overlays) { overlays.forEach((overlay, index) => {
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
    setFitView(overlays, immediately, padding) { this.fitted = true; this.fitPadding = padding; }
    setStatus(status) { this.status = status; }
    destroy() { this.container.removeEventListener('click', this.onCanvasClick); this.container.replaceChildren(); }
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = zoom; this.cluster?.render(); }
    setBounds(bounds, immediately, padding) { this.bounds.push(bounds); (this.boundsPadding ??= []).push(padding); }
  }
  class Marker {
    constructor(options) {
      this.options = options; this.top = false; this.element = document.createElement('div');
      this.element.className = 'amap-marker'; this.element.style.zIndex = '0';
      window.__hpmSdk.markers.push(this);
    }
    setTop(top) { this.top = top; this.element.style.zIndex = top ? '1000' : '0'; }
  }
  class Polyline { constructor(options) { this.options = options; window.__hpmSdk.paths.push(options.path); } }
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
  window.AMap = { version: '2.0', Map, Marker, Polyline, Bounds, Pixel, MarkerCluster, plugin(names, callback) { callback(); } };
  window.___onAPILoaded();
})();
`;
