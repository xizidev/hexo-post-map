export const DEFAULT_CONFIG = Object.freeze({
  provider: 'amap' as const,
  post: Object.freeze({
    enabled: true,
    position: 'before' as const,
    height: '220px',
    defaultZoom: 11,
  }),
  overview: Object.freeze({
    enabled: true,
    path: 'map/',
    title: '足迹地图',
    layout: 'page' as const,
  }),
  cluster: Object.freeze({
    gridSize: 60,
    maxZoom: 18,
  }),
  amap: Object.freeze({
    mapStyle: 'amap://styles/normal',
  }),
});
