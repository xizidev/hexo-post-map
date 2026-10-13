// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthorDraft } from '../../src/author/draft';
import type { AuthorBootstrap } from '../../src/author/protocol';
import { mountAuthorEditor, type AuthorEditorSession } from '../../src/browser/author/controller';
import type {
  AuthorPlaceSearchOutcome,
  AuthorPlaceSearchQuery,
} from '../../src/browser/author/search';

const bootstrap: AuthorBootstrap = {
  version: 1,
  mode: 'map',
  defaultZoom: 12,
  mapConfig: {
    provider: 'amap',
    amap: { key: 'fixture', securityJsCode: 'fixture', mapStyle: 'amap://styles/normal' },
  },
};
const place = {
  name: '南京南站',
  city: '南京市',
  address: '雨花台区玉兰路',
  coordinate: [118.79687712345, 31.96867898765] as const,
};
const success: AuthorPlaceSearchOutcome = { state: 'success', places: [place] };
let root: HTMLElement;
let session: AuthorEditorSession;
let editor: ReturnType<typeof mountAuthorEditor>;
let requests: {
  query: AuthorPlaceSearchQuery;
  signal: AbortSignal;
  resolve(value: AuthorPlaceSearchOutcome): void;
}[];
let candidate: ReturnType<typeof vi.fn>;
const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};
function element<T extends HTMLElement>(selector: string): T {
  const result = root.querySelector<T>(selector);
  expect(result, `Missing editor control ${selector}`).not.toBeNull();
  return result!;
}
function input(selector: string, value: string) {
  const field = element<HTMLInputElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function search(keyword = '南京南站', city = '') {
  input('[data-search-keyword]', keyword);
  input('[data-search-city]', city);
  element<HTMLFormElement>('[data-search-form]').requestSubmit();
}
beforeEach(async () => {
  const template = document.createElement('template');
  template.innerHTML = readFileSync('src/author/editor.html', 'utf8');
  document.body.replaceChildren(template.content.querySelector('main')!.cloneNode(true));
  root = document.querySelector('[data-author-root]')!;
  session = {
    draft: createAuthorDraft({
      points: [
        { id: 'a', name: 'Old A', longitude: 120, latitude: 30 },
        { id: 'b', name: 'Old B', longitude: 121, latitude: 31 },
      ],
      representative: 'b',
      route: ['a', 'b', 'a'],
      zoom: 21,
    }),
    selectedId: 'a',
  };
  requests = [];
  candidate = vi.fn();
  editor = mountAuthorEditor(root, bootstrap, session, {
    mapFactory: async () => ({ render() {}, destroy() {}, setCandidate: candidate }),
    searchPlaces: (query, signal) =>
      new Promise((resolve) => requests.push({ query, signal, resolve })),
  });
  await flush();
});
afterEach(() => {
  editor?.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('author place search flow', () => {
  it('asks before replacing an unconfirmed input and keeps fields, results and export gate on cancel', async () => {
    element<HTMLButtonElement>('[data-new]').click();
    input('[name=name]', '尚未保存的备注');
    input('[name=longitude]', '1e+');
    input('[name=latitude]', '30');
    const before = session.draft;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    search();
    requests[0]!.resolve(success);
    await flush();
    const result = element<HTMLButtonElement>('[data-search-result]');
    result.click();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(element<HTMLInputElement>('[name=name]').value).toBe('尚未保存的备注');
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
    expect(element<HTMLInputElement>('[name=latitude]').value).toBe('30');
    expect(root.querySelectorAll('[data-search-result]')).toHaveLength(1);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    expect(session.draft).toBe(before);
    confirm.mockReturnValue(true);
    result.click();
    await flush();
    expect(element<HTMLInputElement>('[name=name]').value).toBe(place.name);
    expect(session.draft).toBe(before);
    expect(candidate).toHaveBeenLastCalledWith(place.coordinate, { focus: true });
  });
  it('does not let replacement confirmation update an editor destroyed while confirming', async () => {
    element<HTMLButtonElement>('[data-new]').click();
    input('[name=name]', 'Unconfirmed');
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      editor.destroy();
      return true;
    });
    search();
    requests[0]!.resolve(success);
    await flush();
    const before = session.draft;
    element<HTMLButtonElement>('[data-search-result]').click();
    await flush();
    expect(session.draft).toBe(before);
    expect(session.inputs?.newFields.name).toBe('Unconfirmed');
    expect(element<HTMLInputElement>('[name=name]').value).toBe('Unconfirmed');
  });
  it('does not let replacement confirmation overwrite a newly imported draft', async () => {
    element<HTMLButtonElement>('[data-new]').click();
    input('[name=name]', 'Unconfirmed');
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      element<HTMLButtonElement>('[data-import-open]').click();
      input(
        '[data-import-source]',
        'map:\n  points:\n    - {id: replacement, name: Imported, longitude: 110, latitude: 20}',
      );
      element<HTMLButtonElement>('[data-import-validate]').click();
      element<HTMLButtonElement>('[data-import-confirm]').click();
      return true;
    });
    search();
    requests[0]!.resolve(success);
    await flush();
    element<HTMLButtonElement>('[data-search-result]').click();
    await flush();
    expect(session.draft.points[0]?.name).toBe('Imported');
    expect(element<HTMLInputElement>('[name=name]').value).toBe('Imported');
    expect(root.querySelectorAll('[data-search-result]')).toHaveLength(0);
  });
  it('shows an actionable empty result and can retry', async () => {
    search();
    requests[0]!.resolve({ state: 'success', places: [] });
    await flush();
    expect(element('[data-search-status]').textContent).toContain('未找到');
    expect(element('[data-search-results]').hidden).toBe(true);
    search('具体地点');
    expect(requests).toHaveLength(2);
  });
  it('keeps rejected search errors private and releases the submit button', async () => {
    editor.destroy();
    editor = mountAuthorEditor(root, bootstrap, session, {
      mapFactory: async () => ({ render() {}, destroy() {}, setCandidate: candidate }),
      searchPlaces: () => Promise.reject(new Error('key=private')),
    });
    search();
    await flush();
    expect(element('[data-search-status]').textContent).toContain('可继续');
    expect(element('[data-search-status]').textContent).not.toContain('private');
    expect(element<HTMLButtonElement>('[data-search-submit]').disabled).toBe(false);
  });
  it('focuses a chosen candidate after delayed map readiness without altering metadata', async () => {
    editor.destroy();
    let ready!: (value: {
      render(): void;
      destroy(): void;
      setCandidate: typeof candidate;
    }) => void;
    editor = mountAuthorEditor(root, bootstrap, session, {
      mapFactory: () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
      searchPlaces: async () => success,
    });
    search();
    await flush();
    element<HTMLButtonElement>('[data-search-result]').click();
    const before = session.draft;
    ready({ render() {}, destroy() {}, setCandidate: candidate });
    await flush();
    expect(candidate).toHaveBeenLastCalledWith(place.coordinate, { focus: true });
    expect(session.draft).toBe(before);
  });
  it('submits trimmed keyword and city only on explicit form submission', () => {
    input('[data-search-keyword]', '  南京南站  ');
    input('[data-search-city]', ' 南京 ');
    expect(requests).toHaveLength(0);
    element<HTMLFormElement>('[data-search-form]').requestSubmit();
    expect(requests[0]?.query).toEqual({ keyword: '南京南站', city: '南京' });
    expect(element('[data-search-status]').textContent).toContain('正在搜索');
  });
  it('does not search an empty keyword', () => {
    search('   ');
    expect(requests).toHaveLength(0);
    expect(element('[data-search-status]').textContent).toContain('请输入');
  });
  it('chooses a named candidate and focuses the map without overwriting committed draft', async () => {
    const before = session.draft;
    input('[name=longitude]', '1e+');
    search();
    requests[0]!.resolve(success);
    await flush();
    expect(session.draft).toBe(before);
    const result = element<HTMLButtonElement>('[data-search-result]');
    expect(result.textContent).toContain('南京市');
    expect(result.textContent).toContain('玉兰路');
    result.click();
    await flush();
    expect(element<HTMLInputElement>('[name=name]').value).toBe('南京南站');
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('118.79687712345');
    expect(element<HTMLInputElement>('[name=latitude]').value).toBe('31.96867898765');
    expect(candidate).toHaveBeenLastCalledWith([118.79687712345, 31.96867898765], { focus: true });
    expect(session.draft).toBe(before);
    expect(element<HTMLButtonElement>('[data-copy]').disabled).toBe(true);
    element<HTMLFormElement>('[data-point-form]').requestSubmit();
    await flush();
    expect(session.draft.points).toHaveLength(3);
    expect(session.draft.points[2]?.name).toBe('南京南站');
    expect(session.draft.representativeId).toBe('b');
    expect(session.draft.route).toEqual(['a', 'b', 'a']);
    expect(session.draft.zoom).toBe(21);
    element<HTMLButtonElement>('[data-point-id="a"] [data-select]').click();
    expect(element<HTMLInputElement>('[name=longitude]').value).toBe('1e+');
  });
  it('ignores an old query completion after a newer query finishes', async () => {
    search('旧关键词');
    search('南京南站', '南京');
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[1]!.resolve(success);
    await flush();
    requests[0]!.resolve({ state: 'success', places: [{ ...place, name: '旧结果' }] });
    await flush();
    expect(element('[data-search-results]').textContent).toContain('南京南站');
    expect(element('[data-search-results]').textContent).not.toContain('旧结果');
  });
  it('invalidates results and pending work when keyword or city changes', async () => {
    search();
    requests[0]!.resolve(success);
    await flush();
    input('[data-search-city]', '上海');
    expect(root.querySelectorAll('[data-search-result]')).toHaveLength(0);
    element<HTMLFormElement>('[data-search-form]').requestSubmit();
    input('[data-search-keyword]', '外滩');
    expect(requests[1]?.signal.aborted).toBe(true);
    requests[1]!.resolve(success);
    await flush();
    expect(root.querySelectorAll('[data-search-result]')).toHaveLength(0);
  });
  it.each(['quota', 'configuration', 'timeout', 'unavailable'] as const)(
    'keeps manual editing and existing data usable after %s failure',
    async (reason) => {
      const before = session.draft;
      search();
      requests[0]!.resolve({ state: 'error', reason });
      await flush();
      expect(element('[data-search-status]').textContent).toContain('可继续');
      expect(session.draft).toBe(before);
      element<HTMLButtonElement>('[data-new]').click();
      input('[name=name]', 'Manual');
      input('[name=longitude]', '119');
      input('[name=latitude]', '32');
      element<HTMLFormElement>('[data-point-form]').requestSubmit();
      await flush();
      expect(session.draft.points[2]?.name).toBe('Manual');
    },
  );
  it('renders provider names as literal text rather than executable markup', async () => {
    search();
    requests[0]!.resolve({
      state: 'success',
      places: [{ ...place, name: '<img src=x onerror=alert(1)>' }],
    });
    await flush();
    expect(element('[data-search-results]').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(element('[data-search-results]').querySelector('img')).toBeNull();
  });
  it('clears result ownership after import and ignores the old completion', async () => {
    search();
    element<HTMLButtonElement>('[data-import-open]').click();
    input(
      '[data-import-source]',
      'map:\n  points:\n    - {id: replacement, name: New, longitude: 110, latitude: 20}',
    );
    element<HTMLButtonElement>('[data-import-validate]').click();
    element<HTMLButtonElement>('[data-import-confirm]').click();
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[0]!.resolve(success);
    await flush();
    expect(root.querySelectorAll('[data-search-result]')).toHaveLength(0);
    expect(session.draft.points[0]?.name).toBe('New');
  });
  it('does not update detached UI or draft after destruction', async () => {
    search();
    const before = session.draft;
    editor.destroy();
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[0]!.resolve(success);
    await flush();
    expect(root.querySelectorAll('[data-search-result]')).toHaveLength(0);
    expect(session.draft).toBe(before);
  });
  it('disables provider search in credential-free manual mode without invoking search', async () => {
    editor.destroy();
    editor = mountAuthorEditor(root, { version: 1, mode: 'manual', message: 'Manual' }, session, {
      searchPlaces: () => {
        throw new Error('Must not query');
      },
    });
    expect(element<HTMLButtonElement>('[data-search-submit]').disabled).toBe(true);
    expect(element('[data-search-status]').textContent).toContain('手动');
    search();
    await flush();
    expect(requests).toHaveLength(0);
  });
});
