// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from '../../src/browser/detail/playback';
import type { DetailMapHandle } from '../../src/browser/providers/types';

function playbackFixture() {
  const root = document.createElement('section');
  root.innerHTML = `<div data-hpm-playback hidden>
    <button type="button" data-hpm-play aria-pressed="false">播放</button>
    <button type="button" data-hpm-restart>重新开始</button>
    <input type="range" data-hpm-progress min="0" max="1" step="0.001" value="0">
  </div>
  <div data-hpm-status aria-live="polite">地图已加载</div>`;
  document.body.append(root);
  return {
    root,
    controls: root.querySelector<HTMLElement>('[data-hpm-playback]')!,
    play: root.querySelector<HTMLButtonElement>('[data-hpm-play]')!,
    restart: root.querySelector<HTMLButtonElement>('[data-hpm-restart]')!,
    range: root.querySelector<HTMLInputElement>('[data-hpm-progress]')!,
    status: root.querySelector<HTMLElement>('[data-hpm-status]')!,
  };
}

function fakeAnimationFrames() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id);
  });
  return {
    callbacks,
    fire(timestamp: number) {
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error('No animation frame is pending');
      callbacks.delete(entry[0]);
      entry[1](timestamp);
    },
  };
}

function mediaQuery(initial = false) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    media: '(prefers-reduced-motion: reduce)',
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;
  return {
    query,
    change(next: boolean) {
      matches = next;
      const event = { matches: next, media: query.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function detailHandle() {
  return {
    hasTrack: true,
    destroy: vi.fn(),
    setInteractive: vi.fn(),
    setTrackProgress: vi.fn(),
  } satisfies DetailMapHandle;
}

beforeEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createPlaybackController', () => {
  it('reveals usable controls at progress zero without starting playback', () => {
    const view = playbackFixture();
    const frames = fakeAnimationFrames();
    const motion = mediaQuery();
    vi.spyOn(window, 'matchMedia').mockReturnValue(motion.query);
    const handle = detailHandle();

    const controller = createPlaybackController(view.root, handle);

    expect(view.controls.hidden).toBe(false);
    expect(view.range.value).toBe('0');
    expect(view.range.getAttribute('aria-valuetext')).toBe('行程进度 0%');
    expect(view.play.getAttribute('aria-pressed')).toBe('false');
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(0);
    expect(frames.callbacks.size).toBe(0);
    controller.destroy();
  });

  it('plays once per frame, pauses, and completes the fixed 30-second timeline', () => {
    const view = playbackFixture();
    const frames = fakeAnimationFrames();
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery().query);
    const handle = detailHandle();
    const controller = createPlaybackController(view.root, handle);

    view.play.click();
    view.play.click();
    expect(view.play.textContent).toBe('播放');
    expect(view.play.getAttribute('aria-pressed')).toBe('false');
    expect(frames.callbacks.size).toBe(0);

    view.play.click();
    expect(view.play.textContent).toBe('暂停');
    expect(view.play.getAttribute('aria-pressed')).toBe('true');
    expect(frames.callbacks.size).toBe(1);
    view.play.click();
    view.play.click();
    expect(frames.callbacks.size).toBe(1);
    frames.fire(1_000);
    expect(frames.callbacks.size).toBe(1);
    frames.fire(16_000);
    expect(Number(view.range.value)).toBeCloseTo(0.5);
    expect(view.range.getAttribute('aria-valuetext')).toBe('行程进度 50%');
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(0.5);
    expect(frames.callbacks.size).toBe(1);
    frames.fire(31_000);
    expect(view.range.value).toBe('1');
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(1);
    expect(view.play.textContent).toBe('播放');
    expect(view.play.getAttribute('aria-pressed')).toBe('false');
    expect(frames.callbacks.size).toBe(0);
    controller.destroy();
  });

  it('pauses on native range input, clamps progress, and restarts from zero', () => {
    const view = playbackFixture();
    const frames = fakeAnimationFrames();
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery().query);
    const handle = detailHandle();
    const controller = createPlaybackController(view.root, handle);

    view.play.click();
    view.range.value = '0.42';
    view.range.dispatchEvent(new Event('input'));
    expect(frames.callbacks.size).toBe(0);
    expect(view.play.getAttribute('aria-pressed')).toBe('false');
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(0.42);
    expect(view.range.getAttribute('aria-valuetext')).toBe('行程进度 42%');

    view.range.max = '10';
    view.range.value = '9';
    view.range.dispatchEvent(new Event('input'));
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(1);
    view.restart.click();
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(0);
    expect(view.range.value).toBe('0');
    expect(view.play.getAttribute('aria-pressed')).toBe('true');
    expect(frames.callbacks.size).toBe(1);
    controller.destroy();
  });

  it('does not write playback progress into the polite live region', () => {
    const view = playbackFixture();
    const frames = fakeAnimationFrames();
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery().query);
    const controller = createPlaybackController(view.root, detailHandle());

    view.play.click();
    frames.fire(0);
    frames.fire(15_000);

    expect(view.status.textContent).toBe('地图已加载');
    controller.destroy();
  });

  it('pauses continuous playback when the document becomes hidden', () => {
    const view = playbackFixture();
    const frames = fakeAnimationFrames();
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery().query);
    const controller = createPlaybackController(view.root, detailHandle());
    view.play.click();
    expect(frames.callbacks.size).toBe(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(frames.callbacks.size).toBe(0);
    expect(view.play.getAttribute('aria-pressed')).toBe('false');
    controller.destroy();
  });

  it('hides continuous controls under reduced motion while retaining manual seeking', () => {
    const view = playbackFixture();
    const frames = fakeAnimationFrames();
    const motion = mediaQuery(true);
    vi.spyOn(window, 'matchMedia').mockReturnValue(motion.query);
    const handle = detailHandle();
    const controller = createPlaybackController(view.root, handle);

    expect(view.controls.hidden).toBe(false);
    expect(view.play.hidden).toBe(true);
    expect(view.restart.hidden).toBe(true);
    expect(view.range.hidden).toBe(false);
    view.play.click();
    expect(frames.callbacks.size).toBe(0);
    view.range.value = '0.75';
    view.range.dispatchEvent(new Event('input'));
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(0.75);

    motion.change(false);
    expect(view.play.hidden).toBe(false);
    expect(view.restart.hidden).toBe(false);
    view.play.click();
    expect(frames.callbacks.size).toBe(1);
    motion.change(true);
    expect(frames.callbacks.size).toBe(0);
    expect(view.play.hidden).toBe(true);
    expect(view.restart.hidden).toBe(true);
    expect(view.range.hidden).toBe(false);
    controller.destroy();
  });

  it('destroys idempotently and ignores a cancelled late frame after controls are replaced', () => {
    const view = playbackFixture();
    const frames = fakeAnimationFrames();
    const motion = mediaQuery();
    vi.spyOn(window, 'matchMedia').mockReturnValue(motion.query);
    const handle = detailHandle();
    const controller = createPlaybackController(view.root, handle);
    view.play.click();
    const lateFrame = [...frames.callbacks.values()][0]!;
    const replacement = view.controls.cloneNode(true) as HTMLElement;
    view.controls.replaceWith(replacement);
    const callsBeforeDestroy = handle.setTrackProgress.mock.calls.length;

    controller.destroy();
    controller.destroy();
    const detachedButtonText = view.play.textContent;
    lateFrame(15_000);

    expect(handle.setTrackProgress).toHaveBeenCalledTimes(callsBeforeDestroy);
    expect(view.play.textContent).toBe(detachedButtonText);
    expect(replacement.querySelector<HTMLInputElement>('[data-hpm-progress]')!.value).toBe('0');
    expect(motion.query.removeEventListener).toHaveBeenCalledTimes(1);
    expect(frames.callbacks.size).toBe(0);
  });
});
