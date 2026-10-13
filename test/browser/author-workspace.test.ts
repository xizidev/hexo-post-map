// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorDraft } from '../../src/author/draft';
import type { AuthorBootstrap } from '../../src/author/protocol';
import { mountAuthorEditor, type AuthorEditorSession } from '../../src/browser/author/controller';
import type { AuthorMapOptions } from '../../src/browser/author/map';

const bootstrap: AuthorBootstrap = {
  version: 1,
  mode: 'map',
  defaultZoom: 12,
  mapConfig: {
    provider: 'amap',
    amap: { key: 'fixture', securityJsCode: 'fixture', mapStyle: 'amap://styles/normal' },
  },
};
let root: HTMLElement;
let session: AuthorEditorSession;
let handle: ReturnType<typeof mountAuthorEditor>;
let mapOptions: AuthorMapOptions;
const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};
function element<T extends HTMLElement>(selector: string): T {
  const found = root.querySelector<T>(selector);
  expect(found, `Missing workspace control ${selector}`).not.toBeNull();
  return found!;
}
function tab(name: 'places' | 'route'): HTMLButtonElement {
  return element(`[data-workspace-tab="${name}"]`);
}
function input(selector: string, value: string): void {
  const field = element<HTMLInputElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function mount(): ReturnType<typeof mountAuthorEditor> {
  return mountAuthorEditor(root, bootstrap, session, {
    mapFactory: async (_root, options) => {
      mapOptions = options;
      return { render() {}, destroy() {}, setCandidate() {} };
    },
    searchPlaces: async () => ({
      state: 'success',
      places: [
        { name: '南京南站', city: '南京市', address: '玉兰路', coordinate: [118.798, 31.969] },
      ],
    }),
  });
}
beforeEach(async () => {
  const template = document.createElement('template');
  template.innerHTML = readFileSync('src/author/editor.html', 'utf8');
  document.body.replaceChildren(template.content.querySelector('main')!.cloneNode(true));
  root = document.querySelector('[data-author-root]')!;
  session = {
    draft: createAuthorDraft({
      points: [
        { id: 'a', name: 'A', longitude: 118.123456789, latitude: 32 },
        { id: 'b', name: 'B', longitude: 121, latitude: 31 },
      ],
      representative: 'b',
      route: ['a', 'b', 'a'],
      zoom: 21,
    }),
    selectedId: 'a',
  };
  handle = mount();
  await flush();
});
afterEach(() => {
  handle?.destroy();
  document.body.replaceChildren();
});

describe('author places and route workspace', () => {
  it('starts in the places tab with distinct place and repeated-stop counts', () => {
    expect(tab('places').getAttribute('aria-selected')).toBe('true');
    expect(tab('places').textContent).toContain('2');
    expect(tab('route').textContent).toContain('3');
    expect(element('[data-workspace-panel=places]').hidden).toBe(false);
    expect(element('[data-workspace-panel=route]').hidden).toBe(true);
    expect(element<HTMLDetailsElement>('[data-coordinate-details]').open).toBe(false);
  });

  it('supports roving keyboard tabs without moving point or route data', () => {
    const before = session.draft;
    tab('places').focus();
    tab('places').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tab('route').getAttribute('aria-selected')).toBe('true');
    expect(tab('route').tabIndex).toBe(0);
    expect(tab('places').tabIndex).toBe(-1);
    expect(document.activeElement).toBe(tab('route'));
    tab('route').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(tab('places'));
    tab('places').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(tab('route'));
    expect(session.draft).toBe(before);
  });

  it('keeps invalid committed coordinate and zoom input across tab switches', async () => {
    const before = session.draft;
    input('[name=longitude]', '1e+');
    input('[data-zoom]', '2e+');
    tab('route').click();
    tab('places').click();
    await flush();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
    expect(element<HTMLInputElement>('[data-zoom]').value).toBe('2e+');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    expect(session.draft).toBe(before);
  });

  it('preserves a raw unconfirmed candidate when inspecting its route', async () => {
    mapOptions.onCandidate([119.987654321, 33]);
    input('[name=name]', '未确认地点');
    input('[name=latitude]', '1e+');
    tab('route').click();
    tab('places').click();
    await flush();
    expect(element<HTMLInputElement>('[name=name]').value).toBe('未确认地点');
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('119.987654321');
    expect(element<HTMLInputElement>('[name=latitude]').value).toBe('1e+');
    expect(session.draft.points).toHaveLength(2);
    expect(session.draft.route).toEqual(['a', 'b', 'a']);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
  });

  it('retains workspace tab and expanded coordinate state through an in-memory remount', async () => {
    element<HTMLDetailsElement>('[data-coordinate-details]').open = true;
    tab('route').click();
    handle.destroy();
    handle = mount();
    await flush();
    expect(tab('route').getAttribute('aria-selected')).toBe('true');
    expect(element('[data-workspace-panel=places]').hidden).toBe(true);
    tab('places').click();
    expect(element<HTMLDetailsElement>('[data-coordinate-details]').open).toBe(true);
  });

  it('brings a clicked map candidate into the places editor without adding it', () => {
    tab('route').click();
    mapOptions.onCandidate([118.798034, 31.968763]);
    expect(tab('places').getAttribute('aria-selected')).toBe('true');
    expect(element('[data-workspace-panel=places]').hidden).toBe(false);
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('118.798034');
    expect(document.activeElement).toBe(element('[name=name]'));
    expect(session.draft.points).toHaveLength(2);
  });

  it('brings the selected place name into focus when a map pin is chosen', () => {
    tab('route').click();
    mapOptions.onSelect('b');
    expect(tab('places').getAttribute('aria-selected')).toBe('true');
    expect(element<HTMLInputElement>('[name=name]').value).toBe('B');
    expect(document.activeElement).toBe(element('[name=name]'));
  });

  it('brings the editor into focus when a place card is selected', () => {
    element<HTMLButtonElement>('[data-point-id="b"] [data-select]').click();
    expect(element<HTMLInputElement>('[name=name]').value).toBe('B');
    expect(document.activeElement).toBe(element('[name=name]'));
  });

  it('reveals a searched candidate and its name field from the route tab', async () => {
    tab('route').click();
    input('[data-search-keyword]', '南京南站');
    element<HTMLFormElement>('[data-search-form]').requestSubmit();
    await flush();
    element<HTMLButtonElement>('[data-search-result]').click();
    await flush();
    expect(tab('places').getAttribute('aria-selected')).toBe('true');
    expect(element<HTMLInputElement>('[name=name]').value).toBe('南京南站');
    expect(document.activeElement).toBe(element('[name=name]'));
    expect(session.draft.representativeId).toBe('b');
    expect(session.draft.points).toHaveLength(2);
    expect(session.draft.route).toEqual(['a', 'b', 'a']);
  });

  it('opens manual coordinates deliberately without changing the committed draft', () => {
    tab('route').click();
    const before = session.draft;
    element<HTMLButtonElement>('[data-new]').click();
    expect(tab('places').getAttribute('aria-selected')).toBe('true');
    expect(element<HTMLDetailsElement>('[data-coordinate-details]').open).toBe(true);
    expect(document.activeElement).toBe(element('[name=name]'));
    expect(session.draft).toBe(before);
  });

  it('labels start, end and the repeated occurrence independently of representative place', () => {
    tab('route').click();
    expect(element('[data-route-index="0"]').textContent).toContain('起点');
    expect(element('[data-route-index="2"]').textContent).toContain('终点');
    expect(element('[data-route-index="2"]').textContent).toContain('再次途经');
    expect(
      element<HTMLButtonElement>('[data-point-id="b"] [data-up]').getAttribute('aria-label'),
    ).toContain('地点');
    expect(
      element<HTMLButtonElement>('[data-route-index="1"] [data-up]').getAttribute('aria-label'),
    ).toContain('途经');
    expect(session.draft.representativeId).toBe('b');
  });

  it('moves place order without reordering the route or its representative', () => {
    element<HTMLButtonElement>('[data-point-id="b"] [data-up]').click();
    expect(session.draft.points.map((point) => point.id)).toEqual(['b', 'a']);
    expect(session.draft.route).toEqual(['a', 'b', 'a']);
    expect(session.draft.representativeId).toBe('b');
  });

  it('removes a repeated stop without deleting its place and focuses a visible tab when empty', async () => {
    tab('route').click();
    element<HTMLButtonElement>('[data-route-index="2"] [data-remove]').click();
    expect(session.draft.route).toEqual(['a', 'b']);
    expect(session.draft.points.map((point) => point.id)).toEqual(['a', 'b']);
    element<HTMLButtonElement>('[data-route-index="1"] [data-remove]').click();
    const last = element<HTMLButtonElement>('[data-route-index="0"] [data-remove]');
    last.focus();
    last.click();
    await flush();
    expect(session.draft.route).toEqual([]);
    expect(tab('route').textContent).toContain('0');
    expect(document.activeElement).toBe(tab('route'));
    expect(session.draft.representativeId).toBe('b');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });

  it('keeps export controls outside the hidden workspace panel in either tab', () => {
    tab('route').click();
    expect(element('[data-export]').closest('[hidden]')).toBeNull();
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
    tab('places').click();
    expect(element('[data-export]').closest('[hidden]')).toBeNull();
  });

  it('updates counts after confirmed addition while the ordered route stays untouched', async () => {
    mapOptions.onCandidate([122, 34]);
    input('[name=name]', 'C');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    expect(tab('places').textContent).toContain('3');
    expect(tab('route').textContent).toContain('3');
    expect(session.draft.route).toEqual(['a', 'b', 'a']);
    expect(session.draft.representativeId).toBe('b');
  });

  it('removes tab listeners on destroy so old controls cannot change hidden panels', () => {
    tab('route').click();
    handle.destroy();
    tab('places').click();
    expect(tab('route').getAttribute('aria-selected')).toBe('true');
    expect(element('[data-workspace-panel=route]').hidden).toBe(false);
  });

  it('restores the same place action focus after an in-memory lifecycle remount', async () => {
    const original = element<HTMLButtonElement>('[data-point-id="b"] [data-route-add]');
    original.focus();
    handle.destroy();
    handle = mount();
    await flush();
    expect(document.activeElement).toBe(element('[data-point-id="b"] [data-route-add]'));
    expect(tab('places').getAttribute('aria-selected')).toBe('true');
  });

  it('restores the exact repeated route occurrence action after a lifecycle remount', async () => {
    tab('route').click();
    element<HTMLButtonElement>('[data-route-index="2"] [data-remove]').focus();
    handle.destroy();
    handle = mount();
    await flush();
    expect(document.activeElement).toBe(element('[data-route-index="2"] [data-remove]'));
    expect(tab('route').getAttribute('aria-selected')).toBe('true');
    expect(session.draft.route).toEqual(['a', 'b', 'a']);
  });

  it('reopens the restored place action disclosure rather than focusing a hidden control', async () => {
    element<HTMLDetailsElement>('[data-point-id="b"] .place-more').open = true;
    element<HTMLButtonElement>('[data-point-id="b"] [data-up]').focus();
    handle.destroy();
    handle = mount();
    await flush();
    expect(element<HTMLDetailsElement>('[data-point-id="b"] .place-more').open).toBe(true);
    expect(document.activeElement).toBe(element('[data-point-id="b"] [data-up]'));
  });

  it('keeps raw coordinate input focus when its expanded editor remounts', async () => {
    element<HTMLDetailsElement>('[data-coordinate-details]').open = true;
    input('[name=longitude]', '1e+');
    element('[name=longitude]').focus();
    handle.destroy();
    handle = mount();
    await flush();
    expect(document.activeElement).toBe(element('[name=longitude]'));
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
    expect(element<HTMLDetailsElement>('[data-coordinate-details]').open).toBe(true);
  });

  it('does not take unrelated focus that changed while the editor was unmounted', async () => {
    element('[data-point-id="b"] [data-route-add]').focus();
    handle.destroy();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    handle = mount();
    await flush();
    expect(document.activeElement).toBe(outside);
  });

  it.each(['[data-coordinate-details]', '[data-point-id="b"] .place-more'])(
    'keeps a focused collapsed summary closed across remount: %s',
    async (selector) => {
      const disclosure = element<HTMLDetailsElement>(selector);
      disclosure.open = false;
      disclosure.querySelector<HTMLElement>('summary')!.focus();
      handle.destroy();
      handle = mount();
      await flush();
      expect(element<HTMLDetailsElement>(selector).open).toBe(false);
      expect(document.activeElement).toBe(element(selector).querySelector('summary'));
    },
  );
});
