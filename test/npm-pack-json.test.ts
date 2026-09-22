import { describe, expect, it } from 'vitest';
import { normalizeNpmPackJson } from '../scripts/npm-pack-json.mjs';

const pack = {
  filename: 'hexo-post-map-0.2.1.tgz',
  files: [{ path: 'dist/index.cjs' }],
};

describe('normalizeNpmPackJson', () => {
  it('keeps the npm 11 array shape', () => {
    expect(normalizeNpmPackJson([pack])).toEqual([pack]);
  });

  it('normalizes the npm 12 package-keyed object shape', () => {
    expect(normalizeNpmPackJson({ 'hexo-post-map': pack })).toEqual([pack]);
  });

  it.each([null, undefined, 'invalid', 1, true])('rejects invalid pack JSON: %j', (value) => {
    expect(() => normalizeNpmPackJson(value)).toThrow('Unsupported npm pack --json output');
  });
});
