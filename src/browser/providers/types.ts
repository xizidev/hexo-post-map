import type { NormalizedPostMap } from '../../domain/types';
import type { OverviewPost } from '../../templates/overview';
import type { PublishedTrackAsset } from '../../tracks/types';

export interface BrowserProviderConfig {
  readonly provider: 'amap';
  readonly amap: {
    readonly key: string;
    readonly mapStyle: string;
    readonly serviceHost?: string;
    readonly securityJsCode?: string;
  };
}

export interface DetailMapModel {
  readonly map: NormalizedPostMap;
  readonly defaultZoom: number;
  readonly track?: PublishedTrackAsset;
  readonly trackPlayback?: boolean;
  readonly signal?: AbortSignal;
  readonly onError?: () => void;
  readonly onTrackError?: () => void;
}

export interface OverviewMapOptions {
  readonly posts: readonly OverviewPost[];
  readonly gridSize: number;
  readonly maxZoom: number;
  readonly placeholderUrl: string;
  readonly signal?: AbortSignal;
  readonly onError?: () => void;
  readonly onPostSelect: (
    post: OverviewPost,
    origin: HTMLElement,
    resolveOrigin?: FocusOriginResolver,
  ) => void;
  readonly onGroupSelect: (
    posts: readonly OverviewPost[],
    origin: HTMLElement,
    resolveOrigin?: FocusOriginResolver,
  ) => void;
}

export type FocusOriginResolver = () => HTMLElement | undefined;

export interface MapHandle {
  setInteractive(active: boolean): void;
  destroy(): void;
}

/** Optional fields preserve compatibility until a provider mounts a validated track. */
export interface DetailMapHandle extends MapHandle {
  readonly hasTrack?: boolean;
  setTrackProgress?(progress: number): void;
}

export interface MapProvider {
  mountDetail(container: HTMLElement, model: DetailMapModel): Promise<DetailMapHandle>;
  mountOverview(container: HTMLElement, options: OverviewMapOptions): Promise<MapHandle>;
}

export type ProviderLoader = (config: BrowserProviderConfig) => Promise<MapProvider>;
