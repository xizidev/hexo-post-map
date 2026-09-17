import { describe, expect, it } from 'vitest';

import { escapeHtml, safeUrl } from '../../src/presentation/safe-html';

describe('safe presentation HTML helpers', () => {
  it('escapes every HTML-significant character in post-derived text', () => {
    expect(escapeHtml(`&<img onerror="alert('x')">`)).toBe(
      '&amp;&lt;img onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
    );
  });

  it('accepts site-relative and HTTP(S) post and image URLs', () => {
    expect(safeUrl('/archives/safe/?view=map#place', 'post')).toBe(
      '/archives/safe/?view=map#place',
    );
    expect(safeUrl('/images/cover.webp', 'image')).toBe('/images/cover.webp');
    expect(safeUrl('https://cdn.example.test/cover.webp', 'image')).toBe(
      'https://cdn.example.test/cover.webp',
    );
    expect(safeUrl('http://example.test/archives/safe/', 'post')).toBe(
      'http://example.test/archives/safe/',
    );
  });

  it('rejects executable, protocol-relative, document-relative, and malformed URLs', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'blob:https://example.test/value',
      '//cdn.example.test/cover.webp',
      'images/cover.webp',
      '/\\evil.example.test/cover.webp',
      '/safe\npath',
    ]) {
      expect(safeUrl(value, 'image')).toBeNull();
    }
  });
});
