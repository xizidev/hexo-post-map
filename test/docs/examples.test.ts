import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveConfig } from '../../src/config/resolve';
import { normalizePostMap } from '../../src/domain/normalize';

function examples(file: string, marker: string): Record<string, unknown>[] {
  const markdown = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  return Array.from(
    markdown.matchAll(new RegExp('```yaml test=' + marker + '\\n([\\s\\S]*?)```', 'gu')),
  ).map((match) => parse(match[1]!) as Record<string, unknown>);
}

describe.each(['README.md', 'README.zh-CN.md'])('%s authoring examples', (file) => {
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

  it('enables the full configuration with either documented environment security mode', () => {
    const configs = examples(file, 'config');
    expect(configs).toHaveLength(1);
    const raw = configs[0]!.post_map;
    const proxy = resolveConfig(raw, {
      HEXO_POST_MAP_AMAP_KEY: 'example-test-key',
      HEXO_POST_MAP_AMAP_SERVICE_HOST: 'https://maps.example.com/_AMapService',
    });
    expect(proxy?.amap).toEqual({
      key: 'example-test-key',
      serviceHost: 'https://maps.example.com/_AMapService',
    });
    expect(proxy?.overview.path).toBe('map/');
    expect(proxy?.post.position).toBe('before');
    const client = resolveConfig(raw, {
      HEXO_POST_MAP_AMAP_KEY: 'example-test-key',
      HEXO_POST_MAP_AMAP_SECURITY_JS_CODE: 'example-test-code',
    });
    expect(client?.amap).toEqual({ key: 'example-test-key', securityJsCode: 'example-test-code' });
  });
});
