import type { AuthorExportResult } from '../../author/yaml';
import { friendlyAuthorIssues } from './feedback';

export function createAuthorExportControls(
  root: HTMLElement,
  getCurrent: () => AuthorExportResult,
  isPendingInvalid: () => boolean,
  getPointCount: () => number,
): { refresh(): void; invalidatePending(): void; destroy(): void } {
  const owner = root.ownerDocument.defaultView!;
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const copy = find<HTMLButtonElement>('[data-copy]');
  const download = find<HTMLButtonElement>('[data-download]');
  const status = find('[data-export-status]');
  const error = find('[data-export-error]');
  const hint = find('[data-export-hint]');
  const actions = find('[data-export-actions]');
  const previewSection = find('[data-yaml-preview]');
  const preview = find('[data-yaml]');
  const fallback = find<HTMLTextAreaElement>('[data-copy-fallback]');
  const label = find('[data-copy-label]');
  let alive = true;
  let operation = 0;
  let timer: number | undefined;
  const urls = new Set<string>();
  function clearFeedback(): void {
    operation += 1;
    owner.clearTimeout(timer);
    status.textContent = '';
    fallback.hidden = label.hidden = true;
    fallback.value = '';
  }
  function refresh(): void {
    if (!alive) return;
    clearFeedback();
    const result = getCurrent();
    const pending = isPendingInvalid();
    copy.disabled = download.disabled = pending || !result.ok;
    const empty = getPointCount() === 0;
    actions.hidden = previewSection.hidden = empty;
    hint.textContent = empty
      ? '添加地点后即可导出。'
      : pending
        ? '地点信息正在填写，暂不能导出。'
        : '';
    error.textContent = empty || pending || result.ok ? '' : friendlyAuthorIssues(result.issues);
    preview.textContent = empty
      ? ''
      : !pending && result.ok
        ? result.yaml
        : '请完成地点信息后查看预览。';
  }
  function current(): Extract<AuthorExportResult, { ok: true }> | undefined {
    if (!alive || isPendingInvalid()) return;
    const result = getCurrent();
    return result.ok ? result : undefined;
  }
  async function onCopy(): Promise<void> {
    const result = current();
    if (!result) {
      refresh();
      return;
    }
    clearFeedback();
    const ticket = operation;
    const stillCurrent = () => {
      const latest = current();
      return (
        alive &&
        ticket === operation &&
        latest?.revision === result.revision &&
        latest.yaml === result.yaml
      );
    };
    try {
      await owner.navigator.clipboard.writeText(result.yaml);
      if (!stillCurrent()) return;
      status.textContent = '已复制 YAML';
      timer = owner.setTimeout(() => {
        if (stillCurrent()) status.textContent = '';
      }, 3000);
    } catch {
      if (!stillCurrent()) return;
      fallback.value = result.yaml;
      fallback.hidden = label.hidden = false;
      status.textContent = '无法自动复制，请使用下方文本框手动复制。';
      if (root.ownerDocument.activeElement === copy) {
        fallback.focus();
        fallback.select();
      }
    }
  }
  function onDownload(): void {
    const result = current();
    if (!result) {
      refresh();
      return;
    }
    try {
      const url = owner.URL.createObjectURL(
        new owner.Blob([result.yaml], { type: 'text/yaml;charset=utf-8' }),
      );
      urls.add(url);
      try {
        const link = root.ownerDocument.createElement('a');
        link.href = url;
        link.download = 'post-map.yaml';
        root.append(link);
        try {
          link.click();
        } finally {
          link.remove();
        }
      } finally {
        owner.URL.revokeObjectURL(url);
        urls.delete(url);
      }
    } catch {
      status.textContent = '下载暂不可用，请复制 YAML。';
    }
  }
  copy.addEventListener('click', onCopy);
  download.addEventListener('click', onDownload);
  refresh();
  return {
    refresh,
    invalidatePending() {
      if (!alive || !isPendingInvalid()) return;
      clearFeedback();
      copy.disabled = download.disabled = true;
      error.textContent = '';
      hint.textContent =
        getPointCount() === 0 ? '添加地点后即可导出。' : '地点信息正在填写，暂不能导出。';
      preview.textContent = getPointCount() === 0 ? '' : '请完成地点信息后查看预览。';
    },
    destroy() {
      if (!alive) return;
      alive = false;
      clearFeedback();
      copy.removeEventListener('click', onCopy);
      download.removeEventListener('click', onDownload);
      urls.forEach((url) => owner.URL.revokeObjectURL(url));
      urls.clear();
    },
  };
}
