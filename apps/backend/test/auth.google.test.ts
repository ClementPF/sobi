import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { containers, refreshTokens, users } from '../src/db/schema.js';
import { startTestGoogleJwks, type TestGoogleJwks } from './google-jwks.js';
import { buildTestApp, truncateAll } from './helpers.js';

describe('POST /auth/token (google)', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    app = await buildTestApp({ env: { GOOGLE_JWKS_URL: jwks.url } });
  });

  afterAll(async () => {
    await app.close();
    await jwks.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  const exchange = (idToken: string) =>
    app.inject({ method: 'POST', url: '/auth/token', payload: { provider: 'google', idToken } });

  const userCount = async () => (await app.db.select({ n: count() }).from(users))[0]?.n;

  it('provisions a new user with default containers and returns a session', async () => {
    const idToken = await jwks.mint({
      claims: {
        sub: 'google-123',
        name: 'Zoé Dupré',
        email: 'zoe@example.com',
        picture: 'https://lh3.googleusercontent.com/a/zoe',
      },
    });

    const res = await exchange(idToken);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(body.user).toEqual({
      id: expect.any(String),
      email: 'zoe@example.com',
      name: 'Zoé Dupré',
      pictureUrl: 'https://lh3.googleusercontent.com/a/zoe',
      units: 'metric',
    });

    const rows = await app.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ googleSub: 'google-123', emailVerified: true });

    const saved = await app.db
      .select({ name: containers.name, volumeMl: containers.volumeMl })
      .from(containers)
      .where(eq(containers.userId, body.user.id));
    expect(saved.sort((a, b) => a.volumeMl - b.volumeMl)).toEqual([
      { name: 'Shot', volumeMl: 44 },
      { name: 'Wine', volumeMl: 148 },
      { name: 'Can', volumeMl: 355 },
      { name: 'Pint', volumeMl: 473 },
    ]);

    expect(decodeJwt(body.accessToken)).toMatchObject({ sub: body.user.id, typ: 'access' });
    const refresh = decodeJwt(body.refreshToken);
    expect(refresh).toMatchObject({ sub: body.user.id, typ: 'refresh' });
    const stored = await app.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.jti, String(refresh.jti)));
    expect(stored).toHaveLength(1);
  });

  it('accepts the bare accounts.google.com issuer', async () => {
    const res = await exchange(await jwks.mint({ issuer: 'accounts.google.com' }));
    expect(res.statusCode).toBe(200);
  });

  it('repeat login reuses the user, refreshes the profile and does not re-seed containers', async () => {
    const first = await exchange(
      await jwks.mint({ claims: { sub: 'google-repeat', name: 'Ada Lovelace' } }),
    );
    const second = await exchange(
      await jwks.mint({
        claims: { sub: 'google-repeat', name: 'Ada King', email: 'ada.king@example.com' },
      }),
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().user.id).toBe(first.json().user.id);
    const rows = await app.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Ada King', email: 'ada.king@example.com' });
    expect(await app.db.select().from(containers)).toHaveLength(4);
  });

  describe('invalid tokens are rejected without provisioning', () => {
    const cases: [string, () => Promise<string>][] = [
      ['bad signature', () => jwks.mint({ signingKey: jwks.foreignKey })],
      ['wrong audience', () => jwks.mint({ audience: 'someone-else.apps.googleusercontent.com' })],
      ['wrong issuer', () => jwks.mint({ issuer: 'https://evil.example.com' })],
      ['expired', () => jwks.mint({ expiresIn: -120 })],
      ['malformed', async () => 'not-a-jwt'],
    ];

    it.each(cases)('%s → 401', async (_label, makeToken) => {
      const res = await exchange(await makeToken());
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'INVALID_ID_TOKEN', message: expect.any(String) },
      });
      expect(await userCount()).toBe(0);
      expect(await app.db.select().from(refreshTokens)).toHaveLength(0);
    });
  });

  it('email_verified=false → 401 and no user row', async () => {
    const res = await exchange(await jwks.mint({ claims: { email_verified: false } }));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await userCount()).toBe(0);
  });

  it('concurrent first sign-ins of one Google subject create a single user', async () => {
    const token = await jwks.mint({ claims: { sub: 'google-race' } });
    const results = await Promise.all([exchange(token), exchange(token), exchange(token)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(await userCount()).toBe(1);
    expect(await app.db.select().from(containers)).toHaveLength(4);
  });

  it('rejects requests with an unsupported provider or missing idToken (400)', async () => {
    const facebook = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { provider: 'facebook', idToken: 'x' },
    });
    expect(facebook.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { provider: 'google' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_ERROR');
  });
});
