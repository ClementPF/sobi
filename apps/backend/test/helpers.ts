import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import type { LogDestination } from '../src/lib/logger.js';
import { TEST_DATABASE_URL } from './test-env.js';

export const testEnv: Record<string, string> = {
  APP_ENV: 'test',
  LOG_LEVEL: 'info',
  DATABASE_URL: TEST_DATABASE_URL,
  TEST_DATABASE_URL,
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef0123456789abcdef',
  DEV_AUTH_SECRET: 'test-dev-auth-secret-0123456789abcdef0123456789abcdef',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_JWKS_URL: 'http://127.0.0.1:1/jwks',
};

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ ...testEnv, ...overrides });
}

export interface BuildTestAppOptions {
  env?: Record<string, string>;
  logger?: false | LogDestination;
  clock?: () => Date;
}

/** Returns an app that is not yet ready, so tests may still register extra routes. */
export async function buildTestApp(opts: BuildTestAppOptions = {}): Promise<FastifyInstance> {
  return buildApp({
    config: testConfig(opts.env),
    logger: opts.logger ?? false,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
}

export async function truncateAll(db: Database): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.map((r) => `"public"."${r.tablename}"`);
  if (names.length === 0) return;
  await db.execute(sql.raw(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`));
}

let sequence = 0;
const nextSeq = () => ++sequence;

type UserInsert = typeof users.$inferInsert;

export async function createUser(db: Database, overrides: Partial<UserInsert> = {}) {
  const n = nextSeq();
  const [row] = await db
    .insert(users)
    .values({
      googleSub: `google-sub-${n}`,
      email: `user-${n}@example.com`,
      emailVerified: true,
      name: `User ${n}`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

/** Authorization header carrying a freshly signed access token for the user. */
export async function authHeadersFor(
  app: FastifyInstance,
  userId: string,
): Promise<{ authorization: string }> {
  const token = await app.jwt.access.sign({ sub: userId, typ: 'access' });
  return { authorization: `Bearer ${token}` };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** A small authenticated client bound to one user. */
export function clientFor(app: FastifyInstance, headers: { authorization: string }) {
  const call = (method: Method, url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload: unknown = {}) => call('POST', url, payload),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    delete: (url: string) => call('DELETE', url),
  };
}

export type TestClient = ReturnType<typeof clientFor>;

/** Creates a user and an authenticated client for it. */
export async function signedInUser(app: FastifyInstance, overrides: Partial<UserInsert> = {}) {
  const user = await createUser(app.db, overrides);
  return { user, client: clientFor(app, await authHeadersFor(app, user.id)) };
}

/** Collects pino output lines for log assertions. */
export function createLogCapture(): LogDestination & { lines: string[]; text(): string } {
  const lines: string[] = [];
  return {
    lines,
    write(msg: string) {
      lines.push(msg);
    },
    text() {
      return lines.join('');
    },
  };
}

/** A mutable clock for tests that need "now" to move. */
export function testClock(start: string) {
  let now = new Date(start);
  return {
    now: () => now,
    set(iso: string) {
      now = new Date(iso);
    },
  };
}
