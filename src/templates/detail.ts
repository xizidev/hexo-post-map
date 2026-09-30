import type { ResolvedPluginConfig } from '../config/types';
import type { NormalizedPostMap } from '../domain/types';
import { escapeHtml, safeUrl } from '../presentation/safe-html';
import { serializeForHtmlScript } from '../presentation/serialize';
import { formatTrackStats, type DetailTrackDescriptor } from '../presentation/track';

export interface DetailTemplateModel {
  readonly map: NormalizedPostMap;
  readonly config: ResolvedPluginConfig;
  readonly track?: DetailTrackDescriptor;
}

/** The list stays visible until the browser controller successfully initializes the map. */
export function renderDetailMap({ map, config, track }: DetailTemplateModel): string {
  const places = map.points
    .map((point) => {
      const url = new URL('https://uri.amap.com/marker');
      url.searchParams.set('position', point.coordinate.join(','));
      url.searchParams.set('name', point.name);
      url.searchParams.set('coordinate', 'gaode');
      const href = safeUrl(url.href, 'post');
      const name = escapeHtml(point.name);
      return href === null
        ? `<li>${name}</li>`
        : `<li><a href="${escapeHtml(href)}">${name}</a></li>`;
    })
    .join('');
  const data = serializeForHtmlScript({
    map,
    provider: config.provider,
    amap: config.amap,
    defaultZoom: config.post.defaultZoom,
    height: config.post.height,
    ...(track === undefined
      ? {}
      : {
          track: {
            url: track.url,
            stats: {
              distanceMeters: track.stats.distanceMeters,
              ...(track.stats.elevationGainMeters === undefined
                ? {}
                : { elevationGainMeters: track.stats.elevationGainMeters }),
              ...(track.stats.durationSeconds === undefined
                ? {}
                : { durationSeconds: track.stats.durationSeconds }),
            },
            playback: track.playback,
          },
        }),
  });
  const statistics =
    track === undefined
      ? ''
      : `<dl class="hpm-track-stats" data-hpm-track-stats>${formatTrackStats(track.stats)
          .map(({ label, value }) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
          .join('')}</dl>\n`;
  const controls = track?.playback
    ? `<div class="hpm-playback" data-hpm-playback hidden>
<button type="button" data-hpm-play aria-pressed="false">播放</button>
<button type="button" data-hpm-restart>重新开始</button>
<input type="range" data-hpm-progress aria-label="轨迹播放进度" min="0" max="1" step="0.001" value="0">
</div>\n`
    : '';

  return `<section class="hpm-detail" data-hpm-detail aria-label="文章地点地图">
<div class="hpm-detail__canvas" data-hpm-canvas></div>
<script type="application/json" data-hpm-data>${data}</script>
<ol class="hpm-place-list" data-hpm-fallback>${places}</ol>
${statistics}${controls}<div class="hpm-detail__status" data-hpm-status aria-live="polite"></div>
</section>`;
}
