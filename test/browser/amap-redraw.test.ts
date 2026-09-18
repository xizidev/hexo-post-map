// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAMapProvider } from '../../src/browser/providers/amap';
import type { MapHandle, OverviewMapOptions } from '../../src/browser/providers/types';
import type { OverviewPost } from '../../src/templates/overview';

const sdk = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));

interface ClusterPoint {
  lnglat: number[];
  post: OverviewPost;
  postId: number;
}
interface RenderContext {
  marker: ClusterMarker;
  clusterData?: ClusterPoint[];
  data?: ClusterPoint[];
}
interface ClusterOptions {
  renderClusterMarker(context: RenderContext): void;
  renderMarker(context: RenderContext): void;
}
class ClusterMarker {
  content!: HTMLButtonElement;
  offset: { x: number; y: number } | undefined;
  setContent(content: HTMLButtonElement) {
    this.content = content;
  }
  setOffset(pixel: { x: number; y: number }) {
    this.offset = pixel;
  }
}
let map: FakeMap;
let cluster: FakeCluster;
class FakeMap {
  listeners = new Map<string, () => void>();
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    map = this;
  }
  on(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  off(event: string) {
    this.listeners.delete(event);
  }
  getZoom() {
    return 18;
  }
  setBounds() {}
  setStatus() {}
  destroy = vi.fn();
}
class FakeCluster {
  setMap = vi.fn();
  constructor(
    _map: FakeMap,
    readonly data: ClusterPoint[],
    readonly options: ClusterOptions,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    cluster = this;
  }
}
const handles: MapHandle[] = [];
async function setup() {
  sdk.load.mockResolvedValue({
    Map: FakeMap,
    MarkerCluster: FakeCluster,
    Bounds: class {},
    Pixel: class {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    },
  });
  const provider = await createAMapProvider({
    provider: 'amap',
    amap: { key: 'key', serviceHost: '/proxy' },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const options: OverviewMapOptions = {
    posts: Array.from({ length: 12 }, (_, index) => ({
      title: `Post ${index}`,
      url: `/post-${index}/`,
      image: '/image.jpg',
      date: '2026-01-01T00:00:00Z',
      location: { name: 'Shanghai', longitude: 121, latitude: 31 },
    })),
    gridSize: 60,
    maxZoom: 18,
    placeholderUrl: '/placeholder.svg',
    onPostSelect: vi.fn(),
    onGroupSelect: vi.fn(),
  };
  const pending = provider.mountOverview(container, options);
  await Promise.resolve();
  map.listeners.get('complete')!();
  const handle = await pending;
  handles.push(handle);
  handle.setInteractive(true);
  return { container, options, handle };
}
function render(indices = [0, 1], marker = new ClusterMarker()) {
  cluster.options.renderClusterMarker({
    marker,
    clusterData: indices.map((index) => cluster.data[index]!),
  });
  return marker;
}
async function settleDom() {
  // Let MutationObserver delivery and the following paint both finish.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}
function expectNoClickListener(button: HTMLButtonElement) {
  const parent = document.createElement('div');
  const received = vi.fn();
  parent.addEventListener('click', received);
  parent.append(button);
  // Disabled form controls suppress click bubbling in the DOM implementation. Re-enable
  // this held stale reference so a leftover adapter listener cannot hide behind disabled.
  button.disabled = false;
  const event = new MouseEvent('click', { bubbles: true });
  button.dispatchEvent(event);
  // The adapter's listener stops propagation before checking disabled state.
  expect(received).toHaveBeenCalledOnce();
  button.disabled = true;
  button.remove();
}
afterEach(() => {
  handles.splice(0).forEach((handle) => handle.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('AMap overview redraw resource lifetime', () => {
  it.each(['same-members', 'changed-members'])(
    'updates only the visible button after 200 new-marker redraws: %s',
    async (kind) => {
      const { container, handle } = await setup();
      const history: HTMLButtonElement[] = [];
      for (let index = 0; index < 200; index++) {
        const members =
          kind === 'same-members'
            ? [0, 1]
            : [
                0,
                9,
                ...Array.from({ length: 8 }, (_, bit) => bit + 1).filter(
                  (bit) => index & (1 << (bit - 1)),
                ),
              ];
        const marker = render(members);
        container.replaceChildren(marker.content);
        history.push(marker.content);
        await settleDom();
      }
      const updates = history.map((button) => vi.spyOn(button, 'disabled', 'set'));
      handle.setInteractive(false);
      handle.setInteractive(true);
      expect(updates.slice(0, -1).every((update) => update.mock.calls.length === 0)).toBe(true);
      expect(updates.at(-1)).toHaveBeenCalledTimes(2);
      expect(history.slice(0, -1).every((button) => button.disabled)).toBe(true);
      history.slice(0, -1).forEach(expectNoClickListener);
    },
  );

  it('releases a disappeared group without needing another renderer callback', async () => {
    const { container, options, handle } = await setup();
    const marker = render();
    container.append(marker.content);
    await settleDom();
    marker.content.click();
    const resolveOrigin = vi.mocked(options.onGroupSelect).mock.calls[0]![2]!;
    marker.content.remove();
    await settleDom();
    const update = vi.spyOn(marker.content, 'disabled', 'set');
    handle.setInteractive(true);
    expect(update).not.toHaveBeenCalled();
    expect(marker.content.disabled).toBe(true);
    expectNoClickListener(marker.content);
    expect(resolveOrigin()).toBeUndefined();
  });

  it('keeps a replacement focus target when the old SDK marker is reused for another group', async () => {
    const { container, options } = await setup();
    const oldMarker = render();
    container.append(oldMarker.content);
    expect(oldMarker.content.querySelector('.hpm-cluster__surface--small')).not.toBeNull();
    expect(oldMarker.offset).toEqual({ x: -22, y: -22 });
    oldMarker.content.click();
    const original = oldMarker.content;
    const resolveOrigin = vi.mocked(options.onGroupSelect).mock.calls[0]![2]!;
    const replacement = render([1, 0]);
    original.replaceWith(replacement.content);
    expect(replacement.content.querySelector('.hpm-cluster__surface--small')).not.toBeNull();
    expect(replacement.offset).toEqual({ x: -22, y: -22 });
    render([2, 3], oldMarker);
    container.append(oldMarker.content);
    await settleDom();
    expect(resolveOrigin()).toBe(replacement.content);
    expectNoClickListener(original);
    expect(replacement.content.disabled).toBe(false);
  });

  it('waits for SDK mounting and preserves a button reparented before the next paint', async () => {
    const { container, options, handle } = await setup();
    container.remove();
    const marker = render();
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => {
        container.append(marker.content);
        resolve();
      }),
    );
    await settleDom();
    marker.content.remove();
    const wrapper = document.createElement('div');
    wrapper.append(marker.content);
    container.append(wrapper);
    await settleDom();
    handle.setInteractive(false);
    handle.setInteractive(true);
    expect(marker.content.disabled).toBe(false);
    marker.content.click();
    expect(options.onGroupSelect).toHaveBeenCalledOnce();
  });

  it('removes all current listeners and cancels pending DOM cleanup on destroy', async () => {
    const { container, handle } = await setup();
    const mounted = render();
    container.append(mounted.content);
    const pending = render([2, 3]);
    await settleDom();
    mounted.content.remove();
    handle.destroy();
    await settleDom();
    [mounted.content, pending.content].forEach(expectNoClickListener);
    expect(map.listeners.size).toBe(0);
    expect(map.destroy).toHaveBeenCalledOnce();
    expect(cluster.setMap).toHaveBeenCalledWith(null);
  });
});
