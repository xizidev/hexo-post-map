import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPost } from '../../templates/overview';
import { sortPosts } from './cluster-decision';
import { createPostImage, revealPostImage } from './markers';
import type { PanelScroll } from './exploration-types';

export { createPostImage } from './markers';

let panelSequence = 0;
const immediateImageCount = 2;

export type PanelCloseReason = 'user' | 'replace' | 'teardown';

export interface PanelHandle {
  readonly element: HTMLElement;
  getScroll(): PanelScroll;
  restoreScroll(scroll: PanelScroll): void;
  destroy(reason?: PanelCloseReason): void;
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
    focusOnOpen?: boolean;
    onScroll?: (top: number) => void;
    onClose?: (reason: PanelCloseReason) => void;
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
  const deferredImages: HTMLImageElement[] = [];
  const imageCleanups: (() => void)[] = [];
  const rows: { element: HTMLElement; url?: string }[] = [];
  const rowsByUrl = new Map<string, HTMLElement>();
  const ambiguousUrls = new Set<string>();
  for (const [index, post] of sortPosts(posts).entries()) {
    const row = document.createElement('li');
    row.className = 'hpm-post';
    const deferred = index >= immediateImageCount;
    // Own fallback cleanup for immediate images as well as observer-revealed ones.
    const image = createPostImage(post, options.placeholderUrl ?? '', { deferred: true });
    if (deferred) deferredImages.push(image);
    else imageCleanups.push(revealPostImage(image, options.placeholderUrl ?? ''));
    image.className = 'hpm-post__image';
    const details = document.createElement('div');
    details.className = 'hpm-post__body';
    const title = document.createElement('span');
    title.className = 'hpm-post__title';
    title.textContent = post.title;
    const url = safeUrl(post.url, 'post');
    rows.push({ element: row, url: url ? post.url : undefined });
    if (url) {
      if (rowsByUrl.has(post.url)) ambiguousUrls.add(post.url);
      else rowsByUrl.set(post.url, row);
    }
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
  let imageObserver: IntersectionObserver | undefined;
  const loadImage = (image: HTMLImageElement) => {
    imageCleanups.push(revealPostImage(image, options.placeholderUrl ?? ''));
  };
  if (deferredImages.length > 0 && typeof globalThis.IntersectionObserver === 'function') {
    imageObserver = new IntersectionObserver(
      (entries) => {
        if (destroyed) return;
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
          const image = entry.target as HTMLImageElement;
          imageObserver?.unobserve(image);
          loadImage(image);
        }
      },
      { root: scroller, rootMargin: '120px 0px', threshold: 0.01 },
    );
    deferredImages.forEach((image) => imageObserver?.observe(image));
  } else deferredImages.forEach(loadImage);
  // Measure ordered row boxes only on checkpoint reads. A scroll event never
  // scans the list or reveals images; callers can merge their own checkpoints.
  function getScroll(): PanelScroll {
    const top = Math.max(0, scroller.scrollTop);
    if (destroyed || !rows.length) return { top };
    const viewportTop = scroller.getBoundingClientRect().top + scroller.clientTop;
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (rows[middle]!.element.getBoundingClientRect().top <= viewportTop) low = middle + 1;
      else high = middle;
    }
    const row = rows[Math.max(0, low - 1)]!;
    if (!row.url || ambiguousUrls.has(row.url)) return { top };
    return {
      top,
      anchor: { url: row.url, offset: row.element.getBoundingClientRect().top - viewportTop },
    };
  }
  function restoreScroll(scroll: PanelScroll) {
    if (destroyed) return;
    let top = Number.isFinite(scroll.top) ? scroll.top : 0;
    const row =
      scroll.anchor && !ambiguousUrls.has(scroll.anchor.url)
        ? rowsByUrl.get(scroll.anchor.url)
        : undefined;
    if (row && scroll.anchor && Number.isFinite(scroll.anchor.offset)) {
      top =
        row.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        scroller.clientTop +
        scroller.scrollTop -
        scroll.anchor.offset;
    }
    scroller.scrollTop = Math.max(
      0,
      Math.min(top, Math.max(0, scroller.scrollHeight - scroller.clientHeight)),
    );
  }
  function onScroll() {
    if (!destroyed && element.isConnected) options.onScroll?.(scroller.scrollTop);
  }
  function closeByUser() {
    destroy('user');
  }
  function destroy(reason: PanelCloseReason = 'user') {
    if (destroyed) return;
    destroyed = true;
    const restore = reason === 'user' && element.contains(document.activeElement);
    close.removeEventListener('click', closeByUser);
    element.removeEventListener('keydown', onKey);
    scroller.removeEventListener('scroll', onScroll);
    imageObserver?.disconnect();
    imageCleanups.forEach((cleanup) => cleanup());
    element.remove();
    if (restore) {
      const current = options.resolveOrigin ? options.resolveOrigin() : origin;
      const target = current?.isConnected ? current : options.fallback;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
    options.onClose?.(reason);
  }
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    destroy();
  }
  close.addEventListener('click', closeByUser);
  element.addEventListener('keydown', onKey);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  (options.container ?? document.body).append(element);
  if (options.focusOnOpen !== false) close.focus({ preventScroll: true });
  return { element, getScroll, restoreScroll, destroy };
}
