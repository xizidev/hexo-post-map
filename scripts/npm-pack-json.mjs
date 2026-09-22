export function normalizeNpmPackJson(value) {
  const entries = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object'
      ? Object.values(value)
      : null;

  if (
    entries === null ||
    entries.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))
  ) {
    throw new TypeError('Unsupported npm pack --json output');
  }

  return entries;
}
