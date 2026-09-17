import { describe, expect, it } from 'vitest';

import { resolveRepresentativeImage } from '../../src/presentation/image';

describe('resolveRepresentativeImage', () => {
  it('uses a safe Front Matter thumbnail before rendered content images', () => {
    expect(
      resolveRepresentativeImage({
        thumbnail: 'https://cdn.example.test/thumbnail.webp',
        content: '<p><img src="/images/content.webp" alt="Content"></p>',
      }),
    ).toBe('https://cdn.example.test/thumbnail.webp');
  });

  it('uses the first safe image from parsed rendered HTML when thumbnail is unsafe', () => {
    expect(
      resolveRepresentativeImage({
        thumbnail: 'javascript:alert(1)',
        content:
          '<p><img src="data:image/svg+xml,<svg>"><img alt="first" src="/images/first.webp"><img src="/images/later.webp"></p>',
      }),
    ).toBe('/images/first.webp');
  });

  it('falls back when no safe thumbnail or rendered image exists', () => {
    expect(
      resolveRepresentativeImage({
        thumbnail: 42,
        content: '<picture><img src="//cdn.example.test/cover.webp"></picture>',
      }),
    ).toBe('/hexo-post-map/assets/placeholder.svg');
  });
});
