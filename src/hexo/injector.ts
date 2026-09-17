import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { escapeHtml, safeUrl } from '../presentation/safe-html';

type Element = DefaultTreeAdapterMap['element'];

function elements(node: DefaultTreeAdapterMap['node']): Element[] {
  return [
    ...('tagName' in node ? [node] : []),
    ...('childNodes' in node ? node.childNodes.flatMap(elements) : []),
  ];
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

/** Preserves the original HTML bytes and uses parsed elements only to locate safe insertions. */
export function injectMarkedAssets(html: string, root: string): string {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const nodes = elements(document);
  const detail = nodes.some((node) => attribute(node, 'data-hpm-detail') !== undefined);
  const overview = nodes.some((node) => attribute(node, 'data-hpm-overview') !== undefined);
  if (!detail && !overview) return html;

  const base = `${root.replace(/\/$/u, '')}/hexo-post-map/assets/`;
  const assetUrl = (name: string): string => {
    const url = safeUrl(`${base}${name}`, 'post');
    if (url === null || /[?#]/u.test(url)) {
      throw new Error('[hexo-post-map] root must be a safe URL path without query or hash');
    }
    return url;
  };
  const style = assetUrl('style.css');
  const hasStyle = nodes.some(
    (node) =>
      node.tagName === 'link' &&
      attribute(node, 'href') === style &&
      attribute(node, 'rel')?.toLowerCase().split(/\s+/u).includes('stylesheet'),
  );
  const css = hasStyle ? '' : `<link rel="stylesheet" href="${escapeHtml(style)}">`;
  const scripts = [...(detail ? ['post-map.js'] : []), ...(overview ? ['overview-map.js'] : [])]
    .map(assetUrl)
    .filter(
      (url) => !nodes.some((node) => node.tagName === 'script' && attribute(node, 'src') === url),
    )
    .map((url) => `<script defer src="${escapeHtml(url)}"></script>`)
    .join('');

  const closingOffset = (tag: string): number | undefined =>
    nodes.find((node) => node.tagName === tag)?.sourceCodeLocation?.endTag?.startOffset;
  const headEnd = closingOffset('head');
  const bodyEnd = closingOffset('body') ?? closingOffset('html') ?? html.length;
  const openingEnd = (tag: string): number | undefined =>
    nodes.find((node) => node.tagName === tag)?.sourceCodeLocation?.startTag?.endOffset;
  const doctypeEnd = document.childNodes.find((node) => node.nodeName === '#documentType')
    ?.sourceCodeLocation?.endOffset;
  const styleOffset =
    headEnd ?? openingEnd('head') ?? openingEnd('body') ?? openingEnd('html') ?? doctypeEnd ?? 0;
  const insertions = [
    { offset: styleOffset, value: css },
    { offset: bodyEnd, value: scripts },
  ];
  for (const { offset, value } of insertions.sort((a, b) => b.offset - a.offset)) {
    html = html.slice(0, offset) + value + html.slice(offset);
  }
  return html;
}
