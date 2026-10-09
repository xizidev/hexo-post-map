import type { Coordinate } from '../../domain/types';
import type { OverviewPost } from '../../templates/overview';

export type OverviewView = { readonly center: Coordinate; readonly zoom: number };
export type ExplorationFlags = {
  readonly restore: boolean;
  readonly share: boolean;
  readonly random: boolean;
};
export type PanelScroll = {
  readonly top: number;
  readonly anchor?: { readonly url: string; readonly offset: number };
};
export type OverviewPanelState =
  | { readonly mode: 'closed' }
  | { readonly mode: 'all'; readonly scroll: PanelScroll }
  | { readonly mode: 'single'; readonly urls: readonly [string]; readonly scroll: PanelScroll }
  | { readonly mode: 'group'; readonly urls: readonly string[]; readonly scroll: PanelScroll };
export type OverviewSnapshot = {
  readonly version: 1;
  readonly savedAt: number;
  readonly view: OverviewView;
  readonly panel: OverviewPanelState;
};
export type OverviewPostIndex = {
  readonly unique: ReadonlyMap<string, OverviewPost>;
  readonly ambiguous: ReadonlySet<string>;
};
export type SnapshotContext = {
  readonly now: number;
  readonly maxZoom: number;
  readonly index: OverviewPostIndex;
};
