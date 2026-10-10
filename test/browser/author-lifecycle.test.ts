// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startAuthorPage } from '../../src/browser/author/index';
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
let page: ReturnType<typeof startAuthorPage>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const template = document.createElement('template');
  template.innerHTML = readFileSync('src/author/editor.html', 'utf8');
  document.body.replaceChildren(template.content.querySelector('main')!.cloneNode(true));
  location.hash = '';
  fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ version: 1, mode: 'manual', message: '手动模式' }),
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  page?.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
it('mounts credential-free manual mode when the fragment is missing or malformed', async () => {
  location.hash = '#session=bad&extra=x';
  page = startAuthorPage(window);
  await flush();
  expect(fetcher).not.toHaveBeenCalled();
  expect(document.querySelector('[data-point-form]')?.getAttribute('data-mounted')).toBe('true');
});
it.each(['forbidden', 'network', 'invalid'])('falls back to manual mode on %s', async (cause) => {
  location.hash = '#session=' + 'a'.repeat(64);
  if (cause === 'forbidden') fetcher.mockResolvedValue({ ok: false, status: 403 });
  if (cause === 'network') fetcher.mockRejectedValue(new Error('network'));
  if (cause === 'invalid')
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, mode: 'map', key: 'unsafe' }),
    });
  page = startAuthorPage(window);
  await flush();
  expect(document.querySelector('[data-map-status]')?.textContent).toContain('手动');
  const options = fetcher.mock.calls[0]?.[1];
  expect(options.headers).toEqual({ 'X-HPM-Editor-Session': 'a'.repeat(64) });
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/bootstrap');
});
it('remounts the same memory session once after persisted pageshow', async () => {
  page = startAuthorPage(window);
  await flush();
  for (const [name, value] of [
    ['name', 'A'],
    ['longitude', '118'],
    ['latitude', '32'],
  ]) {
    const field = document.querySelector<HTMLInputElement>(`[name=${name}]`)!;
    field.value = value!;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector<HTMLFormElement>('[data-point-form]')!.requestSubmit();
  await flush();
  window.dispatchEvent(new Event('pagehide'));
  const shown = new Event('pageshow');
  Object.defineProperty(shown, 'persisted', { value: true });
  window.dispatchEvent(shown);
  window.dispatchEvent(shown);
  await flush();
  expect(document.querySelectorAll('[data-point-id]')).toHaveLength(1);
  expect(document.querySelector('[data-point-id]')?.textContent).toContain('A');
  document.querySelector<HTMLButtonElement>('[data-route-add]')!.click();
  await flush();
  expect(document.querySelectorAll('[data-route-index]')).toHaveLength(1);
});
it('ignores delayed bootstrap after pagehide until a persisted remount', async () => {
  location.hash = '#session=' + 'a'.repeat(64);
  let resolve!: (value: unknown) => void;
  fetcher.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  page = startAuthorPage(window);
  window.dispatchEvent(new Event('pagehide'));
  resolve({ ok: true, json: async () => ({ version: 1, mode: 'manual', message: 'late' }) });
  await flush();
  expect(document.querySelector('[data-point-form]')?.getAttribute('data-mounted')).not.toBe(
    'true',
  );
});
