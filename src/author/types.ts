import type { z } from 'zod';

import type { postMapSchema } from '../domain/schema';

export type AuthorMapInput = z.input<typeof postMapSchema>;
export type AuthorPoint = AuthorMapInput['points'][number];
export type AuthorPointInput = Pick<AuthorPoint, 'name' | 'longitude' | 'latitude'>;

export interface AuthorIssue {
  readonly fieldPath: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export class AuthorDraftError extends Error {
  constructor(readonly issues: readonly AuthorIssue[]) {
    super('Map authoring draft is invalid');
    this.name = 'AuthorDraftError';
  }
}

export interface AuthorDraft {
  readonly points: readonly AuthorPoint[];
  readonly representativeId?: string;
  readonly representativeMode: 'implicit' | 'explicit' | 'pending';
  readonly route: readonly string[];
  readonly zoom?: number;
  readonly track?: AuthorMapInput['track'];
  readonly importedIds: readonly string[];
  readonly nextPointOrdinal: number;
  readonly revision: number;
}
