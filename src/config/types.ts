export interface ResolvedPluginConfig {
  readonly provider: 'amap';
  readonly post: {
    readonly enabled: boolean;
    readonly position: 'before' | 'after' | 'manual';
    readonly height: string;
    readonly defaultZoom: number;
  };
  readonly overview: {
    readonly enabled: boolean;
    readonly path: string;
    readonly title: string;
    readonly layout: 'page' | 'standalone';
  };
  readonly cluster: {
    readonly gridSize: number;
    readonly maxZoom: number;
  };
  readonly amap: {
    readonly key: string;
    readonly serviceHost?: string;
    readonly securityJsCode?: string;
  };
}
