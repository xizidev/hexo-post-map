import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPost } from '../../templates/overview';

export interface MarkerElement {
  readonly element: HTMLButtonElement;
  readonly offset: readonly [x: number, y: number];
}

/** One replacement only: a missing placeholder cannot produce an error loop. */
export function installImageFallback(image: HTMLImageElement, placeholderUrl: string): () => void {
  const fallback = () => {
    const safe = safeUrl(placeholderUrl, 'image');
    if (safe) image.src = safe;
  };
  image.addEventListener('error', fallback, { once: true });
  if (image.complete && image.naturalWidth === 0) {
    image.removeEventListener('error', fallback);
    fallback();
  }
  return () => image.removeEventListener('error', fallback);
}

export function createPostImage(post: OverviewPost, placeholderUrl: string): HTMLImageElement {
  const image = document.createElement('img');
  image.alt = post.title;
  image.width = 96;
  image.height = 72;
  image.loading = 'lazy';
  const source = safeUrl(post.image, 'image') ?? safeUrl(placeholderUrl, 'image');
  if (source) image.src = source;
  installImageFallback(image, placeholderUrl);
  return image;
}

export function createClusterMarker(count: number): MarkerElement {
  if (!Number.isSafeInteger(count) || count < 2) throw new Error('Invalid cluster count');
  const modifier = count >= 100 ? 'large' : count >= 10 ? 'medium' : 'small';
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'hpm-cluster';
  element.setAttribute('aria-label', `查看此处的 ${count} 篇文章`);
  const surface = document.createElement('span');
  surface.className = `hpm-cluster__surface hpm-cluster__surface--${modifier}`;
  surface.textContent = String(count);
  surface.setAttribute('aria-hidden', 'true');
  element.append(surface);
  return { element, offset: [-22, -22] };
}

export function createImageMarker(
  post: OverviewPost,
  placeholderUrl: string,
  compact: boolean,
): MarkerElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'hpm-image-marker';
  element.setAttribute('aria-label', `预览文章：${post.title}`);
  const card = document.createElement('span');
  card.className = 'hpm-image-marker__card';
  card.append(createPostImage(post, placeholderUrl));
  const stem = document.createElement('span');
  stem.className = 'hpm-image-marker__stem';
  stem.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'hpm-image-marker__dot';
  dot.setAttribute('aria-hidden', 'true');
  element.append(card, stem, dot);
  return { element, offset: compact ? [-32, -66] : [-36, -72] };
}
