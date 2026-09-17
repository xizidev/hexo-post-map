import type { NormalizedPostMap } from '../../domain/types';
import type { OverviewPost } from '../../templates/overview';

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

export interface OverviewMapOptions {
  readonly posts: readonly OverviewPost[];
  readonly gridSize: number;
  readonly maxZoom: number;
  readonly placeholderUrl: string;
  readonly signal?: AbortSignal;
  readonly onError?: () => void;
  readonly onPostSelect: (post: OverviewPost, origin: HTMLElement) => void;
  readonly onGroupSelect: (posts: readonly OverviewPost[], origin: HTMLElement) => void;
}

export interface MapHandle {
  setInteractive(active: boolean): void;
  destroy(): void;
}

export interface MapProvider {
  mountDetail(container: HTMLElement, model: DetailMapModel): Promise<MapHandle>;
  mountOverview(container: HTMLElement, options: OverviewMapOptions): Promise<MapHandle>;
}

export type ProviderLoader = (config: BrowserProviderConfig) => Promise<MapProvider>;
