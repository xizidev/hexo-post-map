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
import type { OverviewMapHandle, OverviewMapOptions } from '../../src/browser/providers/types';
import type { OverviewPost } from '../../src/templates/overview';
import { hydrateOverview } from '../../src/browser/overview/index';
import {
  createBrowserRuntime,
  type BrowserRuntimeOptions,
} from '../../src/browser/runtime/runtime';

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
  share = false,
  randomOptions: { random?: boolean; posts?: readonly OverviewPost[]; maxZoom?: number } = {},
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
    flags: { ...flags, restore, share, random: randomOptions.random ?? false },
    maxZoom: randomOptions.maxZoom ?? 18,
    posts: randomOptions.posts ?? [post],
    panel: { read, open },
    isCurrent: () => current,
  });
  const handle: OverviewMapHandle = {
    destroy() {},
    setInteractive() {},
    getView: () => view,
    setView() {},
    focusPost: vi.fn((selected, zoom) => {
      view = { center: [selected.location.longitude, selected.location.latitude], zoom };
    }),
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
    viewEnd: () => listener,
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
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

describe('share runtime ownership', () => {
  async function runtimeFixture(
    failMount = false,
    settings?: {
      legacy?: boolean;
      missing?: 'overviewUrl' | 'exploration';
      flags?: { restore: boolean; share: boolean; random: boolean };
    },
  ) {
    const owner = new Window({ url: 'http://127.0.0.1:4000/blog/map/' });
    const document = owner.document as unknown as Document;
    vi.stubGlobal('window', owner);
    vi.stubGlobal('document', document);
    const root = document.createElement('section');
    root.dataset.hpmOverview = '';
    const canvas = document.createElement('div');
    canvas.dataset.hpmCanvas = '';
    const data = document.createElement('script');
    data.dataset.hpmData = '';
    const config: Record<string, unknown> = {
      provider: 'amap',
      amap: { key: 'public-test-key' },
      cluster: { gridSize: 72, maxZoom: 18 },
      dataUrl: '/blog/map/posts.json',
      placeholderUrl: '/placeholder.svg',
      overviewUrl: '/blog/map/',
      exploration: settings?.flags ?? { restore: false, share: true, random: false },
    };
    if (settings?.missing) delete config[settings.missing];
    data.textContent = JSON.stringify(config);
    root.append(canvas, data);
    document.body.append(root);
    const destroyed = vi.fn();
    const mount = vi.fn<
      (container: HTMLElement, options: OverviewMapOptions) => Promise<OverviewMapHandle>
    >(async () => {
      if (failMount) throw new Error('map failed');
      if (settings?.legacy) return { destroy: destroyed, setInteractive() {} };
      return {
        destroy: destroyed,
        setInteractive() {},
        getView: () => ({ center: [121, 31] as const, zoom: 11 }),
        setView() {},
        focusPost() {},
        onViewEnd: () => () => {},
      };
    });
    const runtime = createBrowserRuntime({
      page: owner as unknown as BrowserRuntimeOptions['page'],
      document,
      assetBase: new URL('http://127.0.0.1:4000/assets/'),
      mutationObserver: null,
      resources: { ensure: async () => true, isReady: () => true, stop() {} },
    });
    runtime.register({
      id: 'overview',
      selector: '[data-hpm-overview]',
      mount: (element) =>
        hydrateOverview(
          element,
          async () => ({ mountOverview: mount }),
          async () => new Response(JSON.stringify({ version: 1, posts: [post] })),
        ),
    });
    runtime.start();
    document.dispatchEvent(new owner.Event('DOMContentLoaded') as unknown as Event);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    return { owner, root, runtime, mount, destroyed };
  }
  it.each(['toolbar', 'all', 'share', 'status', 'manual', 'input', 'label', 'close', 'random'])(
    'refresh cleans a replaced %s control and remounts one current toolbar',
    async (part) => {
      const f = await runtimeFixture(false, {
        flags: { restore: false, share: true, random: true },
      });
      if (['manual', 'input', 'label', 'close'].includes(part)) {
        Object.defineProperty(f.owner.navigator, 'clipboard', { value: undefined });
        f.root.querySelector<HTMLButtonElement>('[data-hpm-share]')!.click();
      }
      const selectors = {
        toolbar: '[data-hpm-toolbar]',
        all: '[data-hpm-show-list]',
        share: '[data-hpm-share]',
        status: '[data-hpm-share-status]',
        manual: '[data-hpm-share-manual]',
        input: 'input',
        label: 'label',
        close: '[data-hpm-share-close]',
        random: '[data-hpm-random]',
      };
      const old = f.root.querySelector(selectors[part as keyof typeof selectors])!;
      expect(old).not.toBeNull();
      old.replaceWith(old.cloneNode(true));
      // A late SDK marker callback must not open stale UI before refresh disposes it.
      f.mount.mock.calls[0]![1].onPostSelect(post, f.root);
      expect(f.root.querySelector('.hpm-panel')).toBeNull();
      f.runtime.api.refresh(f.root);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(f.destroyed).toHaveBeenCalledTimes(1);
      expect(f.mount).toHaveBeenCalledTimes(2);
      expect(f.root.querySelectorAll('[data-hpm-toolbar]')).toHaveLength(1);
      expect(f.root.querySelectorAll('[data-hpm-random]')).toHaveLength(1);
      expect(f.root.querySelector('[data-hpm-share-manual]')).toBeNull();
      f.runtime.api.destroy();
    },
  );
  it('keeps a failed map fallback stable on refresh without sharing or implicit provider retries', async () => {
    const f = await runtimeFixture(true, {
      flags: { restore: false, share: true, random: true },
    });
    expect(f.root.dataset.hpmActive).toBe('false');
    expect(f.root.querySelector('[data-hpm-share]')).toBeNull();
    expect(f.root.querySelector('[data-hpm-random]')).toBeNull();
    f.runtime.api.refresh(f.root);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(f.mount).toHaveBeenCalledTimes(1);
    f.runtime.api.destroy();
  });
  it('opens a real article preview and returns user-close focus to the random button', async () => {
    const f = await runtimeFixture(false, {
      flags: { restore: false, share: true, random: true },
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const random = f.root.querySelector<HTMLButtonElement>('[data-hpm-random]')!;
    random.click();
    const panel = f.root.querySelector<HTMLElement>('.hpm-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('a')?.getAttribute('href')).toBe('/a/');
    panel.querySelector<HTMLButtonElement>('.hpm-panel__close')!.click();
    expect(f.root.querySelector('.hpm-panel')).toBeNull();
    expect(f.root.ownerDocument.activeElement).toBe(random);
    expect(f.owner.location.pathname).toBe('/blog/map/');
    f.runtime.api.destroy();
  });
  it.each(['overviewUrl', 'exploration'] as const)(
    'preserves old HTML missing %s without showing new share controls',
    async (missing) => {
      const f = await runtimeFixture(false, { missing });
      expect(f.root.dataset.hpmActive).toBe('true');
      expect(f.root.querySelector('[data-hpm-share]')).toBeNull();
      expect(f.root.querySelector('[data-hpm-random]')).toBeNull();
      f.runtime.api.destroy();
    },
  );
  it.each([true, false])(
    'keeps sharing independent of restore=%s and disables it for legacy capabilities',
    async (restore) => {
      for (const legacy of [true, false]) {
        const f = await runtimeFixture(false, {
          legacy,
          flags: { restore, share: true, random: true },
        });
        expect(f.root.dataset.hpmActive).toBe('true');
        expect(!!f.root.querySelector('[data-hpm-share]')).toBe(!legacy);
        expect(!!f.root.querySelector('[data-hpm-random]')).toBe(!legacy);
        f.runtime.api.destroy();
      }
    },
  );
});
describe('random exploration controls', () => {
  const a = { ...post, location: { name: 'A', longitude: 121.123456789, latitude: 31.987654321 } };
  const b = { ...post, title: 'B', url: '/b/' };
  const c = { ...post, title: 'C', url: '/c/' };
  function randomFixture(posts: readonly OverviewPost[] = [a, b, c], maxZoom = 18) {
    return fixture(undefined, '/map/', false, createExplorationController, true, {
      random: true,
      posts,
      maxZoom,
    });
  }
  function button(f: ReturnType<typeof fixture>) {
    const control = f.root.querySelector<HTMLButtonElement>('[data-hpm-random]');
    expect(control).not.toBeNull();
    return control!;
  }
  it('defaults random off and hides zero-candidate and incomplete-capability buttons', () => {
    const rng = vi.spyOn(Math, 'random');
    const disabled = fixture();
    disabled.activate();
    expect(disabled.root.querySelector('[data-hpm-random]')).toBeNull();
    const empty = randomFixture([{ ...a, url: '' }, a, { ...a }]);
    empty.activate();
    expect(empty.root.querySelector('[data-hpm-random]')).toBeNull();
    const legacy = randomFixture();
    legacy.controller.activate({ destroy() {}, setInteractive() {} });
    expect(legacy.root.querySelector('[data-hpm-random]')).toBeNull();
    expect(rng).not.toHaveBeenCalled();
  });
  it('shows the button only after activation and previews the exact chosen location without navigation', () => {
    const f = randomFixture();
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    const push = vi.spyOn(f.owner.history, 'pushState');
    const replace = vi.spyOn(f.owner.history, 'replaceState');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const href = f.owner.location.href;
    expect(f.root.querySelector('[data-hpm-random]')).toBeNull();
    f.activate();
    button(f).click();
    expect(f.handle.focusPost).toHaveBeenCalledWith(a, 11, { immediately: false });
    expect(f.handle.getView?.()).toEqual({ center: [121.123456789, 31.987654321], zoom: 11 });
    expect(f.open).toHaveBeenCalledWith(
      { mode: 'single', urls: ['/a/'], scroll: { top: 0 } },
      { focus: true, origin: button(f), resolveOrigin: expect.any(Function) },
    );
    expect(rng).toHaveBeenCalledTimes(1);
    expect(f.owner.location.href).toBe(href);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.root.querySelector('[data-hpm-share]')).not.toBeNull();
    f.controller.destroy({ save: false });
  });
  it('excludes current single before the last random choice and keeps last choice local to a controller', () => {
    const f = randomFixture();
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    f.activate();
    button(f).click();
    button(f).click();
    expect(f.handle.focusPost).toHaveBeenLastCalledWith(b, 11, { immediately: false });
    f.panel({ mode: 'closed' });
    button(f).click();
    expect(f.handle.focusPost).toHaveBeenLastCalledWith(a, 11, { immediately: false });
    f.panel({ mode: 'single', urls: ['/c/'], scroll: { top: 0 } });
    rng.mockReturnValue(0.6);
    button(f).click();
    expect(f.handle.focusPost).toHaveBeenLastCalledWith(b, 11, { immediately: false });
    const next = randomFixture();
    rng.mockReturnValue(0);
    next.activate();
    button(next).click();
    expect(next.handle.focusPost).toHaveBeenCalledWith(a, 11, { immediately: false });
  });
  it.each([
    [15, 18, 15],
    [4, 8, 8],
  ])('honors reduced motion and clamps current zoom %s at maximum %s', (current, max, target) => {
    const f = randomFixture([a], max);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    Object.defineProperty(f.owner, 'matchMedia', {
      value: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }),
    });
    f.activate();
    f.view(current);
    button(f).click();
    expect(f.handle.focusPost).toHaveBeenCalledWith(a, target, { immediately: true });
  });
  it.each(['/unknown/', '/c/'])(
    'falls back to the last random choice for non-unique single %s',
    (url) => {
      const f = randomFixture([a, b, c, { ...c }]);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      f.activate();
      button(f).click();
      f.panel({ mode: 'single', urls: [url], scroll: { top: 0 } });
      button(f).click();
      expect(f.handle.focusPost).toHaveBeenLastCalledWith(b, 11, { immediately: false });
    },
  );
  it('a failing SDK focus leaves the panel closed', () => {
    const f = randomFixture();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    f.activate();
    vi.mocked(f.handle.focusPost!).mockImplementationOnce(() => {
      throw new Error('sdk');
    });
    button(f).click();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.read()).toEqual({ mode: 'closed' });
  });
  it.each([NaN, Infinity, -0.1, 1])('invalid rng=%s leaves map and panel untouched', (sample) => {
    const f = randomFixture();
    f.activate();
    vi.spyOn(Math, 'random').mockReturnValue(sample);
    button(f).click();
    expect(f.handle.focusPost).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });
  it('late view-end after rapid choices and a user close only checkpoints the view', () => {
    vi.useFakeTimers();
    const f = fixture(undefined, '/map/', true, createExplorationController, false, {
      random: true,
      posts: [a, b, c],
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    f.activate();
    const lateViewEnd = f.viewEnd()!;
    button(f).click();
    button(f).click();
    f.panel({ mode: 'closed' });
    lateViewEnd();
    vi.advanceTimersByTime(200);
    expect(f.open).toHaveBeenCalledTimes(2);
    expect(f.saved()[0].snapshot).toMatchObject({ view: { zoom: 11 }, panel: { mode: 'closed' } });
    f.controller.destroy({ save: false });
    lateViewEnd();
    expect(f.open).toHaveBeenCalledTimes(2);
  });
  it.each(['close', 'new choice', 'dispose'] as const)(
    'a reentrant SDK %s fences the older random panel',
    (action) => {
      const f = randomFixture();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      f.activate();
      vi.mocked(f.handle.focusPost!).mockImplementationOnce(() => {
        if (action === 'close') f.panel({ mode: 'closed' });
        if (action === 'new choice') button(f).click();
        if (action === 'dispose') f.controller.destroy({ save: false });
      });
      button(f).click();
      expect(f.open).toHaveBeenCalledTimes(action === 'new choice' ? 1 : 0);
      if (action === 'new choice')
        expect(f.open.mock.calls[0]![0]).toEqual({
          mode: 'single',
          urls: ['/b/'],
          scroll: { top: 0 },
        });
    },
  );
  it('view-end during focus does not cancel the current random preview', () => {
    const f = randomFixture();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    f.activate();
    vi.mocked(f.handle.focusPost!).mockImplementationOnce(() => f.viewEnd()?.());
    button(f).click();
    expect(f.open).toHaveBeenCalledTimes(1);
  });
  it('replacement identity blocks old random and clipboard actions before SDK reads', async () => {
    const f = randomFixture();
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    let resolve!: () => void;
    Object.defineProperty(f.owner.navigator, 'clipboard', {
      value: {
        writeText: () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      },
    });
    f.activate();
    f.root.querySelector<HTMLButtonElement>('[data-hpm-share]')!.click();
    const random = button(f);
    random.replaceWith(random.cloneNode(true));
    const getView = vi.spyOn(f.handle, 'getView');
    expect(f.controller.isCurrent()).toBe(false);
    random.click();
    resolve();
    await Promise.resolve();
    expect(rng).not.toHaveBeenCalled();
    expect(getView).not.toHaveBeenCalled();
    expect(f.root.querySelector('[data-hpm-share-status]')?.textContent).toBe('');
  });
});
describe('exploration checkpoints', () => {
  it('selects a valid explicit share without hydrating storage first', () => {
    const owner = new Window({
      url: 'http://127.0.0.1:4000/map/?hpm_v=1&hpm_center=120,30&hpm_zoom=16',
    });
    const getter = vi.fn(() => {
      throw new Error('blocked');
    });
    Object.defineProperty(owner, 'sessionStorage', { get: getter });
    const f = fixture(owner, '/map/', true, createExplorationController, true);
    expect(f.controller.initialView).toEqual({ center: [120, 30], zoom: 16 });
    expect(getter).not.toHaveBeenCalled();
    f.controller.destroy({ save: false });
  });
  it('explicit share wins over memory and session before mount and opens single without focus', () => {
    const owner = new Window({
      url: 'https://example.test/map/?hpm_v=1&hpm_center=120,30&hpm_zoom=16&hpm_post=%2Fa%2F',
    });
    const f = fixture(owner);
    f.activate();
    f.view(12);
    f.panel({ mode: 'all', scroll: { top: 10 } });
    f.controller.destroy({ save: true });
    const next = fixture(owner, '/map/', true, createExplorationController, true);
    expect(next.controller.initialView).toEqual({ center: [120, 30], zoom: 16 });
    next.activate();
    expect(next.open).toHaveBeenCalledWith(
      { mode: 'single', urls: ['/a/'], scroll: { top: 0 } },
      { focus: false },
    );
    next.controller.destroy({ save: false });
    const freshOwner = new Window({ url: owner.location.href });
    freshOwner.sessionStorage.setItem(key, owner.sessionStorage.getItem(key)!);
    const fresh = fixture(freshOwner, '/map/', true, createExplorationController, true);
    expect(fresh.controller.initialView?.zoom).toBe(16);
  });
  it('shares the live view and panel with restore disabled and does not consume a disabled query', () => {
    const owner = new Window({
      url: 'https://example.test/map/?hpm_v=1&hpm_center=120,30&hpm_zoom=16',
    });
    const disabled = fixture(owner);
    expect(disabled.controller.initialView).toBeUndefined();
    disabled.activate();
    expect(disabled.root.querySelector('[data-hpm-share]')).toBeNull();
    const f = fixture(owner, '/map/', false, createExplorationController, true);
    expect(f.root.querySelector('[data-hpm-share]')).toBeNull();
    f.activate();
    f.view(14);
    f.panel({ mode: 'single', urls: ['/a/'], scroll: { top: 88 } });
    Object.defineProperty(owner.navigator, 'clipboard', { value: undefined });
    f.root.querySelector<HTMLButtonElement>('[data-hpm-share]')!.click();
    const url = new URL(f.root.querySelector('input')!.value);
    expect(url.searchParams.get('hpm_zoom')).toBe('14');
    expect(url.searchParams.get('hpm_post')).toBe('/a/');
    expect(f.saved()).toHaveLength(0);
  });
  it('ignores explicit query in embedded roots and hides sharing for incomplete capabilities', () => {
    const owner = new Window({
      url: 'https://example.test/article/?hpm_v=1&hpm_center=120,30&hpm_zoom=16',
    });
    const f = fixture(owner, '/map/', true, createExplorationController, true);
    expect(f.controller.initialView).toBeUndefined();
    f.controller.activate({
      destroy() {},
      setInteractive() {},
      getView: () => ({ center: [1, 2], zoom: 3 }),
    });
    expect(f.root.querySelector('[data-hpm-share]')).toBeNull();
  });
  it('invalidates replaced toolbar/all/share/status identities without rereading them', () => {
    for (const selector of ['[data-hpm-share]', '[aria-live]', 'button', 'div']) {
      const f = fixture(undefined, '/map/', true, createExplorationController, true);
      f.activate();
      // Fixtures expose the same base toolbar/all nodes used by the coordinator.
      const toolbar = f.root.children[1]!;
      const target = selector === 'div' ? toolbar : toolbar.querySelector(selector)!;
      target.replaceWith(target.cloneNode(true));
      expect(f.controller.isCurrent()).toBe(false);
    }
  });
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
