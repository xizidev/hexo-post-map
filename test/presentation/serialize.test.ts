import { describe, expect, it } from 'vitest';

import { serializeForHtmlScript } from '../../src/presentation/serialize';

describe('serializeForHtmlScript', () => {
  it('cannot terminate its containing application/json script', () => {
    const value = { name: '</script><script>alert(1)</script>' };
    const serialized = serializeForHtmlScript(value);

    expect(serialized).not.toContain('</script>');
    expect(serialized).toBe(
      '{"name":"\\u003C/script\\u003E\\u003Cscript\\u003Ealert(1)\\u003C/script\\u003E"}',
    );
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it('escapes HTML-significant characters and JavaScript line separators without changing data', () => {
    const value = { text: '&<>\u2028\u2029' };
    const serialized = serializeForHtmlScript(value);

    expect(serialized).toBe('{"text":"\\u0026\\u003C\\u003E\\u2028\\u2029"}');
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it('serializes an undefined top-level value as JSON null', () => {
    expect(serializeForHtmlScript(undefined)).toBe('null');
  });
});
