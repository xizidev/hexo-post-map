import type { ResolvedPluginConfig } from '../config/types';
import { escapeHtml } from '../presentation/safe-html';
import { serializeForHtmlScript } from '../presentation/serialize';

/** Public version-1 overview projection; never includes article bodies or detail metadata. */
export interface OverviewPost {
  readonly title: string;
  readonly url: string;
  readonly date: string;
  readonly image: string;
  readonly location: {
    readonly name: string;
    readonly longitude: number;
    readonly latitude: number;
  };
}

export interface OverviewTemplateModel {
  readonly posts: readonly OverviewPost[];
  readonly config: ResolvedPluginConfig;
  readonly dataUrl: string;
  readonly placeholderUrl: string;
}

/** A chronological list remains usable before JavaScript and after map/data failures. */
export function renderOverview({
  posts,
  config,
  dataUrl,
  placeholderUrl,
}: OverviewTemplateModel): string {
  const rows = posts
    .map((post) => {
      const title = escapeHtml(post.title);
      const link = post.url ? `<a href="${escapeHtml(post.url)}">${title}</a>` : title;
      return `<li class="hpm-post"><img src="${escapeHtml(post.image)}" alt="${title}" loading="lazy" width="96" height="72" data-hpm-image><div>${link}<time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date.slice(0, 10))}</time><span>${escapeHtml(post.location.name)}</span></div></li>`;
    })
    .join('');
  const settings = serializeForHtmlScript({
    dataUrl,
    placeholderUrl,
    provider: config.provider,
    amap: config.amap,
    cluster: config.cluster,
  });
  return `<section class="hpm-overview" data-hpm-overview aria-label="${escapeHtml(config.overview.title)}">
<h1>${escapeHtml(config.overview.title)}</h1>
<div class="hpm-overview__canvas" data-hpm-canvas></div>
<script type="application/json" data-hpm-data>${settings}</script>
<div class="hpm-overview__status" data-hpm-status aria-live="polite"></div>
${posts.length === 0 ? '<p data-hpm-empty>暂无标注地点的文章。</p>' : ''}
<ol class="hpm-post-list" data-hpm-fallback>${rows}</ol>
</section>`;
}
