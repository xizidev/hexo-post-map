import type { DetailMapHandle } from '../providers/types';

const PLAYBACK_DURATION_MILLISECONDS = 30_000;

export interface PlaybackController {
  destroy(): void;
}

export interface PlaybackControllerOptions {
  /** Lets the detail owner fence frames against PJAX node replacement. */
  readonly isCurrent?: () => boolean;
}

function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Owns only playback DOM/listeners; the provider continues to own map resources. */
export function createPlaybackController(
  root: HTMLElement,
  handle: DetailMapHandle,
  options: PlaybackControllerOptions = {},
): PlaybackController {
  const controlsNode = root.querySelector<HTMLElement>('[data-hpm-playback]');
  const playButtonNode = root.querySelector<HTMLButtonElement>('[data-hpm-play]');
  const restartButtonNode = root.querySelector<HTMLButtonElement>('[data-hpm-restart]');
  const rangeNode = root.querySelector<HTMLInputElement>('[data-hpm-progress]');
  if (
    !controlsNode ||
    !playButtonNode ||
    !restartButtonNode ||
    !rangeNode ||
    !handle.setTrackProgress
  ) {
    throw new Error('Missing track playback controls');
  }
  const controls = controlsNode;
  const playButton = playButtonNode;
  const restartButton = restartButtonNode;
  const range = rangeNode;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let progress = 0;
  let playing = false;
  let disposed = false;
  let frameId: number | undefined;
  let startedAt: number | undefined;

  function isCurrent(): boolean {
    return (
      !disposed &&
      root.isConnected &&
      root.querySelector('[data-hpm-playback]') === controls &&
      root.querySelector('[data-hpm-play]') === playButton &&
      root.querySelector('[data-hpm-restart]') === restartButton &&
      root.querySelector('[data-hpm-progress]') === range &&
      (options.isCurrent?.() ?? true)
    );
  }

  function renderPlaying(): void {
    playButton.textContent = playing ? '暂停' : '播放';
    playButton.setAttribute('aria-pressed', String(playing));
  }

  function updateProgress(value: number): void {
    progress = clampProgress(value);
    range.value = String(progress);
    range.setAttribute('aria-valuetext', `行程进度 ${Math.round(progress * 100)}%`);
    handle.setTrackProgress!(progress);
  }

  function cancelFrame(): void {
    if (frameId === undefined) return;
    window.cancelAnimationFrame(frameId);
    frameId = undefined;
  }

  function pause(): void {
    playing = false;
    startedAt = undefined;
    cancelFrame();
    renderPlaying();
  }

  function onFrame(timestamp: number): void {
    frameId = undefined;
    if (disposed || !playing) return;
    if (!isCurrent()) {
      playing = false;
      startedAt = undefined;
      return;
    }
    startedAt ??= timestamp - progress * PLAYBACK_DURATION_MILLISECONDS;
    updateProgress((timestamp - startedAt) / PLAYBACK_DURATION_MILLISECONDS);
    if (progress >= 1) {
      pause();
      return;
    }
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (frameId !== undefined || !playing || disposed) return;
    frameId = window.requestAnimationFrame(onFrame);
  }

  function play(): void {
    if (disposed || reducedMotion?.matches || playing || !isCurrent()) return;
    if (progress >= 1) updateProgress(0);
    playing = true;
    startedAt = undefined;
    renderPlaying();
    scheduleFrame();
  }

  function onPlay(): void {
    if (playing) pause();
    else play();
  }

  function onRestart(): void {
    if (disposed || reducedMotion?.matches || !isCurrent()) return;
    pause();
    updateProgress(0);
    play();
  }

  function onInput(): void {
    if (disposed || !isCurrent()) return;
    pause();
    updateProgress(Number(range.value));
  }

  function onVisibilityChange(): void {
    if (document.hidden) pause();
  }

  function applyMotionPreference(): void {
    const reduced = reducedMotion?.matches ?? false;
    if (reduced) pause();
    playButton.hidden = reduced;
    restartButton.hidden = reduced;
    range.hidden = false;
  }

  function onMotionPreferenceChange(): void {
    if (!disposed) applyMotionPreference();
  }

  playButton.addEventListener('click', onPlay);
  restartButton.addEventListener('click', onRestart);
  range.addEventListener('input', onInput);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (reducedMotion?.addEventListener) {
    reducedMotion.addEventListener('change', onMotionPreferenceChange);
  } else {
    reducedMotion?.addListener(onMotionPreferenceChange);
  }
  controls.hidden = false;
  updateProgress(0);
  renderPlaying();
  applyMotionPreference();

  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      playing = false;
      cancelFrame();
      playButton.removeEventListener('click', onPlay);
      restartButton.removeEventListener('click', onRestart);
      range.removeEventListener('input', onInput);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (reducedMotion?.removeEventListener) {
        reducedMotion.removeEventListener('change', onMotionPreferenceChange);
      } else {
        reducedMotion?.removeListener(onMotionPreferenceChange);
      }
    },
  };
}
