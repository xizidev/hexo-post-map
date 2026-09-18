// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createClusterMarker,
  createImageMarker,
  createPostImage,
} from '../../src/browser/overview/markers';
import type { OverviewPost } from '../../src/templates/overview';

const post: OverviewPost = {
  title: '外滩夜景',
  url: '/posts/bund-night/',
  image: '/images/bund-night.webp',
  date: '2026-09-18T00:00:00Z',
  location: { name: '上海', longitude: 121.490317, latitude: 31.241701 },
};

describe('overview marker elements', () => {
  it.each([
    [2, 'hpm-cluster__surface--small'],
    [10, 'hpm-cluster__surface--medium'],
    [100, 'hpm-cluster__surface--large'],
  ] as const)('sizes a %s-post cluster', (count, className) => {
    const marker = createClusterMarker(count);
    expect(marker.element.firstElementChild?.classList).toContain(className);
    expect(marker.element.textContent).toBe(String(count));
    expect(marker.element.getAttribute('aria-label')).toBe(`查看此处的 ${count} 篇文章`);
    expect(marker.offset).toEqual([-22, -22]);
  });

  it('rejects invalid cluster counts', () => {
    expect(() => createClusterMarker(1)).toThrow('Invalid cluster count');
    expect(() => createClusterMarker(2.5)).toThrow('Invalid cluster count');
    expect(() => createClusterMarker(Number.MAX_SAFE_INTEGER + 1)).toThrow('Invalid cluster count');
  });

  it('anchors a thumbnail above a stem and coordinate dot', () => {
    const marker = createImageMarker(post, '/placeholder.svg', false);
    expect(marker.element.querySelector('.hpm-image-marker__card img')).not.toBeNull();
    expect(marker.element.querySelector('.hpm-image-marker__stem')).not.toBeNull();
    expect(marker.element.querySelector('.hpm-image-marker__dot')).not.toBeNull();
    expect(marker.element.getAttribute('aria-label')).toBe(`预览文章：${post.title}`);
    expect(marker.offset).toEqual([-36, -72]);
  });

  it('uses the compact thumbnail anchor when requested', () => {
    expect(createImageMarker(post, '/placeholder.svg', true).offset).toEqual([-32, -66]);
  });

  it('replaces an image source with the placeholder after one error', () => {
    const image = createPostImage(post, '/placeholder.svg');
    image.dispatchEvent(new Event('error'));
    expect(image.getAttribute('src')).toBe('/placeholder.svg');
    image.dispatchEvent(new Event('error'));
    expect(image.getAttribute('src')).toBe('/placeholder.svg');
  });

  it('rejects unsafe image URLs', () => {
    const image = createPostImage({ ...post, image: 'data:text/html,unsafe' }, '/placeholder.svg');
    expect(image.getAttribute('src')).toBe('/placeholder.svg');
  });
});
