const SCRIPT_UNSAFE_CHARACTERS: Readonly<Record<string, string>> = Object.freeze({
  '<': '\\u003C',
  '>': '\\u003E',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
});

/** Serializes data for an application/json script element without allowing HTML parsing to escape it. */
export function serializeForHtmlScript(value: unknown): string {
  const serialized = JSON.stringify(value) ?? 'null';

  return serialized.replace(
    /[<>&\u2028\u2029]/gu,
    (character) => SCRIPT_UNSAFE_CHARACTERS[character] ?? character,
  );
}
