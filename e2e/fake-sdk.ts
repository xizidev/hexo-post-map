/** Only the remote SDK is replaced; published controllers and AMap adapter run unchanged. */
export const fakeSdk = String.raw`
(() => {
  const maps = [];
  window.__hpmSdk = { maps, paths: [] };
  class Map {
    constructor(container, options) {
      this.container = container; this.options = options; this.zoom = options.zoom;
      this.events = {}; this.bounds = []; this.status = options; maps.push(this);
      setTimeout(() => this.emit('complete'), 0);
    }
    on(event, callback) { (this.events[event] ??= new Set()).add(callback); }
    off(event, callback) { this.events[event]?.delete(callback); }
    emit(event) { this.events[event]?.forEach(callback => callback()); }
    add(overlays) { overlays.forEach(overlay => { if (overlay.options.content) this.container.append(overlay.options.content); }); }
    setFitView(overlays, immediately, padding) { this.fitted = true; this.fitPadding = padding; }
    setStatus(status) { this.status = status; }
    destroy() { this.container.replaceChildren(); }
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = zoom; this.cluster?.render(); }
    setBounds(bounds) { this.bounds.push(bounds); }
  }
  class Marker { constructor(options) { this.options = options; } }
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
