import { escapeHtml } from '../presentation/safe-html';

/** Content must be the safely rendered overview fragment. */
export function renderStandalone(title: string, content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body><main>${content}</main></body>
</html>`;
}
