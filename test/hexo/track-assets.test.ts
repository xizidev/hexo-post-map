import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import Hexo from 'hexo';
import type { SiteLocals } from 'hexo/dist/types';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { registerPlugin } from '../../src/hexo/register';

const temporarySites: Hexo[] = [];
afterEach(async () => {
  for (const hexo of temporarySites.splice(0)) {
    await hexo.exit();
    await rm(hexo.base_dir, { recursive: true, force: true });
  }
});
const rawGpx =
  '<gpx xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>PRIVATE_NAME</name></metadata><trk><trkseg><trkpt lon="0" lat="0"><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lon="0.001" lat="0"><time>2026-01-01T00:01:00Z</time></trkpt></trkseg></trk></gpx>';
const rawGeoJson = JSON.stringify({
  type: 'Feature',
  properties: { name: 'PRIVATE_NAME' },
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [0.001, 0],
    ],
  },
});
const points = [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }];

async function fixture(overview = false, postOptions: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hpm-track-assets-'));
  const hexo = new Hexo(directory, { silent: true });
  temporarySites.push(hexo);
  await hexo.init();
  // Exercise Hexo's real post pipeline without requiring an external Markdown renderer.
  hexo.extend.renderer.register('md', 'html', (data) => data.text ?? '', true);
  hexo.config.post_asset_folder = true;
  hexo.config.post_map = {
    enabled: true,
    overview: { enabled: overview },
    post: postOptions,
    amap: { key: 'key', security: { security_js_code: 'code' } },
  };
  registerPlugin(hexo);
  await mkdir(join(hexo.source_dir, '_posts/trip'), { recursive: true });
  const post = await hexo.model('Post').insert({
    source: '_posts/trip.md',
    slug: 'trip',
    title: 'Trip',
    date: new Date('2026-01-01T00:00:00Z'),
    content: '<p>Trip</p>',
    _content: '<p>Trip</p>',
    map: { points, track: { source: 'trip/private.gpx' } },
  });
  async function postAsset(name: string, content: string) {
    const source = join(hexo.source_dir, '_posts/trip', name);
    await writeFile(source, content);
    return await hexo.model('PostAsset').insert({
      _id: relative(hexo.base_dir, source),
      post: post._id,
      slug: name,
      renderable: false,
    });
  }
  async function asset(name: string, target: string) {
    const source = join(hexo.source_dir, name);
    await mkdir(dirname(source), { recursive: true });
    await symlink(target, source);
    return await hexo
      .model('Asset')
      .insert({ _id: relative(hexo.base_dir, source), path: name, renderable: false });
  }
  return { hexo, post, postAsset, asset };
}

