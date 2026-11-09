import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDefaultContainers } from '../src/services/container.service.js';
import { buildTestApp, signedInUser, testClock, truncateAll, type TestClient } from './helpers.js';

const clock = testClock('2026-11-08T20:00:00Z');

describe('containers and drinks', () => {
  let app: FastifyInstance;
  let client: TestClient;

  beforeAll(async () => {
    app = await buildTestApp({ clock: clock.now });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    const signed = await signedInUser(app);
    client = signed.client;
    await app.db.transaction((tx) => seedDefaultContainers(tx, signed.user.id));
  });

  it('lists, creates, updates and deletes containers', async () => {
    const list = (await client.get('/containers')).json();
    expect(list.map((c: { name: string }) => c.name)).toEqual(['Shot', 'Wine', 'Can', 'Pint']);

    const created = await client.post('/containers', { name: 'Stein', volumeMl: 1000 });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await client.patch(`/containers/${id}`, { volumeMl: 950 })).json().volumeMl).toBe(950);
    expect((await client.delete(`/containers/${id}`)).statusCode).toBe(204);
    expect((await client.get('/containers')).json()).toHaveLength(4);
    expect((await client.post('/containers', { name: 'x', volumeMl: 0 })).statusCode).toBe(400);
  });

  it('logs a drink from a container with server-computed grams and standard drinks', async () => {
    const can = (await client.get('/containers'))
      .json()
      .find((c: { name: string }) => c.name === 'Can');
    const res = await client.post('/drinks', {
      abv: 5,
      containerId: can.id,
      stdDrinks: 0,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      abv: 5,
      volumeMl: 355,
      containerId: can.id,
      containerName: 'Can',
      alcoholG: 14,
      stdDrinks: 1.0003,
      consumedAt: '2026-11-08T20:00:00.000Z',
    });
  });

  it('logs a custom volume at a given time', async () => {
    const res = await client.post('/drinks', {
      abv: 40,
      volumeMl: 60,
      consumedAt: '2026-11-07T22:15:00+01:00',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      volumeMl: 60,
      containerId: null,
      alcoholG: 18.94,
      stdDrinks: 1.3526,
      consumedAt: '2026-11-07T21:15:00.000Z',
    });
  });

  it('requires a volume or a container and validates abv', async () => {
    const missing = await client.post('/drinks', { abv: 5 });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VOLUME_REQUIRED');
    expect((await client.post('/drinks', { abv: 101, volumeMl: 100 })).statusCode).toBe(400);
  });

  it('keeps a drink when its container is deleted', async () => {
    const created = (await client.post('/containers', { name: 'Mug', volumeMl: 500 })).json();
    const drink = (await client.post('/drinks', { abv: 5, containerId: created.id })).json();
    await client.delete(`/containers/${created.id}`);
    const list = (await client.get('/drinks')).json();
    expect(list.items[0]).toMatchObject({ id: drink.id, containerId: null, volumeMl: 500 });
  });

  it('lists drinks newest first with a cursor and deletes them', async () => {
    for (const hour of ['18', '19', '20']) {
      await client.post('/drinks', {
        abv: 5,
        volumeMl: 330,
        consumedAt: `2026-11-08T${hour}:00:00Z`,
      });
    }
    const first = (await client.get('/drinks?limit=2')).json();
    expect(first.items.map((d: { consumedAt: string }) => d.consumedAt.slice(11, 13))).toEqual([
      '20',
      '19',
    ]);
    const second = (await client.get(`/drinks?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items).toHaveLength(1);
    expect((await client.delete(`/drinks/${second.items[0].id}`)).statusCode).toBe(204);
    expect((await client.get('/drinks')).json().items).toHaveLength(2);
  });
});
