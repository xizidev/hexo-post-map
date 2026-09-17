const HTML_ESCAPE_CHARACTERS: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const ENCODED_CONTROL_CHARACTER_PATTERN =
  /%(?:0[0-9a-f]|1[0-9a-f]|7f|c2%(?:8[0-9a-f]|9[0-9a-f]))/iu;

/** Escapes untrusted text for insertion into HTML text or attribute content. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_CHARACTERS[character] ?? character);
}

/**
 * Returns a URL that can safely be placed in a post or image attribute.
 *
 * Hexo sites use root-relative URLs so deployment under a configured site root remains intact.
 * Document-relative and protocol-relative URLs are deliberately rejected because their final origin
 * depends on the containing page or protocol.
 */
export function safeUrl(value: string, kind: 'post' | 'image'): string | null {
  // The caller's output context is explicit at the API boundary; both contexts share this allowlist.
  void kind;

  if (
    value.length === 0 ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    ENCODED_CONTROL_CHARACTER_PATTERN.test(value) ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return null;
  }

  if (value.startsWith('/')) {
    return value;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
