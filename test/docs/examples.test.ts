import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveConfig } from '../../src/config/resolve';
import { normalizePostMap, normalizePostMapDocument } from '../../src/domain/normalize';
import { parseGeoJson } from '../../src/tracks/geojson';
import { parseGpx } from '../../src/tracks/gpx';

const visualThemeVariables = [
  '--hpm-accent',
  '--hpm-accent-contrast',
  '--hpm-cluster-surface',
  '--hpm-cluster-border',
  '--hpm-panel-surface',
  '--hpm-panel-border',
  '--hpm-card-surface',
  '--hpm-text',
  '--hpm-muted',
  '--hpm-route-color',
  '--hpm-track-color',
  '--hpm-track-progress-color',
  '--hpm-track-control-surface',
  '--hpm-track-control-border',
  '--hpm-panel-radius',
  '--hpm-card-radius',
] as const;

function examples(file: string, marker: string): Record<string, unknown>[] {
  const markdown = markdownFile(file);
  return Array.from(
    markdown.matchAll(new RegExp('```yaml test=' + marker + '\\n([\\s\\S]*?)```', 'gu')),
  ).map((match) => parse(match[1]!) as Record<string, unknown>);
}

function markdownFile(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
}

function sourceExamples(file: string, language: string, marker: string): string[] {
  return Array.from(
    markdownFile(file).matchAll(
      new RegExp('```' + language + ' test=' + marker + '\\n([\\s\\S]*?)```', 'gu'),
    ),
  ).map((match) => match[1]!);
}

describe.each(['README.md', 'README.zh-CN.md'])('%s authoring examples', (file) => {
  it('documents every supported visual theme variable', () => {
    const markdown = markdownFile(file);
    for (const variable of visualThemeVariables) expect(markdown).toContain(`\`${variable}\``);
  });

  it('builds the four documented post shapes with the expected representative and route', () => {
    const posts = examples(file, 'post-map');
    expect(posts).toHaveLength(4);
    const maps = posts.map((post) => normalizePostMap(post.map, file));
    expect(maps[0]).toBeNull();
    expect(maps[1]?.representative.id).toBe('shanghai');
    expect(maps[1]?.points).toHaveLength(1);
    expect(maps[2]?.representative.id).toBe('old-city');
    expect(maps[2]?.points).toHaveLength(2);
    expect(maps[2]?.route).toEqual([]);
    expect(maps[3]?.representative.id).toBe('summit');
    expect(maps[3]?.route.map((point) => point.id)).toEqual([
      'visitor-center',
      'cableway',
      'summit',
    ]);
  });

  it('enables the full configuration with file credentials or either environment mode', () => {
    const configs = examples(file, 'config');
    expect(configs).toHaveLength(1);
    const raw = configs[0]!.post_map;
    const fileConfigured = resolveConfig(raw, {});
    expect(fileConfigured?.amap).toEqual({
      key: 'replace-with-your-web-key',
      mapStyle: 'amap://styles/dark',
      securityJsCode: 'replace-with-your-security-js-code',
    });
    const proxy = resolveConfig(raw, {
      HEXO_POST_MAP_AMAP_KEY: 'example-test-key',
      HEXO_POST_MAP_AMAP_SERVICE_HOST: 'https://maps.example.com/_AMapService',
    });
    expect(proxy?.amap).toEqual({
      key: 'example-test-key',
      mapStyle: 'amap://styles/dark',
      serviceHost: 'https://maps.example.com/_AMapService',
    });
    expect(proxy?.overview.path).toBe('map/');
    expect(proxy?.post.position).toBe('before');
    const client = resolveConfig(raw, {
      HEXO_POST_MAP_AMAP_KEY: 'example-test-key',
      HEXO_POST_MAP_AMAP_SECURITY_JS_CODE: 'example-test-code',
    });
    expect(client?.amap).toEqual({
      key: 'example-test-key',
      mapStyle: 'amap://styles/dark',
      securityJsCode: 'example-test-code',
    });
  });

  it('keeps copyable GPX and GeoJSON authoring examples equivalent and valid', () => {
    const tracked = examples(file, 'post-map-track').map((post) =>
      normalizePostMapDocument(post.map, file),
    );
    expect(tracked).toHaveLength(2);
    expect(tracked[0]?.map.representative.id).toBe('station');
    expect(tracked[0]?.track).toEqual({
      source: './tracks/nanjing.gpx',
      privacy: { trimStartMeters: 300, trimEndMeters: 300 },
      simplifyToleranceMeters: 5,
      playback: true,
    });
    expect(tracked[1]?.map.representative.id).toBe('old-city');
    expect(tracked[1]?.track).toEqual({
      source: './tracks/nanjing.geojson',
      privacy: { trimStartMeters: 0, trimEndMeters: 0 },
      simplifyToleranceMeters: 5,
      playback: false,
    });
    expect(tracked).toEqual(
      examples('docs/front-matter.md', 'post-map-track').map((post) =>
        normalizePostMapDocument(post.map, 'docs/front-matter.md'),
      ),
    );
  });
});

