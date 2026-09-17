import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPost } from '../../templates/overview';
import { sortPosts } from './cluster-decision';

export interface PanelHandle {
  readonly element: HTMLElement;
  destroy(): void;
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

export function renderPostPanel(
  posts: readonly OverviewPost[],
  viewport: 'desktop' | 'mobile',
  options: {
    container?: HTMLElement;
    placeholderUrl?: string;
    origin?: HTMLElement;
    resolveOrigin?: () => HTMLElement | undefined;
    fallback?: HTMLElement;
  } = {},
): PanelHandle {
  const origin =
    options.origin ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const element = document.createElement('section');
  element.className = 'hpm-panel';
  element.dataset.hpmViewport = viewport;
  element.setAttribute('role', 'dialog');
  // Non-modal: readers can still reach the page and its chronological article links.
  element.setAttribute('aria-modal', 'false');
  element.setAttribute('aria-label', posts.length === 1 ? '文章预览' : '此处的文章');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'hpm-panel__close';
  close.textContent = '关闭文章面板';
  const list = document.createElement('ol');
  list.className = 'hpm-post-list';
  for (const post of sortPosts(posts)) {
    const row = document.createElement('li');
    row.className = 'hpm-post';
    const image = createPostImage(post, options.placeholderUrl ?? '');
    const details = document.createElement('div');
    const title = document.createElement('span');
    title.textContent = post.title;
    const url = safeUrl(post.url, 'post');
    if (url) {
      const imageLink = document.createElement('a');
      imageLink.href = url;
      imageLink.append(image);
      const titleLink = document.createElement('a');
      titleLink.href = url;
      titleLink.append(title);
      row.append(imageLink);
      details.append(titleLink);
    } else {
      row.append(image);
      details.append(title);
    }
    const time = document.createElement('time');
    time.dateTime = post.date;
    time.textContent = post.date.slice(0, 10);
    const location = document.createElement('span');
    location.textContent = post.location.name;
    details.append(time, location);
    row.append(details);
    list.append(row);
  }
  element.append(close, list);
  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    const restore = element.contains(document.activeElement);
    close.removeEventListener('click', destroy);
    element.removeEventListener('keydown', onKey);
    element.remove();
    if (restore) {
      const current = options.resolveOrigin ? options.resolveOrigin() : origin;
      const target = current?.isConnected ? current : options.fallback;
      if (target?.isConnected) target.focus();
    }
  }
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    destroy();
  }
  close.addEventListener('click', destroy);
  element.addEventListener('keydown', onKey);
  (options.container ?? document.body).append(element);
  close.focus();
  return { element, destroy };
}
