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

  it('uses a Live Photo still image in rendered document order', () => {
    expect(
      resolveRepresentativeImage({
        content:
          '<p>Before</p><div class="gallery live-photo" data-photo-src="https://cdn.example.test/live-photo.jpeg" data-video-src="https://cdn.example.test/live-photo.mov"></div><img src="/images/later.webp">',
      }),
    ).toBe('https://cdn.example.test/live-photo.jpeg');
  });

  it('skips an unsafe Live Photo still image and continues to a later safe image', () => {
    expect(
      resolveRepresentativeImage({
        content:
          '<div class="live-photo" data-photo-src="java&#x73;cript:alert(1)" data-video-src="/videos/unsafe.mov"></div><div class="live-photo" data-photo-src="/images/safe.webp" data-video-src="/videos/safe.mov"></div>',
      }),
    ).toBe('/images/safe.webp');
  });

  it('rejects entity-decoded executable sources and ignores empty src and srcset-only images', () => {
    expect(
      resolveRepresentativeImage({
        content:
          '<img src="java&#x73;cript:alert(1)"><img src=""><img srcset="/images/srcset.webp 1x"><img src="/images/safe.webp">',
      }),
    ).toBe('/images/safe.webp');
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
