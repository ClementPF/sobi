import { z } from 'zod';
import { ApiError } from './errors.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const cursorQuerySchema = z.object({
  cursor: z.string().max(200).optional().describe('Opaque cursor from a previous nextCursor'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export interface Cursor {
  at: Date;
  id: string;
}

/** Keyset cursor over (timestamp desc, id desc). */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (raw === undefined) return undefined;
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime()) || !z.uuid().safeParse(id).success) {
    throw ApiError.badRequest('Invalid cursor', 'INVALID_CURSOR');
  }
  return { at, id };
}
