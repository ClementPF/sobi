import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { issueSession, type SessionTokens } from '../auth/jwt.js';
import type { GoogleIdentity } from '../auth/google.verify.js';
import type { Transaction } from '../db/client.js';
import { users } from '../db/schema.js';
import { seedDefaultContainers } from './container.service.js';

type UserRow = typeof users.$inferSelect;

export interface SignInResult extends SessionTokens {
  user: UserRow;
}

/**
 * Serializes provisioning per Google subject. Taken in its own statement before any lookup so,
 * under READ COMMITTED, later statements see the previous holder's commit.
 */
async function lockGoogleSubject(tx: Transaction, sub: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`google_sub:${sub}`}, 0))`);
}

interface Profile {
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
}

async function upsertUser(tx: Transaction, googleSub: string, profile: Profile): Promise<UserRow> {
  await lockGoogleSubject(tx, googleSub);
  const [existing] = await tx.select().from(users).where(eq(users.googleSub, googleSub)).limit(1);
  if (existing) {
    const [updated] = await tx
      .update(users)
      .set({ ...profile, updatedAt: new Date() })
      .where(eq(users.id, existing.id))
      .returning();
    if (!updated) throw new Error('user disappeared during profile refresh');
    return updated;
  }
  const [created] = await tx
    .insert(users)
    .values({ googleSub, ...profile })
    .returning();
  if (!created) throw new Error('user insert returned no row');
  await seedDefaultContainers(tx, created.id);
  return created;
}

/** Logs in the account bound to the Google subject or provisions a new one, issuing a session. */
export async function signInWithGoogle(
  app: FastifyInstance,
  identity: GoogleIdentity,
): Promise<SignInResult> {
  return app.db.transaction(async (tx) => {
    const user = await upsertUser(tx, identity.sub, {
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: identity.name,
      pictureUrl: identity.picture,
    });
    return { ...(await issueSession(app, tx, user.id)), user };
  });
}

/** Development only: a stable fake Google subject per email. */
export async function signInDevUser(app: FastifyInstance, email: string): Promise<SignInResult> {
  const normalized = email.trim().toLowerCase();
  return app.db.transaction(async (tx) => {
    const user = await upsertUser(tx, `dev:${normalized}`, {
      email: normalized,
      emailVerified: true,
      name: normalized.split('@')[0] ?? normalized,
      pictureUrl: null,
    });
    return { ...(await issueSession(app, tx, user.id)), user };
  });
}
