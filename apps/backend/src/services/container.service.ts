import { and, asc, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.js';
import { containers } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';

export const DEFAULT_CONTAINERS = [
  { name: 'Can', volumeMl: 355 },
  { name: 'Pint', volumeMl: 473 },
  { name: 'Wine', volumeMl: 148 },
  { name: 'Shot', volumeMl: 44 },
] as const;

export async function seedDefaultContainers(tx: Transaction, userId: string): Promise<void> {
  await tx.insert(containers).values(DEFAULT_CONTAINERS.map((c) => ({ ...c, userId })));
}

export async function listContainers(db: Database, userId: string) {
  return db
    .select()
    .from(containers)
    .where(eq(containers.userId, userId))
    .orderBy(asc(containers.volumeMl), asc(containers.name));
}

export async function findOwnedContainer(db: Database, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.id, id), eq(containers.userId, userId)));
  if (!row) throw ApiError.notFound('Container not found', 'CONTAINER_NOT_FOUND');
  return row;
}
