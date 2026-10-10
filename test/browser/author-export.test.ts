// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAuthorExportControls } from '../../src/browser/author/export-controls';
import type { AuthorExportResult } from '../../src/author/yaml';
let root: HTMLElement;
let result: AuthorExportResult;
let invalid: boolean;
let controls: ReturnType<typeof createAuthorExportControls>;
let write: ReturnType<typeof vi.fn>;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const button = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!;
beforeEach(() => {
  vi.useFakeTimers();
  const template = document.createElement('template');
  template.innerHTML = readFileSync('src/author/editor.html', 'utf8');
  document.body.replaceChildren(template.content.querySelector('main')!.cloneNode(true));
  root = document.querySelector('[data-export]')!;
  result = {
    ok: true,
    yaml: 'map: 当前中文\n',
    revision: 1,
    map: { points: [{ id: 'a', name: '当前中文', longitude: 118, latitude: 32 }] },
  };
  invalid = false;
  write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: write },
  });
  controls = createAuthorExportControls(
    root,
    () => result,
    () => invalid,
  );
});
afterEach(() => {
  controls?.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
it('copies only on click and recomputes the current revision', async () => {
  expect(write).not.toHaveBeenCalled();
  result = {
    ...(result as Extract<AuthorExportResult, { ok: true }>),
    yaml: 'map: 新值',
    revision: 2,
  };
  button('[data-copy]').click();
  await flush();
  expect(write).toHaveBeenCalledWith('map: 新值');
  expect(root.querySelector('[data-export-status]')!.textContent).toContain('已复制');
  vi.advanceTimersByTime(2999);
  expect(root.querySelector('[data-export-status]')!.textContent).toContain('已复制');
  vi.advanceTimersByTime(1);
  expect(root.querySelector('[data-export-status]')!.textContent).toBe('');
});
it('disables actions immediately for pending input and never uses stale YAML', () => {
  invalid = true;
  controls.refresh();
  expect(button('[data-copy]').disabled).toBe(true);
  expect(button('[data-download]').disabled).toBe(true);
  invalid = false;
  result = { ok: false, issues: [{ fieldPath: 'map', message: 'invalid' }] };
  button('[data-copy]').disabled = false;
  button('[data-copy]').click();
  expect(write).not.toHaveBeenCalled();
});
it('offers a labelled readonly fallback after clipboard rejection', async () => {
  write.mockRejectedValue(new Error('denied'));
  button('[data-copy]').click();
  await flush();
  const area = root.querySelector<HTMLTextAreaElement>('[data-copy-fallback]')!;
  expect(area.readOnly).toBe(true);
  expect(area.value).toBe('map: 当前中文\n');
  expect(area.hidden).toBe(false);
  expect(area.labels?.length).toBe(1);
});
it('downloads UTF-8 YAML only on click and revokes its URL', () => {
  const create = vi.fn().mockReturnValue('blob:fixture');
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('post-map.yaml');
  });
  expect(create).not.toHaveBeenCalled();
  button('[data-download]').click();
  expect(click).toHaveBeenCalledOnce();
  expect(create.mock.calls[0]?.[0].type).toBe('text/yaml;charset=utf-8');
  expect(revoke).toHaveBeenCalledWith('blob:fixture');
});
it('does not update UI after a late clipboard result or destroyed timer', async () => {
  let reject!: (reason: Error) => void;
  write.mockReturnValue(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  button('[data-copy]').click();
  controls.destroy();
  reject(new Error('late'));
  await flush();
  vi.runAllTimers();
  expect(root.querySelector('[data-export-status]')!.textContent).toBe('');
  expect(root.querySelector<HTMLTextAreaElement>('[data-copy-fallback]')!.hidden).toBe(true);
});
it('does not announce a late copy after the current revision changes', async () => {
  let resolve!: () => void;
  write.mockReturnValue(
    new Promise<void>((yes) => {
      resolve = yes;
    }),
  );
  button('[data-copy]').click();
  result = {
    ...(result as Extract<AuthorExportResult, { ok: true }>),
    revision: 2,
    yaml: 'map: 新草稿',
  };
  resolve();
  await flush();
  expect(root.querySelector('[data-export-status]')!.textContent).toBe('');
});
it('cancels the successful-copy feedback timer when destroyed', async () => {
  button('[data-copy]').click();
  await flush();
  expect(root.querySelector('[data-export-status]')!.textContent).toContain('已复制');
  controls.destroy();
  vi.advanceTimersByTime(3000);
  expect(root.querySelector('[data-export-status]')!.textContent).toBe('');
});
