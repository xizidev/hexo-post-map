// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthorDraft, draftMapInput } from '../../src/author/draft';
import type { AuthorDraft } from '../../src/author/types';
import {
  createAuthorMap,
  type AuthorMapHandle,
  type AuthorMapOptions,
} from '../../src/browser/author/map';
import { createAuthorMarker } from '../../src/browser/author/marker';
import type { Coordinate } from '../../src/domain/types';

const sdk = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));
type Listener = (event?: unknown) => void;
class Events {
  listeners = new Map<string, Set<Listener>>();
  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    if (this.listeners.get(event)?.size === 0) this.listeners.delete(event);
  }
  emit(event: string, payload?: unknown) {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }
}
let map: FakeMap;
const markers: FakeMarker[] = [];
const lines: FakePolyline[] = [];
class FakeMap extends Events {
  overlays = new Set<unknown>();
  add = vi.fn((items: unknown[]) => items.forEach((item) => this.overlays.add(item)));
  remove = vi.fn((items: unknown[]) => items.forEach((item) => this.overlays.delete(item)));
  setFitView = vi.fn();
  setStatus = vi.fn();
  setZoom = vi.fn();
  setZoomAndCenter = vi.fn();
  setBounds = vi.fn();
  destroy = vi.fn();
  getZoom() {
    return 4;
  }
  constructor(
    _container: HTMLElement,
    readonly options: Record<string, unknown>,
  ) {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    map = this;
  }
}
class FakeMarker extends Events {
  setPosition = vi.fn((position: Coordinate) => {
    this.options.position = position;
  });
  setContent = vi.fn((content: HTMLElement) => {
    this.options.content = content;
  });
  setDraggable = vi.fn((draggable: boolean) => {
    this.options.draggable = draggable;
  });
  constructor(readonly options: Record<string, unknown>) {
    super();
    markers.push(this);
  }
}
class FakePolyline {
  path: readonly Coordinate[];
  setPath = vi.fn((path: readonly Coordinate[]) => {
    this.path = path;
  });
  constructor(readonly options: Record<string, unknown>) {
    this.path = options.path as readonly Coordinate[];
    lines.push(this);
  }
}
const plugin = vi.fn();
const infoWindow = vi.fn();
const api = {
  Map: FakeMap,
  Marker: FakeMarker,
  Polyline: FakePolyline,
  plugin,
  InfoWindow: infoWindow,
};
const handles: AuthorMapHandle[] = [];
function lnglat(longitude: number, latitude: number) {
  return { lnglat: { getLng: () => longitude, getLat: () => latitude } };
}
function draft(): AuthorDraft {
  return createAuthorDraft({
    representative: 'point-1',
    points: [
      { id: 'point-1', name: 'A', longitude: 118.123456789, latitude: 32 },
      { id: 'point-2', name: 'B', longitude: 119, latitude: 33 },
    ],
    route: ['point-1', 'point-2', 'point-1'],
    zoom: 8.25,
  });
}
function options(signal = new AbortController().signal): AuthorMapOptions {
  return {
    config: {
      provider: 'amap',
      amap: { key: 'key', mapStyle: 'amap://styles/normal', serviceHost: '/proxy' },
    },
    defaultZoom: 12,
    signal,
    onCandidate: vi.fn(),
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onWarning: vi.fn(),
  };
}
async function setup(opts = options()) {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = await createAuthorMap(container, opts);
  handles.push(handle);
  return { handle, options: opts };
}
beforeEach(() => {
  sdk.load.mockReset().mockResolvedValue(api);
  markers.length = 0;
  lines.length = 0;
  plugin.mockClear();
  infoWindow.mockClear();
});
afterEach(() => {
  handles.splice(0).forEach((handle) => handle.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('author map', () => {
  it('starts empty at fixed center and zoom without location plugin', async () => {
    const { handle } = await setup();
    handle.render(createAuthorDraft());
    expect(map.options).toMatchObject({ center: [104, 35], zoom: 4 });
    expect(plugin).not.toHaveBeenCalled();
    expect(sdk.load).toHaveBeenCalledExactlyOnceWith({ key: 'key', version: '2.0' });
    expect(markers).toHaveLength(0);
    expect(map.setFitView).not.toHaveBeenCalled();
  });
  it('commits marker movement only on dragend', async () => {
    const { handle, options } = await setup();
    handle.render(draft(), 'point-1');
    const marker = markers[0]!;
    expect(marker.options.draggable).toBe(true);
    expect(markers[1]!.options.draggable).toBe(false);
    marker.emit('dragging', lnglat(118.5, 32.5));
    expect(options.onMove).not.toHaveBeenCalled();
    marker.emit('dragend', lnglat(118.5, 32.5));
    expect(options.onMove).toHaveBeenCalledExactlyOnceWith('point-1', [118.5, 32.5]);
    markers[1]!.emit('dragend', lnglat(119.5, 33.5));
    expect(options.onMove).toHaveBeenCalledTimes(1);
  });
  it('selects a marker without creating candidate or info window', async () => {
    const { handle, options } = await setup();
    handle.render(draft());
    const event = { ...lnglat(118, 32), originEvent: new MouseEvent('click', { bubbles: true }) };
    markers[0]!.emit('click', event);
    map.emit('click', event);
    expect(options.onSelect).toHaveBeenCalledExactlyOnceWith('point-1');
    expect(options.onCandidate).not.toHaveBeenCalled();
    expect(infoWindow).not.toHaveBeenCalled();
    expect(markers[0]!.options.bubble).toBe(false);
    const content = markers[0]!.options.content as HTMLElement;
    const received = vi.fn();
    const parent = document.createElement('div');
    parent.addEventListener('click', received);
    parent.append(content);
    content.click();
    expect(received).not.toHaveBeenCalled();
    expect(options.onSelect).toHaveBeenCalledTimes(2);
  });
  it('renders A B A without changing representative or zoom', async () => {
    const { handle } = await setup();
    const input = draft();
    const before = structuredClone(input);
    handle.render(input, 'point-2', { fitView: true });
    expect(lines[0]!.options.path).toEqual([
      [118.123456789, 32],
      [119, 33],
      [118.123456789, 32],
    ]);
    expect(input).toEqual(before);
    expect(map.setZoom).not.toHaveBeenCalled();
    expect(map.setFitView).toHaveBeenCalledTimes(1);
  });
  it('updates only changed marker and route', async () => {
    const { handle } = await setup();
    const input = draft();
    handle.render(input, 'point-1');
    handle.render(
      { ...input, points: [{ ...input.points[0]!, longitude: 118.5 }, input.points[1]!] },
      'point-1',
    );
    expect(markers).toHaveLength(2);
    expect(markers[0]!.setPosition).toHaveBeenCalledExactlyOnceWith([118.5, 32]);
    expect(markers[1]!.setPosition).not.toHaveBeenCalled();
    expect(markers[1]!.setContent).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.setPath).toHaveBeenCalledExactlyOnceWith([
      [118.5, 32],
      [119, 33],
      [118.5, 32],
    ]);
    handle.render({ ...input, route: ['point-1'] }, 'point-2');
    expect(map.overlays.has(lines[0])).toBe(false);
    expect(markers[0]!.setDraggable).toHaveBeenCalledWith(false);
    expect(markers[1]!.setDraggable).toHaveBeenCalledWith(true);
  });
  it('keeps legal unrenderable coordinates exportable with warning', async () => {
    const { handle, options } = await setup();
    const input = createAuthorDraft({
      points: [{ id: 'pole', name: 'Pole', longitude: 180, latitude: 90 }],
      zoom: -100,
    });
    handle.render(input, 'pole', { fitView: true });
    expect(options.onWarning).toHaveBeenCalled();
    expect(draftMapInput(input)).toEqual({
      points: [{ id: 'pole', name: 'Pole', longitude: 180, latitude: 90 }],
      zoom: -100,
    });
    expect(map.setFitView).not.toHaveBeenCalled();
    expect(map.setZoom).not.toHaveBeenCalled();
  });
  it('does not refit for name edits or pan', async () => {
    const { handle } = await setup();
    const input = draft();
    handle.render(input, 'point-1', { fitView: true });
    handle.render(
      { ...input, points: [{ ...input.points[0]!, name: 'Renamed' }, input.points[1]!] },
      'point-1',
    );
    map.emit('moveend', lnglat(120, 30));
    map.emit('zoomend');
    expect(map.setFitView).toHaveBeenCalledTimes(1);
    expect(markers[0]!.setContent).toHaveBeenCalledTimes(1);
    expect(lines[0]!.setPath).not.toHaveBeenCalled();
    expect(input.zoom).toBe(8.25);
  });
  it.each([
    { zoom: undefined, previewZoom: 12 },
    { zoom: 7.125, previewZoom: 7.125 },
    { zoom: -100, previewZoom: 2 },
    { zoom: 100, previewZoom: 20 },
  ])(
    'fits one point explicitly with preview zoom while preserving raw zoom: $zoom',
    async ({ zoom, previewZoom }) => {
      const { handle, options } = await setup();
      const input = createAuthorDraft({
        points: [{ id: 'single', name: 'Single', longitude: -180, latitude: -30 }],
        ...(zoom === undefined ? {} : { zoom }),
      });
      handle.render(input);
      expect(map.setZoomAndCenter).not.toHaveBeenCalled();
      handle.render(input, 'single', { fitView: true });
      expect(map.setZoomAndCenter).toHaveBeenCalledExactlyOnceWith(previewZoom, [-180, -30], true);
      expect(input.zoom).toBe(zoom);
      expect(map.setFitView).not.toHaveBeenCalled();
      if (zoom === -100 || zoom === 100) expect(options.onWarning).toHaveBeenCalled();
    },
  );
  it('keeps candidate separate and never confirms on double click', async () => {
    const { handle, options } = await setup();
    const input = draft();
    handle.render(input);
    map.emit('click', lnglat(-180, -90));
    expect(options.onCandidate).toHaveBeenCalledExactlyOnceWith([-180, -90]);
    map.emit('dblclick', lnglat(118, 32));
    expect(options.onCandidate).toHaveBeenCalledTimes(1);
    handle.setCandidate([118.7654321, 32.25]);
    expect(markers[2]!.options.position).toEqual([118.7654321, 32.25]);
    handle.setCandidate([119, 33]);
    expect(markers).toHaveLength(3);
    expect(markers[2]!.setPosition).toHaveBeenCalledWith([119, 33]);
    handle.setCandidate(undefined);
    expect(map.overlays.has(markers[2])).toBe(false);
    expect(input.points).toHaveLength(2);
  });
  it.each([
    undefined,
    {},
    { lnglat: [118, 32] },
    lnglat(NaN, 32),
    lnglat(181, 32),
    lnglat(118, -91),
    {
      lnglat: {
        getLng: () => {
          throw new Error('private');
        },
        getLat: () => 32,
      },
    },
  ])('ignores invalid event coordinates: %j', async (event) => {
    const { handle, options } = await setup();
    handle.render(draft(), 'point-1');
    map.emit('click', event);
    markers[0]!.emit('dragend', event);
    expect(options.onCandidate).not.toHaveBeenCalled();
    expect(options.onMove).not.toHaveBeenCalled();
  });
  it('ignores stale removed IDs and stale drag events after render', async () => {
    const { handle, options } = await setup();
    const input = draft();
    handle.render(input, 'point-1');
    const click = [...markers[0]!.listeners.get('click')!][0]!;
    const drag = [...markers[0]!.listeners.get('dragend')!][0]!;
    handle.render({ ...input, points: [input.points[1]!], route: [] }, 'point-2');
    click(lnglat(118, 32));
    drag(lnglat(118, 32));
    handle.render(input, 'point-1');
    click(lnglat(118, 32));
    drag(lnglat(118, 32));
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(options.onMove).not.toHaveBeenCalled();
    const currentDrag = [...markers[2]!.listeners.get('dragend')!][0]!;
    handle.render(
      { ...input, points: [{ ...input.points[0]!, longitude: 117 }, input.points[1]!] },
      'point-1',
    );
    currentDrag(lnglat(118, 32));
    expect(options.onMove).not.toHaveBeenCalled();
  });
  it('destroys late SDK result after abort', async () => {
    let resolve!: (value: typeof api) => void;
    sdk.load.mockReturnValue(
      new Promise<typeof api>((done) => {
        resolve = done;
      }),
    );
    const abort = new AbortController();
    const opts = options(abort.signal);
    const pending = createAuthorMap(document.createElement('div'), opts);
    abort.abort();
    resolve(api);
    const handle = await pending;
    handle.render(draft());
    handle.setCandidate([118, 32]);
    handle.destroy();
    expect(markers).toHaveLength(0);
    expect(opts.onWarning).not.toHaveBeenCalled();
  });
  it('removes all owned listeners and overlays once', async () => {
    const abort = new AbortController();
    const { handle, options } = await setup(optionsForAbort(abort));
    handle.render(draft(), 'point-1');
    handle.setCandidate([118, 32]);
    const content = markers[0]!.options.content as HTMLElement;
    const click = [...markers[0]!.listeners.get('click')!][0]!;
    handle.destroy();
    abort.abort();
    handle.destroy();
    content.click();
    click(lnglat(118, 32));
    map.emit('click', lnglat(118, 32));
    handle.render(draft());
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expect(map.overlays.size).toBe(0);
    expect(map.listeners.size).toBe(0);
    expect(markers.every((marker) => marker.listeners.size === 0)).toBe(true);
    expect(options.onCandidate).not.toHaveBeenCalled();
    expect(options.onSelect).not.toHaveBeenCalled();
  });
  it('reports fixed warning without leaking SDK error or discarding manual draft', async () => {
    sdk.load.mockRejectedValue(new Error('secret-key and coordinates'));
    const { handle, options } = await setup();
    handle.render(draft());
    expect(options.onWarning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(options.onWarning).mock.calls[0]![0]).not.toMatch(/secret-key|coordinates/);
    handle.destroy();
  });
  it('ignores malformed getters on event wrappers', async () => {
    const { handle, options } = await setup();
    handle.render(draft(), 'point-1');
    const event = Object.defineProperty({}, 'originEvent', {
      get() {
        throw new Error('private');
      },
    });
    expect(() => map.emit('click', event)).not.toThrow();
    expect(() => markers[0]!.emit('click', event)).not.toThrow();
    expect(options.onCandidate).not.toHaveBeenCalled();
  });
  it('cleans the remaining resources when SDK cleanup throws', async () => {
    const { handle, options } = await setup();
    handle.render(draft(), 'point-1');
    markers[0]!.off = vi.fn(() => {
      throw new Error('private SDK failure');
    });
    map.remove.mockImplementation(() => {
      throw new Error('private SDK failure');
    });
    expect(() => handle.destroy()).not.toThrow();
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expect(map.listeners.size).toBe(0);
    expect(markers[1]!.listeners.size).toBe(0);
    handle.destroy();
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expect(options.onWarning).toHaveBeenCalled();
    expect(
      vi.mocked(options.onWarning).mock.calls.every(([message]) => !message.includes('private')),
    ).toBe(true);
  });
  it('invalidates every removed ID before an earlier SDK removal can fail', async () => {
    const { handle, options } = await setup();
    handle.render(draft(), 'point-2');
    const removedA = markers[0]!;
    const removedB = markers[1]!;
    const lateClick = [...removedB.listeners.get('click')!][0]!;
    const lateDrag = [...removedB.listeners.get('dragend')!][0]!;
    map.remove.mockImplementationOnce(() => {
      throw new Error('private removal failure');
    });
    handle.render(createAuthorDraft());
    lateClick(lnglat(119, 33));
    lateDrag(lnglat(119.5, 33.5));
    removedB.emit('click', lnglat(119, 33));
    removedB.emit('dragend', lnglat(119.5, 33.5));
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(options.onMove).not.toHaveBeenCalled();
    expect(removedA.listeners.size).toBe(0);
    expect(removedB.listeners.size).toBe(0);
    expect(map.overlays.has(removedB)).toBe(false);
    expect(options.onWarning).toHaveBeenCalled();
  });
  it.each(['registration', 'add'] as const)(
    'recovers the same draft after initial marker %s fails',
    async (failure) => {
      if (failure === 'registration') {
        let failRegistration = true;
        sdk.load.mockResolvedValue({
          ...api,
          Marker: class extends FakeMarker {
            on(event: string, listener: Listener) {
              super.on(event, listener);
              if (event === 'dragend' && failRegistration) {
                failRegistration = false;
                throw new Error('private registration failure');
              }
            }
          },
        });
      }
      const { handle, options } = await setup();
      if (failure === 'add')
        map.add.mockImplementationOnce((items) => {
          items.forEach((item) => map.overlays.add(item));
          throw new Error('private add failure');
        });
      const input = draft();
      handle.render(input, 'point-1');
      const failedMarker = markers[0]!;
      expect(options.onWarning).toHaveBeenCalled();
      handle.render(input, 'point-1');
      const visible = markers.filter((marker) => map.overlays.has(marker));
      expect(visible).toHaveLength(2);
      expect(map.overlays.has(failedMarker)).toBe(false);
      expect(failedMarker.listeners.size).toBe(0);
      const selected = visible.find((marker) => marker.options.draggable)!;
      selected.emit('click', lnglat(118, 32));
      selected.emit('dragend', lnglat(118.5, 32.5));
      expect(options.onSelect).toHaveBeenCalledExactlyOnceWith('point-1');
      expect(options.onMove).toHaveBeenCalledExactlyOnceWith('point-1', [118.5, 32.5]);
      expect(lines[0]!.options.path).toEqual([
        [118.123456789, 32],
        [119, 33],
        [118.123456789, 32],
      ]);
    },
  );
  it.each(['setPosition', 'setDraggable', 'setContent'] as const)(
    'recovers the same draft after marker %s fails',
    async (setter) => {
      const { handle, options } = await setup();
      const input = draft();
      handle.render(input, 'point-2');
      const failedMarker = markers[0]!;
      const staleClick = [...failedMarker.listeners.get('click')!][0]!;
      failedMarker[setter].mockImplementationOnce(() => {
        throw new Error('private setter failure');
      });
      const changed = {
        ...input,
        points: [{ ...input.points[0]!, name: 'Edited', longitude: 118.5 }, input.points[1]!],
      };
      handle.render(changed, 'point-1');
      expect(options.onWarning).toHaveBeenCalled();
      handle.render(changed, 'point-1');
      expect(map.overlays.has(failedMarker)).toBe(false);
      expect(failedMarker.listeners.size).toBe(0);
      const recovered = markers.find(
        (marker) => marker !== failedMarker && marker.options.draggable && map.overlays.has(marker),
      )!;
      expect(recovered.options.position).toEqual([118.5, 32]);
      expect((recovered.options.content as HTMLElement).getAttribute('aria-label')).toBe('Edited');
      staleClick(lnglat(118, 32));
      recovered.emit('click', lnglat(118.5, 32));
      recovered.emit('dragend', lnglat(118.75, 32.5));
      expect(options.onSelect).toHaveBeenCalledExactlyOnceWith('point-1');
      expect(options.onMove).toHaveBeenCalledExactlyOnceWith('point-1', [118.75, 32.5]);
      expect(map.overlays.has(markers[1]!)).toBe(true);
      expect(markers[1]!.setPosition).not.toHaveBeenCalled();
      expect(lines.find((line) => map.overlays.has(line))?.path).toEqual([
        [118.5, 32],
        [119, 33],
        [118.5, 32],
      ]);
    },
  );
  it.each(['before', 'after'] as const)(
    'retries route creation when SDK add fails %s adding the overlay',
    async (timing) => {
      const { handle, options } = await setup();
      let failAdd = true;
      map.add.mockImplementation((items) => {
        if (items[0] instanceof FakePolyline && failAdd) {
          failAdd = false;
          if (timing === 'after') items.forEach((item) => map.overlays.add(item));
          throw new Error('private route add');
        }
        items.forEach((item) => map.overlays.add(item));
      });
      const input = draft();
      handle.render(input);
      const failedLine = lines[0]!;
      expect(options.onWarning).toHaveBeenCalled();
      handle.render(input);
      expect(map.overlays.has(failedLine)).toBe(false);
      const visible = lines.filter((line) => map.overlays.has(line));
      expect(visible).toHaveLength(1);
      expect(visible[0]!.path).toEqual([
        [118.123456789, 32],
        [119, 33],
        [118.123456789, 32],
      ]);
      expect(markers).toHaveLength(2);
    },
  );
  it.each(['before', 'after'] as const)(
    'retries candidate creation when SDK add fails %s adding the overlay',
    async (timing) => {
      const { handle, options } = await setup();
      map.add.mockImplementationOnce((items) => {
        if (timing === 'after') items.forEach((item) => map.overlays.add(item));
        throw new Error('private candidate add');
      });
      handle.setCandidate([118.123456789, 32]);
      const failedCandidate = markers[0]!;
      expect(options.onWarning).toHaveBeenCalled();
      handle.setCandidate([118.123456789, 32]);
      expect(map.overlays.has(failedCandidate)).toBe(false);
      const visible = markers.filter((marker) => map.overlays.has(marker));
      expect(visible).toHaveLength(1);
      expect(visible[0]!.options.position).toEqual([118.123456789, 32]);
      expect(options.onCandidate).not.toHaveBeenCalled();
      expect(map.setFitView).not.toHaveBeenCalled();
    },
  );
  it('retries route and candidate setters without publishing failed coordinates', async () => {
    const { handle, options } = await setup();
    const input = draft();
    handle.render(input);
    handle.setCandidate([120, 30]);
    const line = lines[0]!;
    const candidate = markers[2]!;
    line.setPath.mockImplementationOnce(() => {
      throw new Error('private path update');
    });
    candidate.setPosition.mockImplementationOnce(() => {
      throw new Error('private candidate position');
    });
    const changed = { ...input, route: ['point-2', 'point-1', 'point-2'] };
    handle.render(changed);
    handle.setCandidate([121, 31]);
    expect(options.onWarning).toHaveBeenCalledTimes(2);
    handle.render(changed);
    handle.setCandidate([121, 31]);
    expect(line.path).toEqual([
      [119, 33],
      [118.123456789, 32],
      [119, 33],
    ]);
    expect(candidate.options.position).toEqual([121, 31]);
    expect(markers).toHaveLength(3);
    expect(lines).toHaveLength(1);
  });
  it('retains only current listeners after repeated edits and stops them on abort', async () => {
    const abort = new AbortController();
    const { handle, options } = await setup(optionsForAbort(abort));
    const input = draft();
    for (let index = 0; index < 100; index++) {
      handle.render(
        { ...input, points: [{ ...input.points[0]!, name: `A ${index}` }, input.points[1]!] },
        index % 2 ? 'point-1' : 'point-2',
      );
    }
    expect(markers).toHaveLength(2);
    expect(
      markers.every((marker) =>
        [...marker.listeners.values()].every((listeners) => listeners.size === 1),
      ),
    ).toBe(true);
    expect(map.listeners.size).toBe(1);
    abort.abort();
    map.emit('click', lnglat(118, 32));
    expect(options.onCandidate).not.toHaveBeenCalled();
    expect(markers.every((marker) => marker.listeners.size === 0)).toBe(true);
    expect(map.destroy).toHaveBeenCalledTimes(1);
  });
  it('does not load SDK for an already aborted request', async () => {
    const abort = new AbortController();
    abort.abort();
    const { handle, options } = await setup(optionsForAbort(abort));
    handle.render(draft());
    expect(sdk.load).not.toHaveBeenCalled();
    expect(options.onWarning).not.toHaveBeenCalled();
  });
  it('destroys a map when abort arrives inside its constructor', async () => {
    const abort = new AbortController();
    sdk.load.mockResolvedValue({
      ...api,
      Map: class extends FakeMap {
        constructor(container: HTMLElement, opts: Record<string, unknown>) {
          super(container, opts);
          abort.abort();
        }
      },
    });
    const { handle } = await setup(optionsForAbort(abort));
    handle.render(draft());
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expect(map.listeners.size).toBe(0);
    expect(markers).toHaveLength(0);
  });
  it('destroys a partially initialized map when registering SDK events fails', async () => {
    sdk.load.mockResolvedValue({
      ...api,
      Map: class extends FakeMap {
        on() {
          throw new Error('private event failure');
        }
      },
    });
    const { handle, options } = await setup();
    handle.render(draft());
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expect(options.onWarning).toHaveBeenCalled();
    expect(vi.mocked(options.onWarning).mock.calls[0]![0]).not.toContain('private');
    expect(markers).toHaveLength(0);
  });
  it('detaches marker listeners even if the SDK throws after partial event registration', async () => {
    sdk.load.mockResolvedValue({
      ...api,
      Marker: class extends FakeMarker {
        on(event: string, listener: Listener) {
          super.on(event, listener);
          if (event === 'dragend') throw new Error('private marker registration');
        }
      },
    });
    const { handle, options } = await setup();
    handle.render(draft(), 'point-1');
    expect(options.onWarning).toHaveBeenCalled();
    handle.destroy();
    expect(markers[0]!.listeners.size).toBe(0);
    const content = markers[0]!.options.content as HTMLElement;
    const parent = document.createElement('div');
    const received = vi.fn();
    parent.addEventListener('click', received);
    parent.append(content);
    content.click();
    expect(received).toHaveBeenCalledTimes(1);
    expect(options.onSelect).not.toHaveBeenCalled();
  });
  it('preserves exact legal coordinates even when the SDK rejects their preview', async () => {
    sdk.load.mockResolvedValue({
      ...api,
      Marker: class extends FakeMarker {
        constructor(opts: Record<string, unknown>) {
          if ((opts.position as readonly number[])[0] === 180)
            throw new Error('private projection');
          super(opts);
        }
      },
    });
    const { handle, options } = await setup();
    const input = createAuthorDraft({
      points: [{ id: 'edge', name: 'Edge', longitude: 180, latitude: -0 }],
    });
    handle.render(input, 'edge');
    expect(options.onWarning).toHaveBeenCalled();
    expect(draftMapInput(input).points[0]).toEqual({
      id: 'edge',
      name: 'Edge',
      longitude: 180,
      latitude: -0,
    });
    expect(Object.is(input.points[0]!.latitude, -0)).toBe(true);
  });
  it('never connects across an unpreviewable route stop or includes candidate in fit bounds', async () => {
    const { handle } = await setup();
    const input = draft();
    handle.setCandidate([120, 30]);
    handle.render(input, undefined, { fitView: true });
    expect(map.setFitView.mock.calls[0]![0]).toEqual([markers[1], markers[2]]);
    handle.render({ ...input, points: [input.points[0]!, { ...input.points[1]!, latitude: 90 }] });
    expect(map.overlays.has(lines[0])).toBe(false);
    expect(input.route).toEqual(['point-1', 'point-2', 'point-1']);
  });
});
function optionsForAbort(abort: AbortController) {
  return options(abort.signal);
}

describe('author pin', () => {
  it('uses trusted fixed SVG with accessible text and a 44px target', () => {
    const label = '<img src=x onerror=alert(1)>';
    const pin = createAuthorMarker(label, true);
    expect(pin.getAttribute('aria-label')).toBe(label);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(pin.querySelector('svg')).not.toBeNull();
    expect(pin.querySelector('img')).toBeNull();
    expect(pin.style.width).toBe('44px');
    expect(pin.style.height).toBe('44px');
    expect(pin.tabIndex).toBe(0);
  });
});
