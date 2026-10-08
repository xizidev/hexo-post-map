import { createHash } from 'node:crypto';
import { test as base, expect, type Page, type Request } from 'playwright/test';
import { fakeSdk } from './fake-sdk';

const trackSegments = [
  Array.from({ length: 41 }, (_, index) => [
    118.7801 + index * 0.00012,
    32.0711 + index * 0.00008,
    12 + index * 0.1,
  ]),
  Array.from({ length: 40 }, (_, index) => [
    118.785 + index * 0.0001,
    32.0745 - index * 0.00006,
    16 + index * 0.08,
  ]),
  Array.from({ length: 6 }, (_, index) => [
    118.7892 + index * 0.00014,
    32.0719 + index * 0.00011,
    19 + index * 0.2,
  ]),
];

export const TRACK_STATS = Object.freeze({
  distanceMeters: 12_345.67,
  elevationGainMeters: 342.5,
  durationSeconds: 5_400,
});
export const TRACK_ASSET_BODY = JSON.stringify({
  version: 1,
  coordinateSystem: 'wgs84',
  segments: trackSegments,
  stats: TRACK_STATS,
});
export const TRACK_ASSET_DIGEST = createHash('sha256').update(TRACK_ASSET_BODY).digest('hex');
export const TRACK_ASSET_PATH = `/blog/hexo-post-map/tracks/${TRACK_ASSET_DIGEST}.json`;
export const TRACK_POINT_COUNT = trackSegments.reduce(
  (count, segment) => count + segment.length,
  0,
);

export interface TrackedPageOptions {
  readonly playback?: boolean;
  readonly assetBody?: string;
  readonly assetContentType?: string;
  readonly assetStatus?: number;
}

/** Mirrors the real SSR contract while keeping source-only metadata outside browser fixtures. */
export function withTrackedDetailHtml(html: string, playback = true): string {
  const withDescriptor = html.replace(
    /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
    (_all, start: string, json: string, end: string) => {
      const data = JSON.parse(json) as Record<string, unknown>;
      data.track = { url: TRACK_ASSET_PATH, stats: TRACK_STATS, playback };
      return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
    },
  );
  const statistics = `<dl class="hpm-track-stats" data-hpm-track-stats><dt>距离</dt><dd>12.35 公里</dd><dt>累计爬升</dt><dd>343 米</dd><dt>时长</dt><dd>1 小时 30 分钟</dd></dl>\n`;
  const controls = playback
    ? `<div class="hpm-playback" data-hpm-playback hidden>
<button type="button" data-hpm-play aria-pressed="false">播放</button>
<button type="button" data-hpm-restart>重新开始</button>
<input type="range" data-hpm-progress aria-label="轨迹播放进度" min="0" max="1" step="0.001" value="0">
</div>\n`
    : '';
  const status = '<div class="hpm-detail__status" data-hpm-status aria-live="polite"></div>';
  if (!withDescriptor.includes(status)) throw new Error('Detail fixture status region missing');
  return withDescriptor.replace(status, statistics + controls + status);
}

export async function installTrackedPage(
  page: Page,
  options: TrackedPageOptions = {},
): Promise<void> {
  const playback = options.playback ?? true;
  await page.route('**/blog/posts/route/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: withTrackedDetailHtml(await response.text(), playback) });
  });
  await page.route(`**${TRACK_ASSET_PATH}`, async (route) => {
    await route.fulfill({
      status: options.assetStatus ?? 200,
      contentType: options.assetContentType ?? 'application/json',
      body: options.assetBody ?? TRACK_ASSET_BODY,
    });
  });
}

export async function installControlledAnimationFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let nextId = 1;
    const pending = new Map<number, FrameRequestCallback>();
    const cancelled = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const callback = pending.get(id);
      if (callback) cancelled.set(id, callback);
      pending.delete(id);
    };
    Reflect.set(window, '__hpmTestFrames', {
      pending: () => pending.size,
      cancelled: () => cancelled.size,
      fire(timestamp: number) {
        const entry = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
        if (!entry) throw new Error('No animation frame is pending');
        pending.delete(entry[0]);
        entry[1](timestamp);
      },
      fireCancelled(timestamp: number) {
        for (const callback of cancelled.values()) callback(timestamp);
        cancelled.clear();
      },
    });
  });
}

export async function pendingAnimationFrames(page: Page): Promise<number> {
  return page.evaluate(() => Reflect.get(window, '__hpmTestFrames').pending());
}

export async function fireAnimationFrame(page: Page, timestamp: number): Promise<void> {
  await page.evaluate((value) => Reflect.get(window, '__hpmTestFrames').fire(value), timestamp);
}

export async function fireCancelledAnimationFrames(page: Page, timestamp: number): Promise<void> {
  await page.evaluate(
    (value) => Reflect.get(window, '__hpmTestFrames').fireCancelled(value),
    timestamp,
  );
}

export const test = base.extend<{
  network: { sdkRequests: number; externalRequests: string[]; local: Record<string, number> };
}>({
  network: [
    async ({ context }, use) => {
      const network = {
        sdkRequests: 0,
        externalRequests: [] as string[],
        local: {} as Record<string, number>,
      };
      // Observe requests independently of routing so page-level delayed routes count too.
      const countLocal = (request: Request) => {
        const url = new URL(request.url());
        if (url.origin === 'http://127.0.0.1:4179')
          network.local[url.pathname] = (network.local[url.pathname] ?? 0) + 1;
      };
      context.on('request', countLocal);
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === 'http://127.0.0.1:4179') {
          await route.continue();
          return;
        }
        // Default-deny every external origin, including any new AMap/CDN origin.
        network.externalRequests.push(url.origin);
        if (url.hostname === 'webapi.amap.com' && url.pathname === '/maps') {
          network.sdkRequests++;
          await route.fulfill({ contentType: 'text/javascript', body: fakeSdk });
        } else await route.abort();
      });
      try {
        await use(network);
      } finally {
        context.off('request', countLocal);
      }
    },
    { auto: true },
  ],
});
export { expect };

export interface ExplorationFlags {
  readonly restore: boolean;
  readonly share: boolean;
  readonly random: boolean;
}

/** Changes only public fixture HTML/data; runtime and feature scripts remain packed assets. */
export async function installOverviewExplorationFixture(
  page: Page,
  options: { count: number; flags: ExplorationFlags },
): Promise<void> {
  await page.route('**/blog/map/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/blog/map/posts.json') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          posts: Array.from({ length: options.count }, (_, index) => ({
            title: `Exploration article ${index}`,
            url: `/blog/posts/plain/?hpm_fixture=${index}`,
            date: '2024-01-01',
            image: '/blog/hexo-post-map/assets/placeholder.svg',
            location: { name: `Place ${index}`, longitude: 118 + index / 10000, latitude: 32 },
          })),
        }),
      });
      return;
    }
    if (path !== '/blog/map/' && path !== '/blog/map/index.html') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
      (_all, start: string, json: string, end: string) =>
        start + JSON.stringify({ ...JSON.parse(json), exploration: options.flags }) + end,
    );
    await route.fulfill({ response, body });
  });
}
