import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { escapeHtml, safeUrl } from '../presentation/safe-html';

type Element = DefaultTreeAdapterMap['element'];
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const NON_DATA_ELEMENTS = new Set([
  'textarea',
  'title',
  'style',
  'script',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
  'noscript',
  'template',
]);
const JAVASCRIPT_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

function treeNodes(node: DefaultTreeAdapterMap['node']): DefaultTreeAdapterMap['node'][] {
  return [node, ...('childNodes' in node ? node.childNodes.flatMap(treeNodes) : [])];
}

function elements(node: DefaultTreeAdapterMap['node']): Element[] {
  return treeNodes(node).filter((child): child is Element => 'tagName' in child);
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function isExecutableScript(element: Element): boolean {
  const type = (attribute(element, 'type') ?? '').trim().toLowerCase();
  return (
    element.namespaceURI === HTML_NAMESPACE &&
    element.tagName === 'script' &&
    (type === '' || type === 'module' || JAVASCRIPT_TYPES.has(type))
  );
}

/** An unterminated tail can absorb appended markup or keep it in a foreign/inert context. */
function safeInsertionOffset(
  document: DefaultTreeAdapterMap['document'],
  preferred: number,
): number {
  let offset = preferred;
  for (const node of treeNodes(document)) {
    const location = node.sourceCodeLocation;
    if (!location || location.startOffset >= offset) continue;
    // parse5 may leave an unclosed raw-text element's endOffset at its startOffset.
    // Missing endTag, rather than that endOffset, identifies its absorbing tail.
    if (
      (node.nodeName === '#comment' && location.endOffset >= offset) ||
      ('tagName' in node &&
        !node.sourceCodeLocation?.endTag &&
        ((node.namespaceURI !== HTML_NAMESPACE && location.endOffset >= offset) ||
          (node.namespaceURI === HTML_NAMESPACE && NON_DATA_ELEMENTS.has(node.tagName))))
    ) {
      offset = location.startOffset;
    }
  }
  return offset;
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
      node.namespaceURI === HTML_NAMESPACE &&
      node.tagName === 'link' &&
      attribute(node, 'disabled') === undefined &&
      attribute(node, 'href') === style &&
      attribute(node, 'rel')?.toLowerCase().split(/\s+/u).includes('stylesheet'),
  );
  const css = hasStyle ? '' : `<link rel="stylesheet" href="${escapeHtml(style)}">`;
  const scripts = [...(detail ? ['post-map.js'] : []), ...(overview ? ['overview-map.js'] : [])]
    .map(assetUrl)
    .filter(
      (url) => !nodes.some((node) => isExecutableScript(node) && attribute(node, 'src') === url),
    )
    .map((url) => `<script defer src="${escapeHtml(url)}"></script>`)
    .join('');

  const closingOffset = (tag: string): number | undefined =>
    nodes.find((node) => node.namespaceURI === HTML_NAMESPACE && node.tagName === tag)
      ?.sourceCodeLocation?.endTag?.startOffset;
  const headEnd = closingOffset('head');
  const bodyEnd = closingOffset('body') ?? closingOffset('html') ?? html.length;
  const openingEnd = (tag: string): number | undefined =>
    nodes.find((node) => node.namespaceURI === HTML_NAMESPACE && node.tagName === tag)
      ?.sourceCodeLocation?.startTag?.endOffset;
  const doctypeEnd = document.childNodes.find((node) => node.nodeName === '#documentType')
    ?.sourceCodeLocation?.endOffset;
  const styleOffset =
    headEnd ?? openingEnd('head') ?? openingEnd('body') ?? openingEnd('html') ?? doctypeEnd ?? 0;
  const insertions = [
    { offset: safeInsertionOffset(document, styleOffset), value: css },
    { offset: safeInsertionOffset(document, bodyEnd), value: scripts },
  ];
  for (const { offset, value } of insertions.sort((a, b) => b.offset - a.offset)) {
    html = html.slice(0, offset) + value + html.slice(offset);
  }
  return html;
}
