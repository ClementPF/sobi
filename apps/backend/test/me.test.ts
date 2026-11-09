import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, signedInUser, truncateAll } from './helpers.js';

describe('/me', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  it('defaults to metric and stores the unit preference per user', async () => {
    const { client } = await signedInUser(app);
    const { client: other } = await signedInUser(app);
    expect((await client.get('/me')).json().units).toBe('metric');

    const patched = await client.patch('/me', { units: 'imperial' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().units).toBe('imperial');
    expect((await client.get('/me')).json().units).toBe('imperial');
    expect((await other.get('/me')).json().units).toBe('metric');
  });

  it('rejects unknown unit systems', async () => {
    const { client } = await signedInUser(app);
    expect((await client.patch('/me', { units: 'cubits' })).statusCode).toBe(400);
  });
});