describe('raw track route privacy across Hexo generation', () => {
  it.each(['after', 'manual'])(
    'refreshes cached track HTML and statistics after only the GPX changes (%s)',
    async (position) => {
      const { hexo, post, postAsset } = await fixture(false, { position });
      const raw = await postAsset('private.gpx', rawGpx);
      const ordinary = await hexo.model('Post').insert({
        source: '_posts/ordinary.md',
        slug: 'ordinary',
        _content: '<p>Different raw input</p>',
        content: '<p>UNCHANGED CACHED ARTICLE</p>',
      });
      if (position === 'manual') {
        post._content = '<p>Before</p>{% post_map %}<p>After</p>';
        post.content = post._content;
      }
      await hexo.post.render(post.full_source, post);
      await post.save();
      const inspect = () => {
        const window = new Window();
        // Warehouse returns copies; read the persisted record rendered by Hexo's own lifecycle.
        window.document.body.innerHTML = hexo.model('Post').findById(post._id).content;
        return {
          url: JSON.parse(window.document.querySelector('[data-hpm-data]')!.textContent!).track
            .url as string,
          distance: window.document.querySelector('[data-hpm-track-stats] dd')!.textContent,
          count: window.document.querySelectorAll('[data-hpm-detail]').length,
          previous:
            window.document.querySelector('[data-hpm-detail]')!.previousElementSibling?.textContent,
          next: window.document.querySelector('[data-hpm-detail]')!.nextElementSibling?.textContent,
        };
      };
      await hexo._generate();
      const first = inspect();
      const cachedContent = hexo.model('Post').findById(post._id).content;
      expect(first.distance).toBe('111 米');
      expect(hexo.route.get(first.url.slice(1))).toBeDefined();
      await writeFile(raw.source, rawGpx.replace('lon="0.001"', 'lon="0.002"'));
      await hexo._generate({ cache: true });
      const second = inspect();
      expect(second.url).not.toBe(first.url);
      expect(second.distance).toBe('222 米');
      const persisted = hexo.model('Post').findById(post._id);
      expect(persisted.content).not.toBe(cachedContent);
      expect(persisted._id).toBe(post._id);
      expect(persisted.source).toBe(post.source);
      expect(hexo.route.get(second.url.slice(1))).toBeDefined();
      expect(hexo.route.get(first.url.slice(1))).toBeUndefined();
      expect(second.count).toBe(1);
      if (position === 'manual') {
        expect(second.previous).toBe('Before');
        expect(second.next).toBe('After');
      }
      expect(hexo.model('Post').findById(ordinary._id).content).toBe(
        '<p>UNCHANGED CACHED ARTICLE</p>',
      );
    },
  );

  it('does not invalidate tracked cached posts when detail maps are disabled', async () => {
    const { hexo, post } = await fixture(false, { enabled: false });
    await hexo._generate({ cache: true });
    expect(hexo.model('Post').findById(post._id).content).toBe('<p>Trip</p>');
  });

  it.each([false, true])(
    'filters hash-shaped raw aliases before watch reads, including real hash collision=%s',
    async (collision) => {
      const { hexo, postAsset, asset } = await fixture();
      const raw = await postAsset('private.gpx', rawGpx);
      await hexo._generate();
      const canonicalPath = hexo.route
        .list()
        .find((path) => path.startsWith('hexo-post-map/tracks/'))!;
      const canonicalChunks: string[] = [];
      for await (const chunk of hexo.route.get(canonicalPath)!) canonicalChunks.push(String(chunk));
      const canonical = canonicalChunks.join('');
      const aliasPath = collision ? canonicalPath : `hexo-post-map/tracks/${'a'.repeat(64)}.json`;
      await asset(aliasPath, raw.source);
      const reads: Promise<string>[] = [];
      hexo.route.on('update', (path: string) => {
        if (path !== aliasPath) return;
        const stream = hexo.route.get(path)!;
        reads.push(
          (async () => {
            const chunks: string[] = [];
            for await (const chunk of stream) chunks.push(String(chunk));
            return chunks.join('');
          })(),
        );
      });
      await hexo._generate({ cache: true });
      const observed = await Promise.all(reads);
      expect(observed.join('')).not.toMatch(/PRIVATE_NAME|<gpx|2026-01-01/);
      if (collision) {
        expect(observed.length).toBeGreaterThan(0);
        expect(observed.every((content) => content === canonical)).toBe(true);
        const chunks: string[] = [];
        for await (const chunk of hexo.route.get(canonicalPath)!) chunks.push(String(chunk));
        expect(chunks.join('')).toBe(canonical);
        const previousReads = reads.length;
        await writeFile(raw.source, rawGpx.replace('lon="0.001"', 'lon="0.002"'));
        await hexo._generate({ cache: true });
        await Promise.all(reads);
        expect(reads).toHaveLength(previousReads);
        expect(hexo.route.get(canonicalPath)).toBeUndefined();
        expect(
          hexo.route.list().filter((path) => path.startsWith('hexo-post-map/tracks/')),
        ).toHaveLength(1);
      } else {
        expect(observed).toEqual([]);
        expect(hexo.route.get(aliasPath)).toBeUndefined();
        expect(hexo.route.get(canonicalPath)).toBeDefined();
      }
    },
  );

  it('never exposes tracked raw routes to watch update listeners, including cached post content', async () => {
    const { hexo, post, postAsset } = await fixture();
    const raw = await postAsset('private.gpx', rawGpx);
    const image = await postAsset('photo.jpg', 'IMAGE_BYTES');
    const unused = await postAsset('unreferenced.gpx', rawGpx);
    const updates: string[] = [];
    const rawStreams: unknown[] = [];
    // A previous build may have exposed this file before the article gained a track reference.
    hexo.route.set(raw.path, rawGpx);
    hexo.route.on('update', (path: string) => {
      updates.push(path);
      if (path === raw.path) rawStreams.push(hexo.route.get(path));
    });
    await hexo._generate();
    await hexo._generate({ cache: true });
    expect(updates).not.toContain(raw.path);
    expect(rawStreams).toEqual([]);
    expect(hexo.route.get(raw.path)).toBeUndefined();
    expect(updates).toContain(image.path);
    expect(updates).toContain(unused.path);
    post.map = { points };
    await post.save();
    await hexo._generate({ cache: true });
    expect(updates).toContain(raw.path);
    expect(hexo.route.get(raw.path)).toBeDefined();
  });

  it('wraps the final asset generator each generation and preserves nested results and route data', async () => {
    const { hexo, postAsset } = await fixture();
    const raw = await postAsset('private.gpx', rawGpx);
    const image = await postAsset('photo.jpg', 'IMAGE_BYTES');
    const safe = { path: image.path, data: { modified: false, data: () => 'IMAGE_BYTES' } };
    for (let run = 0; run < 2; run++) {
      hexo.extend.generator.register('asset', async () => [
        [{ path: raw.path, data: rawGpx }, safe],
        safe,
      ]);
      await hexo.execFilter('before_generate', null, { context: hexo });
      const result = await hexo.extend.generator
        .get('asset')
        .call(hexo, hexo.locals.toObject() as SiteLocals);
      expect(result).toEqual([[safe], safe]);
      expect(result[0][0]).toBe(safe);
      expect(result[1]).toBe(safe);
    }
  });

  it('fails closed if the current asset generator cannot be wrapped', async () => {
    const { hexo, postAsset } = await fixture();
    await postAsset('private.gpx', rawGpx);
    delete hexo.extend.generator.list().asset;
    await expect(hexo._generate()).rejects.toThrow(
      '[hexo-post-map] cannot guard Hexo asset generator during track publication',
    );
  });

  it.each([true, false])(
    'removes only active raw GPX/GeoJSON routes with overview enabled=%s',
    async (overview) => {
      const { hexo, post, postAsset } = await fixture(overview);
      const gpx = await postAsset('private.gpx', rawGpx);
      const geojson = await postAsset('private.geojson', rawGeoJson);
      const image = await postAsset('photo.jpg', 'IMAGE_BYTES');
      const unused = await postAsset('unreferenced.gpx', rawGpx);
      await hexo.model('Post').insert({
        source: '_posts/other.md',
        slug: 'other',
        title: 'Other',
        content: '<p>Other</p>',
        map: { points, track: { source: 'trip/private.geojson' } },
      });
      await hexo._generate();
      expect(hexo.route.get(gpx.path)).toBeUndefined();
      expect(hexo.route.get(geojson.path)).toBeUndefined();
      expect(hexo.route.get(image.path)).toBeDefined();
      expect(hexo.route.get(unused.path)).toBeDefined();
      const hashRoutes = hexo.route
        .list()
        .filter((path) => /^hexo-post-map\/tracks\/[a-f0-9]{64}\.json$/u.test(path));
      expect(hashRoutes).toHaveLength(2);
      for (const path of hashRoutes) {
        const chunks = [];
        for await (const chunk of hexo.route.get(path)!) chunks.push(String(chunk));
        expect(chunks.join('')).not.toMatch(/PRIVATE_NAME|2026-01-01|private\.(?:gpx|geojson)/u);
      }
      expect(hexo.route.list().includes('map/posts.json')).toBe(overview);
      expect(post.source).toBe('_posts/trip.md');
    },
  );

  it('registers cache hits after each reset and releases old source identities when tracks disappear', async () => {
    const { hexo, post, postAsset } = await fixture();
    const raw = await postAsset('private.gpx', rawGpx);
    await hexo._generate();
    expect(hexo.route.get(raw.path)).toBeUndefined();
    await hexo._generate({ cache: true });
    expect(hexo.route.get(raw.path)).toBeUndefined();
    post.map = { points };
    await post.save();
    await hexo._generate({ cache: true });
    expect(hexo.route.get(raw.path)).toBeDefined();
    expect(hexo.route.list().filter((path) => path.startsWith('hexo-post-map/tracks/'))).toEqual(
      [],
    );
  });

  it('matches canonical symlink targets in both Asset and PostAsset without deleting a hash route', async () => {
    const { hexo, post, postAsset, asset } = await fixture();
    const raw = await postAsset('private.gpx', rawGpx);
    const alias = await asset('public-alias.gpx', raw.source);
    await symlink(raw.source, join(hexo.source_dir, '_posts/track-link.gpx'));
    post.map = { points, track: { source: 'track-link.gpx' } };
    await post.save();
    await hexo._generate();
    expect(hexo.route.get(raw.path)).toBeUndefined();
    expect(hexo.route.get(alias.path)).toBeUndefined();
    const hash = hexo.route.list().find((path) => path.startsWith('hexo-post-map/tracks/'))!;
    const collision = await hexo
      .model('Asset')
      .insert({ _id: 'collision.gpx', path: hash, renderable: false });
    await symlink(raw.source, collision.source);
    await hexo.execFilter('after_generate', null, { context: hexo });
    expect(hexo.route.get(hash)).toBeDefined();
  });

  it('removes known lexical and canonical raw routes even if a track file disappears after compilation', async () => {
    const { hexo, postAsset } = await fixture();
    const raw = await postAsset('private.gpx', rawGpx);
    await hexo.execFilter('before_generate', null, { context: hexo });
    await hexo.extend.generator.get('post-map').call(hexo, hexo.locals.toObject() as SiteLocals);
    hexo.route.set(raw.path, rawGpx);
    await rm(raw.source);
    await hexo.execFilter('after_generate', null, { context: hexo });
    expect(hexo.route.get(raw.path)).toBeUndefined();
  });

  it('fails the generation when a routed alias cannot be reliably resolved, without leaking diagnostics', async () => {
    const { hexo, postAsset, asset } = await fixture();
    const raw = await postAsset('private.gpx', rawGpx);
    const alias = await asset('alias.gpx', raw.source);
    const image = await postAsset('photo.jpg', 'IMAGE_BYTES');
    hexo.once('generateAfter', () => {
      // Simulate a late plugin adding a route after the guarded asset generator.
      hexo.route.set(alias.path, rawGpx);
      unlinkSync(raw.source);
    });
    await expect(hexo._generate()).rejects.toThrowError(
      new Error('[hexo-post-map] cannot verify raw asset source during track publication'),
    );
    expect(hexo.route.get(raw.path)).toBeUndefined();
    expect(hexo.route.get(alias.path)).toBeUndefined();
    expect(hexo.route.get(image.path)).toBeDefined();
  });

  it('quarantines an unresolved old route and rejects before any new watch updates', async () => {
    const { hexo, postAsset, asset } = await fixture();
    await postAsset('private.gpx', rawGpx);
    const image = await postAsset('photo.jpg', 'IMAGE_BYTES');
    const alias = await asset('broken-alias.gpx', join(hexo.source_dir, 'missing.gpx'));
    hexo.route.set(alias.path, rawGpx);
    hexo.route.set(image.path, 'IMAGE_BYTES');
    const updates: string[] = [];
    hexo.route.on('update', (path: string) => updates.push(path));
    await expect(hexo._generate()).rejects.toThrowError(
      new Error('[hexo-post-map] cannot verify raw asset source during track publication'),
    );
    expect(hexo.route.get(alias.path)).toBeUndefined();
    expect(hexo.route.get(image.path)).toBeDefined();
    expect(updates).toEqual([]);
  });

  it('removes a broken author symlink by its registered entry path without needing its target', async () => {
    const { hexo, post, postAsset, asset } = await fixture();
    const raw = await postAsset('private.gpx', rawGpx);
    const alias = await asset('_posts/author-link.gpx', raw.source);
    post.map = { points, track: { source: 'author-link.gpx' } };
    await post.save();
    await hexo.execFilter('before_generate', null, { context: hexo });
    await hexo.extend.generator.get('post-map').call(hexo, hexo.locals.toObject() as SiteLocals);
    hexo.route.set(alias.path, rawGpx);
    await rm(raw.source);
    await hexo.execFilter('after_generate', null, { context: hexo });
    expect(hexo.route.get(alias.path)).toBeUndefined();
  });
});
