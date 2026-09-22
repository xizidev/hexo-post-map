import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPost } from '../../templates/overview';

export interface MarkerElement {
  readonly element: HTMLButtonElement;
  readonly offset: readonly [x: number, y: number];
}

// Match the painted card, stem and dot in index.css; browser geometry tests
// enforce the relationship rather than assuming these offsets stay correct.
const leafGeometry = {
  desktop: { width: 72, cardHeight: 54, stemHeight: 10, dotDiameter: 8 },
  compact: { width: 64, cardHeight: 48, stemHeight: 10, dotDiameter: 8 },
};
function dotCenterY(geometry: (typeof leafGeometry)['desktop']): number {
  return geometry.cardHeight + geometry.stemHeight + geometry.dotDiameter / 2;
}

// Reserve the largest responsive footprint and a 32px edge gutter. AMap's
// avoid order is top, bottom, left, right; both initial and cluster fits use it.
export const overviewFitPadding = [dotCenterY(leafGeometry.desktop) + 32, 48, 48, 48];

function attachImageFallback(
  image: HTMLImageElement,
  placeholderUrl: string,
  checkCurrentSource: boolean,
): () => void {
  const fallback = () => {
    const safe = safeUrl(placeholderUrl, 'image');
    if (safe) image.src = safe;
  };
  image.addEventListener('error', fallback, { once: true });
  if (checkCurrentSource && image.complete && image.naturalWidth === 0) {
    image.removeEventListener('error', fallback);
    fallback();
  }
  return () => image.removeEventListener('error', fallback);
}

/** One replacement only: a missing placeholder cannot produce an error loop. */
export function installImageFallback(image: HTMLImageElement, placeholderUrl: string): () => void {
  return attachImageFallback(image, placeholderUrl, true);
}

interface PostImageOptions {
  readonly deferred?: boolean;
}

export function createPostImage(
  post: OverviewPost,
  placeholderUrl: string,
  options: PostImageOptions = {},
): HTMLImageElement {
  const image = document.createElement('img');
  image.alt = post.title;
  image.width = 96;
  image.height = 72;
  image.loading = 'lazy';
  image.decoding = 'async';
  const source = safeUrl(post.image, 'image') ?? safeUrl(placeholderUrl, 'image');
  if (options.deferred) {
    if (source) image.dataset.hpmSource = source;
  } else {
    if (source) image.src = source;
    installImageFallback(image, placeholderUrl);
  }
  return image;
}

export function revealPostImage(image: HTMLImageElement, placeholderUrl: string): () => void {
  const source = safeUrl(image.dataset.hpmSource ?? '', 'image');
  if (!source) return () => {};
  delete image.dataset.hpmSource;
  const cleanup = attachImageFallback(image, placeholderUrl, false);
  image.src = source;
  return cleanup;
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
  const geometry = compact ? leafGeometry.compact : leafGeometry.desktop;
  return { element, offset: [-geometry.width / 2, -dotCenterY(geometry)] };
}
