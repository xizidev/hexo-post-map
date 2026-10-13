// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorDraft } from '../../src/author/draft';
import { friendlyAuthorIssues } from '../../src/browser/author/feedback';
import type { AuthorMapInput } from '../../src/author/types';
import type { AuthorBootstrap } from '../../src/author/protocol';
import { mountAuthorEditor, type AuthorEditorSession } from '../../src/browser/author/controller';
import type { AuthorMapOptions } from '../../src/browser/author/map';

const bootstrap: AuthorBootstrap = {
  version: 1,
  mode: 'manual',
  message: '手动选点模式。',
};
let root: HTMLElement;
let session: AuthorEditorSession;
let handle: ReturnType<typeof mountAuthorEditor>;
const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};
function element<T extends HTMLElement>(selector: string): T {
  const found = root.querySelector<T>(selector);
  expect(found, `Missing author feedback control ${selector}`).not.toBeNull();
  return found!;
}
function input(selector: string, value: string) {
  const field = element<HTMLInputElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function click(selector: string) {
  element<HTMLButtonElement>(selector).click();
}
function blur(selector: string) {
  element(selector).focus();
  element(selector).blur();
}
async function mount(map?: AuthorMapInput) {
  handle?.destroy();
  session = {
    draft: createAuthorDraft(map),
    selectedId: map?.points[0]?.id,
  };
  handle = mountAuthorEditor(root, bootstrap, session);
  await flush();
}
const one: AuthorMapInput = {
  points: [{ id: 'a', name: '南京南站', longitude: 118.798034, latitude: 31.968763 }],
};
beforeEach(async () => {
  const template = document.createElement('template');
  template.innerHTML = readFileSync('src/author/editor.html', 'utf8');
  document.body.replaceChildren(template.content.querySelector('main')!.cloneNode(true));
  root = document.querySelector('[data-author-root]')!;
  await mount();
});
afterEach(() => {
  handle?.destroy();
  document.body.replaceChildren();
});

describe('author feedback states', () => {
  it.each(['constructor', '__proto__', 'private-source-value'])(
    'keeps unknown diagnostic %s private',
    (message) => {
      const formatted = friendlyAuthorIssues([
        { fieldPath: 'map.private-path', message, line: NaN, column: -1 },
      ]);
      expect(formatted).toBe('请检查地图配置的格式与字段。');
    },
  );
  it('treats an empty draft as guidance and hides unusable export actions and preview', () => {
    expect(element('[data-export-error]').textContent).toBe('');
    expect(element('[data-export-hint]').textContent).toContain('添加');
    expect(element('[data-export-actions]').hidden).toBe(true);
    expect(element('[data-yaml-preview]').hidden).toBe(true);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    expect(element<HTMLButtonElement>('[data-download]').disabled).toBe(true);
    expect(element('[data-export]').textContent).not.toMatch(/map\.|must contain|完成草稿/u);
    expect(session.draft.points).toHaveLength(0);
  });

  it('keeps an unconfirmed incomplete candidate quiet without accepting or exporting it', async () => {
    click('[data-new]');
    input('[name=name]', '待添加地点');
    input('[name=longitude]', '1e+');
    await flush();
    expect(element('[data-export-error]').textContent).toBe('');
    expect(element('[data-name-error]').textContent).toBe('');
    expect(element('[data-longitude-error]').textContent).toBe('');
    expect(element('[data-export-actions]').hidden).toBe(true);
    expect(element('[name=longitude]').getAttribute('aria-invalid')).not.toBe('true');
    expect(session.draft.points).toHaveLength(0);
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
  });

  it('reveals usable export actions only after a valid place has been explicitly added', async () => {
    input('[name=name]', '南京南站');
    input('[name=longitude]', '118.798034');
    input('[name=latitude]', '31.968763');
    expect(session.draft.points).toHaveLength(0);
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    expect(session.draft.points).toHaveLength(1);
    expect(element('[data-export-actions]').hidden).toBe(false);
    expect(element('[data-yaml-preview]').hidden).toBe(false);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
    expect(element('[data-export-error]').textContent).toBe('');
    expect(element('[data-export-hint]').textContent).toBe('');
    expect(element('[data-yaml]').textContent).toContain('南京南站');
  });

  it('blocks stale exports immediately while typing but shows a coordinate error only on blur', async () => {
    await mount(one);
    input('[name=longitude]', '1e+');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    expect(element<HTMLButtonElement>('[data-download]').disabled).toBe(true);
    await flush();
    expect(element('[data-longitude-error]').textContent).toBe('');
    expect(element('[data-export-error]').textContent).toBe('');
    expect(element('[data-export-hint]').textContent).not.toBe('');
    expect(session.draft.points[0]?.longitude).toBe(118.798034);
    blur('[name=longitude]');
    expect(element('[data-longitude-error]').textContent).toContain('经度');
    expect(element('[name=longitude]').getAttribute('aria-invalid')).toBe('true');
    expect(element('[data-longitude-error]').id).toBe(
      element('[name=longitude]').getAttribute('aria-describedby'),
    );
  });

  it('clears a previously displayed error during correction without exporting incomplete input', async () => {
    await mount(one);
    input('[name=longitude]', '1e+');
    blur('[name=longitude]');
    expect(element('[data-longitude-error]').textContent).not.toBe('');
    input('[name=longitude]', '2e+');
    expect(element('[data-longitude-error]').textContent).toBe('');
    expect(element('[name=longitude]').getAttribute('aria-invalid')).not.toBe('true');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    input('[name=longitude]', '120.125');
    await flush();
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
    expect(session.draft.points[0]?.longitude).toBe(120.125);
  });

  it('shows specific field errors on an invalid add attempt without creating a point', async () => {
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    expect(element('[data-name-error]').textContent).toContain('名称');
    expect(element('[data-longitude-error]').textContent).toContain('经度');
    expect(element('[data-latitude-error]').textContent).toContain('纬度');
    expect(element<HTMLDetailsElement>('[data-coordinate-details]').open).toBe(true);
    expect(session.draft.points).toHaveLength(0);
    expect(element('[data-export-error]').textContent).toBe('');
    expect(element('[data-export-actions]').hidden).toBe(true);
  });

  it('shows invalid zoom on Enter submission even when the point fields are complete', async () => {
    input('[name=name]', '南京南站');
    input('[name=longitude]', '118.798034');
    input('[name=latitude]', '31.968763');
    input('[data-zoom]', '1e+');
    expect(element('[data-zoom-error]').textContent).toBe('');
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    expect(session.draft.points).toHaveLength(1);
    expect(element('[data-zoom-error]').textContent).toContain('2–20');
    expect(element('[data-zoom]').getAttribute('aria-invalid')).toBe('true');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
  });

  it('assigns a blur triggered by map selection to the field that was being edited', async () => {
    await mount(one);
    handle.destroy();
    let mapOptions!: AuthorMapOptions;
    handle = mountAuthorEditor(
      root,
      {
        version: 1,
        mode: 'map',
        defaultZoom: 12,
        mapConfig: {
          provider: 'amap',
          amap: { key: 'fixture', securityJsCode: 'fixture', mapStyle: 'amap://styles/normal' },
        },
      },
      session,
      {
        mapFactory: async (_root, options) => {
          mapOptions = options;
          return { render() {}, destroy() {}, setCandidate() {} };
        },
      },
    );
    await flush();
    element('[name=longitude]').focus();
    input('[name=longitude]', '1e+');
    mapOptions.onCandidate([118.787645, 32.011604]);
    await flush();
    expect(element('[data-longitude-error]').textContent).toBe('');
    expect(element('[data-name-error]').textContent).toBe('');
    click('[data-point-id=a] [data-select]');
    await flush();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
    expect(element('[data-longitude-error]').textContent).toContain('经度');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
  });

  it.each([false, true])(
    'binds the active field correctly when map selection follows a remount=%s',
    async (remount) => {
      await mount(one);
      handle.destroy();
      let mapOptions!: AuthorMapOptions;
      const mapBootstrap: AuthorBootstrap = {
        version: 1,
        mode: 'map',
        defaultZoom: 12,
        mapConfig: {
          provider: 'amap',
          amap: { key: 'fixture', securityJsCode: 'fixture', mapStyle: 'amap://styles/normal' },
        },
      };
      const options = {
        mapFactory: async (_root: HTMLElement, options: AuthorMapOptions) => {
          mapOptions = options;
          return { render() {}, destroy() {}, setCandidate() {} };
        },
      };
      handle = mountAuthorEditor(root, mapBootstrap, session, options);
      await flush();
      if (remount) {
        element('[name=longitude]').focus();
        input('[name=longitude]', '1e+');
        handle.destroy();
        handle = mountAuthorEditor(root, mapBootstrap, session, options);
        await flush();
      } else element('[name=name]').focus();
      mapOptions.onCandidate([118.787645, 32.011604]);
      await flush();
      expect(element('[name=name]')).toBe(document.activeElement);
      expect(element('[data-name-error]').textContent).toBe('');
      element('[name=name]').blur();
      expect(element('[data-name-error]').textContent).toContain('名称');
      click('[data-point-id=a] [data-select]');
      await flush();
      if (remount) expect(element('[data-longitude-error]').textContent).toContain('经度');
      expect(element('[data-name-error]').textContent).toBe('');
    },
  );

  it('preserves raw invalid input and its blur feedback across memory remount', async () => {
    await mount(one);
    input('[name=longitude]', '1e+');
    blur('[name=longitude]');
    handle.destroy();
    handle = mountAuthorEditor(root, bootstrap, session);
    await flush();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
    expect(element('[data-longitude-error]').textContent).toContain('经度');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
  });

  it('starts manual addition quietly even when an invalid old coordinate still owns focus', async () => {
    await mount(one);
    element('[name=longitude]').focus();
    input('[name=longitude]', '1e+');
    click('[data-new]');
    await flush();
    expect(element('[name=name]')).toBe(document.activeElement);
    expect(element('[data-longitude-error]').textContent).toBe('');
    expect(element('[data-name-error]').textContent).toBe('');
    click('[data-point-id=a] [data-select]');
    await flush();
    expect(element('[data-longitude-error]').textContent).toContain('经度');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
  });

  it('defers invalid zoom feedback to blur and retains imported finite zoom values', async () => {
    await mount({ ...one, zoom: 21 });
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
    expect(element('[data-zoom-warning]').textContent).toContain('导入');
    input('[data-zoom]', '2e+');
    await flush();
    expect(element('[data-zoom-error]').textContent).toBe('');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    blur('[data-zoom]');
    expect(element('[data-zoom-error]').textContent).toContain('2–20');
    input('[data-zoom]', '');
    await flush();
    expect(element('[data-zoom-error]').textContent).toBe('');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });

  it('explains a deleted representative in Chinese near the place list and blocks export', async () => {
    await mount({
      points: [
        ...one.points,
        { id: 'b', name: '老门东', longitude: 118.787645, latitude: 32.011604 },
      ],
      representative: 'a',
    });
    click('[data-point-id=a] [data-delete]');
    click('[data-delete-confirm]');
    await flush();
    expect(element('[data-representative-error]').textContent).toContain('代表地点');
    expect(element('[data-export-error]').textContent).toContain('代表地点');
    expect(element('[data-export-error]').textContent).not.toMatch(/map\.|must|草稿/u);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    click('[data-point-id=b] input[type=radio]');
    await flush();
    expect(element('[data-representative-error]').textContent).toBe('');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });

  it('explains a one-stop route near its editor without changing place order or representative', async () => {
    await mount({ ...one, route: ['a', 'a'] });
    click('[data-workspace-tab=route]');
    click('[data-route-index="1"] [data-remove]');
    await flush();
    expect(element('[data-route-error]').textContent).toContain('途经');
    expect(element('[data-export-error]').textContent).toContain('途经');
    expect(element('[data-export-error]').textContent).not.toMatch(/map\.|must|草稿/u);
    expect(session.draft.representativeId).toBe('a');
    expect(session.draft.points).toHaveLength(1);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    click('[data-route-index="0"] [data-remove]');
    await flush();
    expect(element('[data-route-error]').textContent).toBe('');
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(false);
  });

  it('explains malformed import safely in Chinese and keeps numeric line and column location', () => {
    click('[data-import-open]');
    input('[data-import-source]', 'map: [private-value');
    click('[data-import-validate]');
    const message = element('[data-import-error]').textContent!;
    expect(message).toContain('格式');
    expect(message).toMatch(/第\s*\d+\s*行.*第\s*\d+\s*列/u);
    expect(message).not.toMatch(/private-value|map\.|must|syntax is invalid/u);
  });
});
