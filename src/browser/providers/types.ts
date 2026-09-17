import type { NormalizedPostMap } from '../../domain/types';

export interface BrowserProviderConfig {
  readonly provider: 'amap';
  readonly amap: {
    readonly key: string;
    readonly serviceHost?: string;
    readonly securityJsCode?: string;
  };
}

export interface DetailMapModel {
  readonly map: NormalizedPostMap;
  readonly defaultZoom: number;
  readonly signal?: AbortSignal;
  readonly onError?: () => void;
}

/** Task 8 extends these options with clustering and selection callbacks. */
export type OverviewMapOptions = Record<string, never>;

export interface MapHandle {
  setInteractive(active: boolean): void;
  destroy(): void;
}

export interface MapProvider {
  mountDetail(container: HTMLElement, model: DetailMapModel): Promise<MapHandle>;
  mountOverview(container: HTMLElement, options: OverviewMapOptions): Promise<MapHandle>;
}

export type ProviderLoader = (config: BrowserProviderConfig) => Promise<MapProvider>;