describe('recorded-track documentation contract', () => {
  it('keeps root and subpath examples deployable without repeating the Hexo root', () => {
    const roots = examples('docs/configuration.md', 'root-config');
    expect(roots).toEqual([
      { root: '/', post_map: { overview: { path: 'map/' } } },
      { root: '/blog/', post_map: { overview: { path: 'map/' } } },
    ]);
  });

  it('keeps the focused file-based proxy configuration valid', () => {
    const [documented] = examples('docs/configuration.md', 'config');
    expect(resolveConfig(documented?.post_map, {})).toMatchObject({
      amap: {
        key: 'replace-with-your-web-key',
        mapStyle: 'amap://styles/dark',
        serviceHost: 'https://maps.example.com/_AMapService',
      },
    });
  });

  it.each([
    [
      'README.md',
      [
        /points[^.\n]*required[^.\n]*GCJ-02/iu,
        /track[^.\n]*optional[^.\n]*WGS84/iu,
        /8 MiB[\s\S]*200,000[\s\S]*2,000/u,
        /privacy trim[\s\S]*statistics[\s\S]*simplif[\s\S]*hash/iu,
        /does not anonymize|not anonymization/iu,
        /never starts automatically|no autoplay/iu,
        /reduced motion[\s\S]*manual seek/iu,
      ],
    ],
    [
      'README.zh-CN.md',
      [
        /points[^。\n]*必填[^。\n]*GCJ-02/iu,
        /track[^。\n]*可选[^。\n]*WGS84/iu,
        /8 MiB[\s\S]*200,000[\s\S]*2,000/u,
        /隐私裁剪[\s\S]*统计[\s\S]*简化[\s\S]*哈希/u,
        /不能匿名化|不是匿名化/u,
        /不会自动播放|不自动播放/u,
        /减少动态效果[\s\S]*手动拖动|减弱动态效果[\s\S]*手动拖动/u,
      ],
    ],
  ])('%s states the coordinate, privacy, limit, and playback boundaries', (file, patterns) => {
    const markdown = markdownFile(file);
    for (const pattern of patterns) expect(markdown).toMatch(pattern);
    expect(markdown).toMatch(/\.gpx/iu);
    expect(markdown).toMatch(/\.geojson/iu);
    expect(markdown).toMatch(/\.json/iu);
    expect(markdown).toContain('`_config.yml`');
    expect(markdown).toContain('security_js_code');
  });

  it('documents the publication and failure boundaries in focused references', () => {
    const frontMatter = markdownFile('docs/front-matter.md');
    const security = markdownFile('docs/security.md');
    const compatibility = markdownFile('docs/compatibility.md');
    const releases = markdownFile('docs/releases.md');
    expect(frontMatter).toMatch(/relative to the (?:article|post)[\s\S]*WGS84/iu);
    expect(frontMatter).toMatch(/trim[\s\S]*statistics[\s\S]*simplif[\s\S]*SHA-256/iu);
    expect(security).toMatch(/source_dir[\s\S]*symlink[\s\S]*raw source/iu);
    expect(security).toMatch(/not anonymization|does not anonymize/iu);
    expect(compatibility).toMatch(/fetch[\s\S]*convert[\s\S]*schematic/iu);
    expect(compatibility).toMatch(/overview[\s\S]*never[\s\S]*track/iu);
    expect(releases).toMatch(/v0\.5[\s\S]*content-addressed|v0\.5[\s\S]*hashed/iu);
  });

  it.each([
    [
      'README.md',
      /route-only[\s\S]*waypoint-only[\s\S]*GPX 1\.0[\s\S]*(?:not supported|fail)/iu,
      /other (?:supported )?standard geometr(?:y|ies)[\s\S]*(?:ignored|not treated as tracks)[\s\S]*(?:no usable line|fail)/iu,
      /two distinct usable points[\s\S]*same segment/iu,
    ],
    [
      'README.zh-CN.md',
      /仅含[^。\n]*(?:路线|rte)[\s\S]*仅含[^。\n]*(?:航点|wpt)[\s\S]*GPX 1\.0[\s\S]*(?:不支持|失败)/u,
      /其他[^。\n]*(?:geometry|几何)[\s\S]*(?:忽略|不作为轨迹)[\s\S]*(?:没有可用线|失败)/iu,
      /同一(?:轨迹)?段[\s\S]*两个[^。\n]*不同[^。\n]*可用点/u,
    ],
    [
      'docs/front-matter.md',
      /route-only[\s\S]*waypoint-only[\s\S]*GPX 1\.0[\s\S]*(?:not supported|fail)/iu,
      /other (?:supported )?standard geometr(?:y|ies)[\s\S]*(?:ignored|not treated as tracks)[\s\S]*(?:no usable line|fail)/iu,
      /two distinct usable points[\s\S]*same segment/iu,
    ],
  ])(
    '%s states the exact GPX and GeoJSON parser boundary',
    (file, unsupportedGpx, ignoredGeoJson, usableSegment) => {
      const markdown = markdownFile(file);
      expect(markdown).toContain('http://www.topografix.com/GPX/1/1');
      expect(markdown).toMatch(/GPX 1\.1[\s\S]*`trk`[\s\S]*`trkseg`[\s\S]*`trkpt`/iu);
      expect(markdown).toMatch(unsupportedGpx);
      expect(markdown).toMatch(
        /`LineString`[\s\S]*`MultiLineString`[\s\S]*`Feature`[\s\S]*`FeatureCollection`[\s\S]*`GeometryCollection`/u,
      );
      expect(markdown).toMatch(ignoredGeoJson);
      expect(markdown).toContain('`[longitude, latitude, optional elevation]`');
      expect(markdown).toMatch(usableSegment);
    },
  );

  it.each(['README.md', 'README.zh-CN.md', 'docs/front-matter.md'])(
    '%s keeps its minimal GPX and GeoJSON source examples parser-valid',
    (file) => {
      const gpx = sourceExamples(file, 'xml', 'track-source-gpx');
      const geoJson = sourceExamples(file, 'json', 'track-source-geojson');
      expect(gpx).toHaveLength(1);
      expect(geoJson).toHaveLength(1);
      if (gpx.length !== 1 || geoJson.length !== 1) return;
      expect(parseGpx(Buffer.from(gpx[0]!))).toEqual([
        [{ coordinate: [118.79, 32.08] }, { coordinate: [118.791, 32.081] }],
      ]);
      expect(parseGeoJson(Buffer.from(geoJson[0]!))).toEqual([
        [
          { coordinate: [118.79, 32.08], elevationMeters: 10 },
          { coordinate: [118.791, 32.081], elevationMeters: 14 },
        ],
      ]);
    },
  );
});
