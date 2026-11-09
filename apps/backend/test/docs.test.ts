import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('API docs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('documents every route group with zod-derived schemas', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/auth/token',
        '/auth/google/code',
        '/auth/refresh',
        '/auth/logout',
        '/auth/dev-token',
        '/me',
        '/workouts',
        '/workouts/{id}',
        '/workouts/{id}/exercises',
        '/workouts/{id}/exercises/{exerciseId}',
        '/sessions',
        '/sessions/active',
        '/sessions/{id}',
        '/sessions/{id}/end',
        '/sessions/{id}/sets',
        '/sets/{id}',
        '/containers',
        '/containers/{id}',
        '/drinks',
        '/drinks/{id}',
        '/dashboard',
        '/history',
      ]),
    );
    for (const schema of [
      'User',
      'Workout',
      'Exercise',
      'SessionDetail',
      'SessionSummary',
      'SetEntry',
      'Container',
      'Drink',
      'Dashboard',
      'History',
    ]) {
      expect(doc.components.schemas[schema]).toBeDefined();
    }
    expect(doc.paths['/dashboard'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/health'].get.security).toBeUndefined();
  });
});
