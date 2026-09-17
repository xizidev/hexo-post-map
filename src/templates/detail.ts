import type { ResolvedPluginConfig } from '../config/types';
import type { NormalizedPostMap } from '../domain/types';
import { escapeHtml, safeUrl } from '../presentation/safe-html';
import { serializeForHtmlScript } from '../presentation/serialize';

export interface DetailTemplateModel {
  readonly map: NormalizedPostMap;
  readonly config: ResolvedPluginConfig;
}

/** The list stays visible until the browser controller successfully initializes the map. */
export function renderDetailMap({ map, config }: DetailTemplateModel): string {
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
  });

  return `<section class="hpm-detail" data-hpm-detail aria-label="文章地点地图">
<div class="hpm-detail__canvas" data-hpm-canvas></div>
<script type="application/json" data-hpm-data>${data}</script>
<ol class="hpm-place-list" data-hpm-fallback>${places}</ol>
<div class="hpm-detail__status" data-hpm-status aria-live="polite"></div>
</section>`;
}
