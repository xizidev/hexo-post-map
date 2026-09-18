import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPost } from '../../templates/overview';
import { sortPosts } from './cluster-decision';
import { createPostImage } from './markers';

export { createPostImage } from './markers';

let panelSequence = 0;

export interface PanelHandle {
  readonly element: HTMLElement;
  destroy(): void;
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
    onClose?: () => void;
  } = {},
): PanelHandle {
  const origin =
    options.origin ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const element = document.createElement('section');
  element.className = 'hpm-panel';
  element.id = `hpm-panel-${++panelSequence}`;
  element.dataset.hpmViewport = viewport;
  element.setAttribute('role', 'dialog');
  // Non-modal: readers can still interact with the map and surrounding page.
  element.setAttribute('aria-modal', 'false');
  const label = `${posts.length} 篇文章`;
  element.setAttribute('aria-label', label);
  const header = document.createElement('header');
  header.className = 'hpm-panel__header';
  const heading = document.createElement('h2');
  heading.className = 'hpm-panel__title';
  heading.textContent = label;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'hpm-panel__close';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭文章面板');
  header.append(heading, close);
  const scroller = document.createElement('div');
  scroller.className = 'hpm-panel__scroller';
  const list = document.createElement('ol');
  list.className = 'hpm-post-list';
  for (const post of sortPosts(posts)) {
    const row = document.createElement('li');
    row.className = 'hpm-post';
    const image = createPostImage(post, options.placeholderUrl ?? '');
    image.className = 'hpm-post__image';
    const details = document.createElement('div');
    details.className = 'hpm-post__body';
    const title = document.createElement('span');
    title.className = 'hpm-post__title';
    title.textContent = post.title;
    const url = safeUrl(post.url, 'post');
    const card = document.createElement(url ? 'a' : 'div');
    card.className = 'hpm-post__link';
    if (url) card.setAttribute('href', url);
    const time = document.createElement('time');
    time.className = 'hpm-post__date';
    time.dateTime = post.date;
    time.textContent = post.date.slice(0, 10);
    const location = document.createElement('span');
    location.className = 'hpm-post__location';
    location.textContent = post.location.name;
    details.append(title, time, location);
    card.append(image, details);
    row.append(card);
    list.append(row);
  }
  scroller.append(list);
  element.append(header, scroller);
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
    options.onClose?.();
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
