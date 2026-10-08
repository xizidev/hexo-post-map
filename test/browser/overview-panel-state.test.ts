// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPostPanel, type PanelHandle } from '../../src/browser/overview/panel';
import type { OverviewPost } from '../../src/templates/overview';

const posts: OverviewPost[] = Array.from({ length: 8 }, (_, index) => ({
  title: `Post ${index}`,
  url: `/post-${index}/`,
  image: '/image.jpg',
  date: `2026-01-${String(20 - index).padStart(2, '0')}`,
  location: { name: 'Shanghai', longitude: 121, latitude: 31 },
}));
const panels: PanelHandle[] = [];
function setup(input = posts, options: Parameters<typeof renderPostPanel>[2] = {}) {
  const outside = document.createElement('button');
  const root = document.createElement('div');
  document.body.append(outside, root);
  outside.focus();
  const panel = renderPostPanel(input, 'mobile', { container: root, ...options });
  panels.push(panel);
  const scroller = panel.element.querySelector<HTMLElement>('.hpm-panel__scroller')!;
  const rows = Array.from(panel.element.querySelectorAll<HTMLElement>('.hpm-post'));
  let height = 100;
  Object.defineProperties(scroller, {
    clientHeight: { get: () => 200 },
    scrollHeight: { get: () => rows.length * height },
    clientTop: { get: () => 0 },
  });
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => ({ top: 50 }) as DOMRect);
  const measurements = rows.map((row, index) =>
    vi
      .spyOn(row, 'getBoundingClientRect')
      .mockImplementation(() => ({ top: 50 + index * height - scroller.scrollTop }) as DOMRect),
  );
  return {
    panel,
    outside,
    scroller,
    rows,
    measurements,
    resize: (next: number) => {
      height = next;
    },
  };
}
afterEach(() => {
  panels.splice(0).forEach((panel) => panel.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('panel scroll checkpoints', () => {
  it('restores a panel without moving page focus', () => {
    const { panel, outside, scroller } = setup(posts, { focusOnOpen: false });
    panel.restoreScroll?.({ top: 400, anchor: { url: '/post-4/', offset: -12 } });
    expect(document.activeElement).toBe(outside);
    expect(scroller.scrollTop).toBe(412);
    expect(panel.getScroll?.()).toEqual({ top: 412, anchor: { url: '/post-4/', offset: -12 } });
  });
  it('prioritizes the URL anchor after responsive card height changes', () => {
    const { panel, scroller, resize } = setup();
    scroller.scrollTop = 212;
    const saved = panel.getScroll?.();
    expect(saved).toEqual({ top: 212, anchor: { url: '/post-2/', offset: -12 } });
    resize(180);
    if (saved) panel.restoreScroll?.(saved);
    expect(scroller.scrollTop).toBe(372);
  });
  it.each(['missing', 'ambiguous'])('falls back to pixels for a %s URL anchor', (kind) => {
    const input =
      kind === 'ambiguous' ? posts.map((post) => ({ ...post, url: '/duplicate/' })) : posts;
    const { panel, scroller } = setup(input);
    panel.restoreScroll?.({
      top: 123,
      anchor: { url: kind === 'missing' ? '/gone/' : '/duplicate/', offset: -12 },
    });
    expect(scroller.scrollTop).toBe(123);
    if (kind === 'ambiguous') expect(panel.getScroll?.()).toEqual({ top: 123 });
  });
  it.each([
    { top: -100, want: 0 },
    { top: 1_000_000, want: 600 },
    { top: NaN, want: 0 },
  ])('clamps restored pixels to the actual scroll range: %j', ({ top, want }) => {
    const { panel, scroller } = setup();
    panel.restoreScroll?.({ top });
    expect(scroller.scrollTop).toBe(want);
  });
  it.each([
    { offset: -10_000, want: 600 },
    { offset: 10_000, want: 0 },
  ])('clamps resolved anchors to the actual range: %j', ({ offset, want }) => {
    const { panel, scroller } = setup();
    panel.restoreScroll({ top: 123, anchor: { url: '/post-4/', offset } });
    expect(scroller.scrollTop).toBe(want);
  });
  it('captures no URL anchor for an unsafe article reference', () => {
    const { panel, scroller } = setup([{ ...posts[0]!, url: 'javascript:alert(1)' }]);
    scroller.scrollTop = 0;
    expect(panel.getScroll()).toEqual({ top: 0 });
  });
  it('does not read geometry or rebuild images on scroll and measures logarithmically at checkpoint', () => {
    class ImageObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', ImageObserver);
    const input = Array.from({ length: 1000 }, (_, index) => ({
      ...posts[0]!,
      url: `/large-${index}/`,
    }));
    const onScroll = vi.fn();
    const { panel, scroller, measurements } = setup(input, { onScroll });
    const images = Array.from(panel.element.querySelectorAll('img'));
    scroller.scrollTop = 54321;
    for (let i = 0; i < 25; i++) scroller.dispatchEvent(new Event('scroll'));
    expect(onScroll).toHaveBeenCalledTimes(25);
    expect(onScroll).toHaveBeenLastCalledWith(54321);
    expect(scroller.getBoundingClientRect).not.toHaveBeenCalled();
    expect(measurements.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(0);
    expect(panel.getScroll?.()).toEqual({
      top: 54321,
      anchor: { url: '/large-543/', offset: -21 },
    });
    expect(measurements.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBeLessThanOrEqual(
      12,
    );
    expect(Array.from(panel.element.querySelectorAll('img'))).toEqual(images);
    expect(images.filter((image) => image.hasAttribute('src'))).toHaveLength(2);
  });
  it('ignores scroll delivery after the panel is disconnected before teardown', () => {
    const onScroll = vi.fn();
    const { panel, scroller, measurements } = setup(posts, { onScroll });
    panel.element.remove();
    scroller.scrollTop = 400;
    scroller.dispatchEvent(new Event('scroll'));
    expect(onScroll).not.toHaveBeenCalled();
    expect(measurements.every((measurement) => measurement.mock.calls.length === 0)).toBe(true);
  });
  it('uses row boxes for content-visibility without measuring hidden card contents', () => {
    const { panel, scroller, rows } = setup();
    rows.forEach((row) => {
      row.style.contentVisibility = 'auto';
    });
    const inner = rows.map((row) => vi.spyOn(row.firstElementChild!, 'getBoundingClientRect'));
    scroller.scrollTop = 312;
    expect(panel.getScroll?.()).toEqual({ top: 312, anchor: { url: '/post-3/', offset: -12 } });
    expect(inner.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
  it.each(['user', 'replace', 'teardown'] as const)(
    'distinguishes %s close and restores focus only for user close',
    (reason) => {
      const origin = document.createElement('button');
      document.body.append(origin);
      const focus = vi.spyOn(origin, 'focus');
      const onClose = vi.fn();
      const onScroll = vi.fn();
      const { panel, scroller } = setup(posts, { origin, onClose, onScroll });
      panel.destroy(reason);
      expect(onClose).toHaveBeenCalledWith(reason);
      expect(panel.element.isConnected).toBe(false);
      if (reason === 'user') expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      else expect(focus).not.toHaveBeenCalled();
      scroller.dispatchEvent(new Event('scroll'));
      expect(onScroll).not.toHaveBeenCalled();
      panel.destroy();
      expect(onClose).toHaveBeenCalledOnce();
    },
  );
  it('focuses open and Escape return targets with preventScroll', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const onClose = vi.fn();
    const { panel, outside } = setup(posts, { onClose });
    expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true }]);
    panel.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(outside);
    expect(onClose).toHaveBeenCalledWith('user');
    expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true }]);
  });
  it('preserves outside focus on user close when focus already left the panel', () => {
    const { panel, outside } = setup();
    outside.focus();
    const focus = vi.spyOn(outside, 'focus');
    panel.destroy();
    expect(document.activeElement).toBe(outside);
    expect(focus).not.toHaveBeenCalled();
  });
  it.each(['replace', 'teardown'] as const)(
    'disconnects deferred-image observer on %s',
    (reason) => {
      const disconnect = vi.fn();
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect = disconnect;
        },
      );
      const { panel } = setup();
      panel.destroy(reason);
      expect(disconnect).toHaveBeenCalledOnce();
    },
  );
  it.each(['user', 'replace', 'teardown'] as const)(
    'cleans immediate and revealed image fallbacks before late errors after %s',
    (reason) => {
      // Isolate request delivery: Happy DOM can otherwise fail src assignments
      // automatically before the explicit late-error lifecycle check.
      const sources = new WeakMap<HTMLImageElement, string>();
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
      vi.spyOn(HTMLImageElement.prototype, 'src', 'get').mockImplementation(function (
        this: HTMLImageElement,
      ) {
        return sources.get(this) ?? '';
      });
      const writes = vi
        .spyOn(HTMLImageElement.prototype, 'src', 'set')
        .mockImplementation(function (this: HTMLImageElement, source: string) {
          sources.set(this, source);
        });
      let deliver!: IntersectionObserverCallback;
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: IntersectionObserverCallback) {
            deliver = callback;
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const { panel } = setup(
        posts.slice(0, 4).map((post, index) => ({ ...post, image: `/image-${index}.jpg` })),
        { placeholderUrl: '/fallback.jpg' },
      );
      const images = Array.from(panel.element.querySelectorAll('img'));
      expect(images.map((image) => image.src)).toEqual(['/image-0.jpg', '/image-1.jpg', '', '']);
      const reveal = (image: HTMLImageElement) =>
        deliver(
          [
            {
              target: image,
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: new DOMRect(0, 0, 96, 72),
              intersectionRect: new DOMRect(0, 0, 96, 72),
              rootBounds: null,
              time: 0,
            },
          ],
          {} as IntersectionObserver,
        );
      reveal(images[2]!);
      expect(images[2]!.src).toBe('/image-2.jpg');
      panel.destroy(reason);
      writes.mockClear();
      images.forEach((image) => image.dispatchEvent(new Event('error')));
      reveal(images[3]!);
      expect(images.map((image) => image.src)).toEqual([
        '/image-0.jpg',
        '/image-1.jpg',
        '/image-2.jpg',
        '',
      ]);
      expect(writes).not.toHaveBeenCalled();
    },
  );
});
