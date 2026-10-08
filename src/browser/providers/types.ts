import type { NormalizedPostMap } from '../../domain/types';
import type { OverviewPost } from '../../templates/overview';
import type { PublishedTrackAsset } from '../../tracks/types';
import type { OverviewView } from '../overview/exploration-types';

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
  readonly initialView?: OverviewView;
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

/** Exploration is available only when the SDK supplies its complete view surface. */
export interface OverviewMapHandle extends MapHandle {
  getView?(): OverviewView | undefined;
  setView?(view: OverviewView, options: { immediately: boolean }): void;
  focusPost?(post: OverviewPost, zoom: number, options: { immediately: boolean }): void;
  onViewEnd?(listener: () => void): () => void;
}

/** Optional fields preserve compatibility until a provider mounts a validated track. */
export interface DetailMapHandle extends MapHandle {
  readonly hasTrack?: boolean;
  setTrackProgress?(progress: number): void;
}

export interface DetailMapProvider {
  mountDetail(container: HTMLElement, model: DetailMapModel): Promise<DetailMapHandle>;
}

export interface OverviewMapProvider {
  mountOverview(container: HTMLElement, options: OverviewMapOptions): Promise<OverviewMapHandle>;
}

export interface MapProvider extends DetailMapProvider, OverviewMapProvider {}

export type ProviderLoader = (config: BrowserProviderConfig) => Promise<MapProvider>;
export type DetailProviderLoader = (config: BrowserProviderConfig) => Promise<DetailMapProvider>;
export type OverviewProviderLoader = (
  config: BrowserProviderConfig,
) => Promise<OverviewMapProvider>;
