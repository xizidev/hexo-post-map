import type { TrackStats } from '../tracks/types';

/** Contains only publication-safe data; source references never cross this boundary. */
export interface DetailTrackDescriptor {
  readonly url: string;
  readonly stats: TrackStats;
  readonly playback: boolean;
}

/** Fixed units and decimal precision keep server output independent of the host locale. */
export function formatTrackStats(stats: TrackStats): readonly { label: string; value: string }[] {
  const items = [
    {
      label: '距离',
      value:
        stats.distanceMeters < 1000
          ? `${Math.round(stats.distanceMeters)} 米`
          : `${(stats.distanceMeters / 1000).toFixed(2)} 公里`,
    },
  ];
  if (stats.elevationGainMeters !== undefined) {
    items.push({ label: '累计爬升', value: `${Math.round(stats.elevationGainMeters)} 米` });
  }
  if (stats.durationSeconds !== undefined) {
    const minutes = Math.round(stats.durationSeconds / 60);
    items.push({
      label: '时长',
      value:
        minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`,
    });
  }
  return items;
}
