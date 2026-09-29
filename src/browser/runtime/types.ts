export type FeatureId = 'detail' | 'overview';

export interface RuntimeController {
  destroy(): void;
  isCurrent(): boolean;
}

export interface RuntimeHydrator {
  readonly id: FeatureId;
  readonly selector: '[data-hpm-detail]' | '[data-hpm-overview]';
  mount(root: HTMLElement): RuntimeController;
}

export interface HexoPostMapBrowserApi {
  readonly apiVersion: 1;
  refresh(scope?: Document | DocumentFragment | Element): void;
  destroy(scope?: Document | DocumentFragment | Element): void;
}

export interface FeatureResourceLoader {
  ensure(feature: FeatureId, retryFailed?: boolean): Promise<boolean>;
  isReady(feature: FeatureId): boolean;
  stop(): void;
}

export const FEATURES = Object.freeze({
  detail: Object.freeze({
    selector: '[data-hpm-detail]',
    script: 'post-map.js',
    failureMessage: '地图暂时无法加载，请使用下方地点链接。',
  }),
  overview: Object.freeze({
    selector: '[data-hpm-overview]',
    script: 'overview-map.js',
    failureMessage: '地图暂时无法加载，请使用下方文章列表。',
  }),
} as const);
