// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createExplorationController,
  readBrowserExplorationConfig,
} from '../../src/browser/overview/exploration';
import type {
  OverviewPanelState,
  OverviewView,
} from '../../src/browser/overview/exploration-types';
import type { OverviewMapHandle } from '../../src/browser/providers/types';

const post = {
  title: 'A',
  url: '/a/',
  date: '2026-01-01T00:00:00Z',
  image: '/a.jpg',
  location: { name: 'A', longitude: 121, latitude: 31 },
};
const flags = { restore: true, share: false, random: false };
const key = 'hexo-post-map.overview-state.v1';
function fixture(
  owner = new Window({ url: 'https://example.test/map/' }),
  path = '/map/',
  restore = true,
  create = createExplorationController,
) {
  const doc = owner.document as unknown as Document;
  const root = doc.createElement('section');
  const canvas = doc.createElement('div');
  const toolbar = doc.createElement('div');
  const showList = doc.createElement('button');
  toolbar.append(showList);
  root.append(canvas, toolbar);
  doc.body.append(root);
  let panel: OverviewPanelState = { mode: 'closed' };
  let view: OverviewView = { center: [121, 31], zoom: 8 };
  let listener: (() => void) | undefined;
  let current = true;
  const open = vi.fn((state: OverviewPanelState) => {
    panel = state;
  });
  const read = vi.fn(() => panel);
  const controller = create({
    root,
    canvas,
    toolbar,
    showList,
    overviewUrl: path,
    dataUrl: `${path}posts.json`,
    flags: { ...flags, restore },
    maxZoom: 18,
    posts: [post],
    panel: { read, open },
    isCurrent: () => current,
  });
  const handle: OverviewMapHandle = {
    destroy() {},
    setInteractive() {},
    getView: () => view,
    setView() {},
    focusPost() {},
    onViewEnd(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    owner,
    root,
    controller,
    handle,
    open,
    read,
    activate: () => controller.activate(handle),
    panel(state: OverviewPanelState) {
      panel = state;
      controller.changed();
    },
    view(zoom: number) {
      view = { ...view, zoom };
      listener?.();
    },
    invalidate() {
      current = false;
    },
    saved() {
      return JSON.parse(owner.sessionStorage.getItem(key) ?? '{"scopes":[]}').scopes;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('browser exploration config', () => {
  it('accepts complete safe config and disables old or unsafe projections', () => {
    expect(
      readBrowserExplorationConfig(
        { overviewUrl: '/map/', exploration: flags },
        'https://example.test',
      ),
    ).toEqual({ overviewUrl: '/map/', flags });
    for (const raw of [
      {},
      { overviewUrl: '/map/' },
      { overviewUrl: 'javascript:alert(1)', exploration: flags },
      { overviewUrl: 'https://user:password@example.test/map/', exploration: flags },
      { overviewUrl: '/map/', exploration: { ...flags, restore: 'true' } },
    ])
      expect(readBrowserExplorationConfig(raw, 'https://example.test')).toBeUndefined();
  });
});
describe('exploration checkpoints', () => {
  it('coalesces saves and preserves an open panel on teardown', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.panel({ mode: 'all', scroll: { top: 20 } });
    f.view(12);
    vi.advanceTimersByTime(199);
    expect(f.saved()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(f.saved()[0].snapshot.view.zoom).toBe(12);
    f.controller.destroy({ save: true });
    expect(f.saved()[0].snapshot.panel.mode).toBe('all');
  });
  it('restores memory before session without taking focus even when the storage getter throws', () => {
    const f = fixture();
    f.activate();
    f.panel({ mode: 'all', scroll: { top: 12 } });
    f.controller.destroy({ save: true });
    Object.defineProperty(f.owner, 'sessionStorage', {
      get() {
        throw new Error('blocked');
      },
    });
    const next = fixture(f.owner);
    expect(next.controller.initialView).toEqual({ center: [121, 31], zoom: 8 });
    next.activate();
    expect(next.open).toHaveBeenCalledWith({ mode: 'all', scroll: { top: 12 } }, { focus: false });
    next.controller.destroy({ save: false });
  });
  it('persists user close as closed', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.panel({ mode: 'all', scroll: { top: 1 } });
    f.panel({ mode: 'closed' });
    vi.advanceTimersByTime(200);
    expect(f.saved()[0].snapshot.panel).toEqual({ mode: 'closed' });
    f.controller.destroy({ save: false });
  });
  it('does not save failed partial initialization or legacy handles', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.activate({ destroy() {}, setInteractive() {} });
    f.panel({ mode: 'all', scroll: { top: 0 } });
    vi.advanceTimersByTime(200);
    f.controller.destroy({ save: false });
    expect(f.saved()).toHaveLength(0);
  });
  it('discards pending complete-handle state on initialization failure', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.panel({ mode: 'all', scroll: { top: 7 } });
    f.controller.destroy({ save: false });
    vi.advanceTimersByTime(200);
    expect(f.saved()).toHaveLength(0);
  });
  it('restores persisted session state in another document and applies it only once', () => {
    const f = fixture();
    f.activate();
    f.view(13);
    f.panel({ mode: 'single', urls: ['/a/'], scroll: { top: 9 } });
    f.controller.destroy({ save: true });
    const owner = new Window({ url: 'https://example.test/map/' });
    owner.sessionStorage.setItem(key, f.owner.sessionStorage.getItem(key)!);
    const next = fixture(owner);
    expect(next.controller.initialView?.zoom).toBe(13);
    next.activate();
    next.activate();
    expect(next.open).toHaveBeenCalledTimes(1);
    expect(next.open).toHaveBeenCalledWith(
      { mode: 'single', urls: ['/a/'], scroll: { top: 9 } },
      { focus: false },
    );
    next.controller.destroy({ save: false });
  });
  it('does not apply an existing restored panel to a partial legacy handle', () => {
    const f = fixture();
    f.activate();
    f.panel({ mode: 'all', scroll: { top: 9 } });
    f.controller.destroy({ save: true });
    const next = fixture(f.owner);
    next.controller.activate({ destroy() {}, setInteractive() {} });
    expect(next.open).not.toHaveBeenCalled();
    next.controller.destroy({ save: true });
    expect(f.saved()[0].snapshot.panel).toEqual({ mode: 'all', scroll: { top: 9 } });
  });
  it('ignores late old-controller timers and does not reread invalid DOM', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.view(10);
    vi.advanceTimersByTime(200);
    f.view(15);
    f.invalidate();
    f.controller.destroy({ save: true });
    vi.advanceTimersByTime(200);
    expect(f.saved()[0].snapshot.view.zoom).toBe(15);
  });
  it('retains an immediate panel candidate when the root is removed before the timer', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.panel({ mode: 'all', scroll: { top: 7 } });
    f.root.remove();
    f.invalidate();
    f.controller.destroy({ save: true });
    expect(f.saved()[0].snapshot.panel).toEqual({ mode: 'all', scroll: { top: 7 } });
  });
  it('never lets a replaced scope overwrite the new controller candidate', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.view(10);
    const next = fixture(f.owner);
    next.activate();
    next.view(17);
    next.controller.destroy({ save: true });
    vi.advanceTimersByTime(200);
    expect(f.saved()[0].snapshot.view.zoom).toBe(17);
    f.invalidate();
    f.controller.destroy({ save: true });
    expect(f.saved()[0].snapshot.view.zoom).toBe(17);
  });
  it('retains scope ownership across a re-evaluated feature bundle', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.view(10);
    vi.resetModules();
    const reloaded = await import('../../src/browser/overview/exploration');
    const next = fixture(f.owner, '/map/', true, reloaded.createExplorationController);
    next.activate();
    next.view(17);
    next.controller.destroy({ save: true });
    vi.advanceTimersByTime(200);
    expect(f.saved()[0].snapshot.view.zoom).toBe(17);
    f.controller.destroy({ save: true });
    expect(f.saved()[0].snapshot.view.zoom).toBe(17);
  });
  it('does not read panel geometry on scroll until the checkpoint', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.activate();
    f.controller.changed({ scroll: true });
    f.controller.changed({ scroll: true });
    vi.advanceTimersByTime(199);
    expect(f.read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.read).toHaveBeenCalledTimes(1);
    f.controller.destroy({ save: false });
  });
  it('clears only this scope when restore is false', () => {
    const f = fixture();
    f.activate();
    f.controller.destroy({ save: true });
    const other = fixture(f.owner, '/other/');
    other.activate();
    other.controller.destroy({ save: true });
    const disabled = fixture(f.owner, '/map/', false);
    disabled.activate();
    disabled.controller.destroy({ save: true });
    expect(f.saved().map((entry: { scope: string }) => JSON.parse(entry.scope)[1])).toEqual([
      '/other/',
    ]);
  });
  it('checkpoints persisted pagehide without restoring twice', () => {
    const f = fixture();
    f.activate();
    f.panel({ mode: 'all', scroll: { top: 4 } });
    const event = new f.owner.Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: true });
    f.owner.dispatchEvent(event);
    expect(f.saved()[0].snapshot.panel.mode).toBe('all');
    f.activate();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.controller.isCurrent()).toBe(true);
    f.controller.destroy({ save: false });
  });
  it('keeps simultaneous roots and scopes independent', () => {
    const f = fixture();
    const g = fixture(f.owner, '/second/');
    f.activate();
    g.activate();
    f.panel({ mode: 'all', scroll: { top: 3 } });
    f.controller.destroy({ save: true });
    g.controller.destroy({ save: true });
    expect(
      f
        .saved()
        .map((entry: { snapshot: { panel: OverviewPanelState } }) => entry.snapshot.panel.mode),
    ).toEqual(['all', 'closed']);
  });
});
