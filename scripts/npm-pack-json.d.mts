export interface NpmPackJsonEntry {
  filename: string;
  files: { path: string }[];
  [key: string]: unknown;
}

export function normalizeNpmPackJson(value: unknown): NpmPackJsonEntry[];
