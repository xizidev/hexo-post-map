// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthorDraft } from '../../src/author/draft';
import type { AuthorBootstrap } from '../../src/author/protocol';
import { mountAuthorEditor, type AuthorEditorSession } from '../../src/browser/author/controller';
import type {
  createAuthorMap,
  AuthorMapOptions,
  AuthorMapHandle,
} from '../../src/browser/author/map';

const fixture = () => readFileSync('src/author/editor.html', 'utf8');
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
let maps: {
  options: AuthorMapOptions;
  render: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}[];
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function element<T extends HTMLElement>(selector: string): T {
  return root.querySelector<T>(selector)!;
}
function input(selector: string, value: string) {
  const field = element<HTMLInputElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function click(selector: string) {
  element<HTMLButtonElement>(selector).click();
}
const factory: typeof createAuthorMap = async (_root, options) => {
  const map = { options, render: vi.fn(), destroy: vi.fn() };
  maps.push(map);
  return { ...map, setCandidate: vi.fn() };
};
beforeEach(async () => {
  const template = document.createElement('template');
  template.innerHTML = fixture();
  document.body.replaceChildren(template.content.querySelector('main')!.cloneNode(true));
  root = document.querySelector('[data-author-root]')!;
  session = {
    draft: createAuthorDraft({
      points: [{ id: 'a', name: 'A', longitude: 118.123456789, latitude: 32 }],
    }),
    selectedId: 'a',
  };
  maps = [];
  handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: factory });
  await flush();
});
afterEach(() => {
  handle?.destroy();
  document.body.replaceChildren();
});
describe('author editor', () => {
  it('fits imported points once when their asynchronous map becomes ready without changing zoom', async () => {
    handle.destroy();
    const resolvers: ((handle: AuthorMapHandle) => void)[] = [];
    handle = mountAuthorEditor(root, bootstrap, session, {
      mapFactory: () => new Promise((resolve) => resolvers.push(resolve)),
    });
    click('[data-import-open]');
    input(
      '[data-import-source]',
      'map:\n  points:\n    - {id: a, name: Far, longitude: -73, latitude: 40}\n  zoom: 21',
    );
    click('[data-import-validate]');
    click('[data-import-confirm]');
    const old = { render: vi.fn(), destroy: vi.fn(), setCandidate: vi.fn() };
    resolvers[0]!(old);
    await flush();
    expect(old.render).not.toHaveBeenCalled();
    const current = { render: vi.fn(), destroy: vi.fn(), setCandidate: vi.fn() };
    resolvers[1]!(current);
    await flush();
    expect(current.render).toHaveBeenCalledExactlyOnceWith(session.draft, 'a', { fitView: true });
    input('[name=latitude]', '41');
    await flush();
    expect(current.render.mock.calls.at(-1)?.[2]).toBeUndefined();
    expect(session.draft.zoom).toBe(21);
  });
  it('retains incomplete coordinate and zoom inputs across memory remount and keeps export blocked', async () => {
    input('[name=longitude]', '1e+');
    input('[data-zoom]', '1e');
    await flush();
    handle.destroy();
    handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: factory });
    await flush();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
    expect(element<HTMLInputElement>('[data-zoom]').value).toBe('1e');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    expect(element('[data-yaml]').textContent).toContain('过期');
  });
  it('retains candidate and unconfirmed new form inputs across memory remount', async () => {
    maps[0]!.options.onCandidate([119.123456789, 33]);
    input('[name=name]', 'Unconfirmed');
    input('[name=latitude]', '1e+');
    handle.destroy();
    handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: factory });
    await flush();
    expect(element<HTMLInputElement>('[name=name]').value).toBe('Unconfirmed');
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('119.123456789');
    expect(element<HTMLInputElement>('[name=latitude]').value).toBe('1e+');
    expect(element('[data-form-title]').textContent).toContain('候选');
    expect(session.draft.points).toHaveLength(1);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
  });
  it('keeps unconfirmed invalid form state across selection but replaces all pending state on import', async () => {
    click('[data-new]');
    input('[name=name]', 'Pending');
    input('[name=longitude]', '1e+');
    input('[data-zoom]', '1e+');
    click('[data-point-id="a"] [data-select]');
    await flush();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('118.123456789');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    click('[data-new]');
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
    click('[data-import-open]');
    input(
      '[data-import-source]',
      'map:\n  points:\n    - {id: a, name: Replacement, longitude: 120, latitude: 35}\n  zoom: 21',
    );
    click('[data-import-validate]');
    click('[data-import-confirm]');
    await flush();
    handle.destroy();
    handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: factory });
    await flush();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('120');
    expect(element<HTMLInputElement>('[data-zoom]').value).toBe('21');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });
  it('shows the safe import reason and numeric syntax location', () => {
    click('[data-import-open]');
    input('[data-import-source]', 'map: [hostile-value');
    click('[data-import-validate]');
    const error = element('[data-import-error]').textContent;
    expect(error).toContain('YAML syntax is invalid');
    expect(error).toMatch(/第\s*\d+\s*行.*第\s*\d+\s*列/u);
    expect(error).not.toContain('hostile-value');
  });
  it('shows byte overflow and semantic export reasons instead of only a field', async () => {
    input('[name=name]', '一'.repeat(45000));
    await flush();
    expect(element('[data-export-error]').textContent).toContain('UTF-8 bytes');
    click('[data-import-open]');
    input('[data-import-source]', 'x'.repeat(131073));
    click('[data-import-validate]');
    expect(element('[data-import-error]').textContent).toContain('UTF-8 bytes');
  });
  it.each([[['a', 'b', 'c']], [['a', 'b', 'a']]])(
    'moves the focused route occurrence twice in %j',
    async (route) => {
      handle.destroy();
      session.draft = createAuthorDraft({
        points: ['a', 'b', 'c'].map((id, index) => ({
          id,
          name: id.toUpperCase(),
          longitude: 118 + index,
          latitude: 32,
        })),
        representative: 'a',
        route,
      });
      handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: factory });
      const down = element<HTMLButtonElement>('[data-route-index="0"] [data-down]');
      down.focus();
      down.click();
      expect(document.activeElement).toBe(element('[data-route-index="1"] [data-down]'));
      (document.activeElement as HTMLButtonElement).click();
      await flush();
      expect(session.draft.route).toEqual([route[1], route[2], route[0]]);
      expect(document.activeElement).toBe(element('[data-route-index="2"] [data-remove]'));
      (document.activeElement as HTMLButtonElement).click();
      expect(document.activeElement).toBe(element('[data-route-index="1"] [data-remove]'));
    },
  );
  it('locally updates coordinate summaries without rounding editor or exported values', async () => {
    const row = element('[data-point-id="a"]');
    expect(row.textContent).toContain('118.123456789');
    input('[name=longitude]', '119.12345678912345');
    await flush();
    expect(element('[data-point-id="a"]')).toBe(row);
    expect(row.textContent).toContain('119.12345678912345');
    expect(element('[data-yaml]').textContent).toContain('119.12345678912345');
  });
  it('focuses the named new point field after deleting the only point', async () => {
    element<HTMLButtonElement>('[data-delete]').focus();
    click('[data-delete]');
    click('[data-delete-confirm]');
    await flush();
    expect(session.draft.points).toHaveLength(0);
    expect(document.activeElement).toBe(element('[name=name]'));
  });
  it('drops confirmed deleted ID buffers without reusing them in another selected point', async () => {
    input('[name=longitude]', '1e+');
    click('[data-new]');
    input('[name=name]', 'B');
    input('[name=longitude]', '120');
    input('[name=latitude]', '35');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    click('[data-point-id="a"] [data-delete]');
    click('[data-delete-confirm]');
    click('[data-point-id="point-1"] input[type=radio]');
    await flush();
    handle.destroy();
    handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: factory });
    await flush();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('120');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
    expect(session.inputs?.buffers.has('a')).toBe(false);
  });
  it('does not move unrelated editing focus when a route action is invoked', async () => {
    click('[data-route-add="a"]');
    click('[data-route-add="a"]');
    const name = element<HTMLTextAreaElement>('[name=name]');
    name.focus();
    click('[data-route-index="0"] [data-down]');
    await flush();
    expect(document.activeElement).toBe(name);
  });
  it('cannot export old valid coordinates while an input is incomplete', async () => {
    input('[name=longitude]', '');
    expect(session.draft.points[0]?.longitude).toBe(118.123456789);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    expect(element<HTMLButtonElement>('[data-download]').disabled).toBe(true);
    await flush();
    expect(element('[data-status]').textContent).toContain('坐标');
  });
  it.each([' ', '1e', '1e+', 'Infinity', '0x10'])(
    'keeps incomplete coordinate %s separate',
    async (value) => {
      input('[name=longitude]', value);
      await flush();
      expect(session.draft.points[0]?.longitude).toBe(118.123456789);
      expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    },
  );
  it('accepts complete finite exponents without rounding', async () => {
    input('[name=longitude]', '1.18123456789e2');
    await flush();
    expect(session.draft.points[0]?.longitude).toBe(118.123456789);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });
  it('requires named candidate confirmation and supports manual addition', async () => {
    maps[0]!.options.onCandidate([119, 33]);
    expect(session.draft.points).toHaveLength(1);
    input('[name=name]', 'B');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    expect(session.draft.points).toHaveLength(2);
    expect(session.draft.representativeId).toBe('a');
    expect(element<HTMLInputElement>('[data-point-id="a"] input[type=radio]').checked).toBe(true);
    click('[data-new]');
    input('[name=name]', 'C');
    input('[name=longitude]', '120');
    input('[name=latitude]', '34');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    expect(session.draft.points).toHaveLength(3);
  });
  it('keeps A B A route order independent of keyboard point ordering and rejects one stop', async () => {
    click('[data-route-add="a"]');
    await flush();
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    click('[data-new]');
    input('[name=name]', 'B');
    input('[name=longitude]', '119');
    input('[name=latitude]', '33');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    click('[data-route-add="point-1"]');
    click('[data-route-add="a"]');
    await flush();
    click('[data-point-id="point-1"] [data-up]');
    await flush();
    expect(session.draft.points.map((p) => p.id)).toEqual(['point-1', 'a']);
    expect(session.draft.route).toEqual(['a', 'point-1', 'a']);
    click('[data-route-index="2"] [data-up]');
    await flush();
    expect(session.draft.route).toEqual(['a', 'a', 'point-1']);
  });
  it('confirms representative deletion and route reference count and demands replacement', async () => {
    click('[data-new]');
    input('[name=name]', 'B');
    input('[name=longitude]', '119');
    input('[name=latitude]', '33');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    click('[data-route-add="a"]');
    click('[data-route-add="a"]');
    await flush();
    click('[data-point-id="a"] [data-delete]');
    expect(element('[data-delete-summary]').textContent).toContain('2');
    expect(element('[data-delete-summary]').textContent).toContain('代表');
    click('[data-delete-cancel]');
    expect(session.draft.points).toHaveLength(2);
    click('[data-point-id="a"] [data-delete]');
    click('[data-delete-confirm]');
    await flush();
    expect(session.draft.representativeMode).toBe('pending');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    click('[data-point-id="point-1"] input[type=radio]');
    await flush();
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });
  it('preserves imported multiline whitespace names across selection and coordinate edits', async () => {
    session.draft = createAuthorDraft({
      points: [{ id: 'a', name: '  A\nB  ', longitude: 118, latitude: 32 }],
    });
    handle.destroy();
    handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: factory });
    expect(element<HTMLTextAreaElement>('[name=name]').value).toBe('  A\nB  ');
    input('[name=latitude]', '33');
    await flush();
    expect(session.draft.points[0]?.name).toBe('  A\nB  ');
  });
  it('renders malicious names as text without rebuilding focused inputs or point rows', async () => {
    const row = element('[data-point-id="a"]');
    const name = element<HTMLTextAreaElement>('[name=name]');
    name.focus();
    input('[name=name]', '<img src=x onerror=alert(1)>');
    await flush();
    expect(root.querySelector('img')).toBeNull();
    expect(element('[data-point-id="a"]')).toBe(row);
    expect(document.activeElement).toBe(name);
  });
  it('preserves state on failed import and atomically replaces only after confirmation', async () => {
    click('[data-import-open]');
    input('[data-import-source]', 'map: invalid');
    click('[data-import-validate]');
    await flush();
    expect(session.selectedId).toBe('a');
    expect(session.draft.points[0]?.name).toBe('A');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
    input(
      '[data-import-source]',
      'map:\n  points:\n    - {id: a, name: Imported, longitude: 120, latitude: 35}\n  zoom: 21\n  track: {source: track.gpx}',
    );
    click('[data-import-validate]');
    expect(session.draft.points[0]?.name).toBe('A');
    click('[data-import-confirm]');
    await flush();
    expect(session.draft.zoom).toBe(21);
    expect(session.draft.track).toEqual({ source: 'track.gpx' });
    expect(element('[data-track]').textContent).toContain('真实轨迹');
    expect(element('[data-zoom-warning]').textContent).toContain('预览');
    maps[0]!.options.onMove('a', [1, 2]);
    maps[0]!.options.onCandidate([3, 4]);
    await flush();
    expect(session.draft.points[0]?.longitude).toBe(120);
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('120');
    input('[name=latitude]', '36');
    await flush();
    expect(session.draft.zoom).toBe(21);
    expect(session.draft.points[0]?.latitude).toBe(36);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
    expect(element('[data-yaml]').textContent).toContain('zoom: 21');
  });
  it('renders normally without fitting and fits only explicitly', async () => {
    input('[name=latitude]', '33');
    await flush();
    expect(maps[0]!.render.mock.calls.at(-1)?.[2]).toBeUndefined();
    click('[data-fit]');
    expect(maps[0]!.render.mock.calls.at(-1)?.[2]).toEqual({ fitView: true });
  });
  it('ignores map callbacks after destroy', async () => {
    handle.destroy();
    maps[0]!.options.onMove('a', [1, 2]);
    await flush();
    expect(session.draft.points[0]?.longitude).toBe(118.123456789);
  });
  it('ignores a clipboard completion from before an import reusing IDs and revisions', async () => {
    let resolve!: () => void;
    const write = vi.fn().mockReturnValue(
      new Promise<void>((yes) => {
        resolve = yes;
      }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: write },
    });
    click('[data-copy]');
    click('[data-import-open]');
    input(
      '[data-import-source]',
      'map:\n  points:\n    - {id: a, name: New, longitude: 120, latitude: 35}',
    );
    click('[data-import-validate]');
    click('[data-import-confirm]');
    await flush();
    resolve();
    await flush();
    expect(element('[data-export-status]').textContent).toBe('');
    expect(session.draft.points[0]?.name).toBe('New');
  });
  it('destroys a late map handle after replacement without rendering into the new draft', async () => {
    handle.destroy();
    let resolve!: (value: AuthorMapHandle) => void;
    let old!: AuthorMapOptions;
    const late: typeof createAuthorMap = (_container, options) => {
      old = options;
      return new Promise((yes) => {
        resolve = yes;
      });
    };
    handle = mountAuthorEditor(root, bootstrap, session, { mapFactory: late });
    const beforeResolve = resolve;
    const beforeOptions = old;
    click('[data-import-open]');
    input(
      '[data-import-source]',
      'map:\n  points:\n    - {id: a, name: New, longitude: 120, latitude: 35}',
    );
    click('[data-import-validate]');
    click('[data-import-confirm]');
    const lateHandle = { render: vi.fn(), destroy: vi.fn(), setCandidate: vi.fn() };
    beforeResolve(lateHandle);
    await flush();
    expect(lateHandle.destroy).toHaveBeenCalledOnce();
    expect(lateHandle.render).not.toHaveBeenCalled();
    beforeOptions.onMove('a', [1, 2]);
    expect(session.draft.points[0]?.longitude).toBe(120);
    resolve({ render() {}, destroy() {}, setCandidate() {} });
    await flush();
  });
  it('coalesces multiple input updates and keeps invalid buffers across selection', async () => {
    const initial = maps[0]!.render.mock.calls.length;
    input('[name=name]', 'AB');
    input('[name=latitude]', '33');
    input('[name=longitude]', '');
    await flush();
    expect(maps[0]!.render.mock.calls.length).toBe(initial + 1);
    click('[data-new]');
    await flush();
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    click('[data-point-id="a"] [data-select]');
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('');
  });
  it('rejects incomplete new zoom and supports removing optional zoom', async () => {
    input('[data-zoom]', '1e');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    await flush();
    expect(session.draft.zoom).toBeUndefined();
    input('[data-zoom]', '12');
    await flush();
    expect(session.draft.zoom).toBe(12);
    input('[data-zoom]', '');
    await flush();
    expect(session.draft.zoom).toBeUndefined();
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });
  it('keeps keyboard focus on the moved point control', async () => {
    click('[data-new]');
    input('[name=name]', 'B');
    input('[name=longitude]', '119');
    input('[name=latitude]', '33');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    const up = element<HTMLButtonElement>('[data-point-id="point-1"] [data-up]');
    up.focus();
    up.click();
    await flush();
    expect(document.activeElement).toBe(element('[data-point-id="point-1"] [data-select]'));
  });
  it('commits representative selection on the native keyboard change event', async () => {
    click('[data-new]');
    input('[name=name]', 'B');
    input('[name=longitude]', '119');
    input('[name=latitude]', '33');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    const radio = element<HTMLInputElement>('[data-point-id="point-1"] input[type=radio]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(session.draft.representativeId).toBe('point-1');
  });
});
