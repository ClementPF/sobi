import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, signedInUser, testClock, truncateAll, type TestClient } from './helpers.js';

const clock = testClock('2026-11-08T12:00:00Z');

describe('dashboard and history API', () => {
  let app: FastifyInstance;
  let client: TestClient;
  let exerciseId: string;
  let workoutId: string;

  async function session(at: string, amount: number) {
    clock.set(at);
    const s = (await client.post('/sessions', { workoutId })).json();
    await client.post(`/sessions/${s.id}/sets`, { exerciseId, amount });
    await client.post(`/sessions/${s.id}/end`);
    return s.id as string;
  }

  beforeAll(async () => {
    app = await buildTestApp({ clock: clock.now });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    clock.set('2026-11-08T12:00:00Z');
    ({ client } = await signedInUser(app, { createdAt: new Date('2026-11-01T00:00:00Z') }));
    const workout = (
      await client.post('/workouts', {
        name: 'Legs',
        exercises: [{ name: 'Squats', metric: 'count', earnDrinks: 1, earnPer: 100 }],
      })
    ).json();
    workoutId = workout.id;
    exerciseId = workout.exercises[0].id;
  });

  it('shows a negative balance when drinking outpaces training', async () => {
    await session('2026-11-06T09:00:00Z', 200);
    for (const t of ['2026-11-07T20:00:00Z', '2026-11-07T21:00:00Z', '2026-11-07T22:00:00Z']) {
      await client.post('/drinks', { abv: 40, volumeMl: 44, consumedAt: t });
    }
    clock.set('2026-11-08T12:00:00Z');
    const res = await client.get('/dashboard?range=7d&tz=UTC');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalEarned).toBe(2);
    expect(body.totalDrunk).toBeCloseTo(2.9757, 4);
    expect(body.balance).toBeCloseTo(-0.9757, 4);
    expect(body.balance).toBeLessThan(0);
    expect(body.from).toBe('2026-11-02');
    expect(body.to).toBe('2026-11-08');
    expect(body.series).toHaveLength(7);
    expect(body.series.at(-1).balance).toBeCloseTo(-0.9757, 4);
    expect(body.series.find((p: { date: string }) => p.date === '2026-11-06').balance).toBe(2);
    expect(body.stats.dryStreakDays).toBe(1);
    expect(body.stats.topDrinkingWeekday).toBe(6);
  });

  it('assigns entries to local days in the requested time zone', async () => {
    await client.post('/drinks', { abv: 5, volumeMl: 355, consumedAt: '2026-11-08T02:00:00Z' });
    const utc = (await client.get('/dashboard?range=7d&tz=UTC')).json();
    const ny = (await client.get('/dashboard?range=7d&tz=America/New_York')).json();
    const drunkOn = (body: { series: { date: string; drunk: number }[] }, date: string) =>
      body.series.find((p) => p.date === date)?.drunk;
    expect(drunkOn(utc, '2026-11-08')).toBeCloseTo(1.0003, 4);
    expect(drunkOn(ny, '2026-11-07')).toBeCloseTo(1.0003, 4);
    expect((await client.get('/dashboard?tz=Not/AZone')).statusCode).toBe(400);
  });

  it('groups history by local day, newest first, with a day cursor', async () => {
    const s1 = await session('2026-11-05T09:00:00Z', 100);
    await session('2026-11-06T09:00:00Z', 50);
    const drink = (
      await client.post('/drinks', { abv: 5, volumeMl: 355, consumedAt: '2026-11-06T20:00:00Z' })
    ).json();
    await client.post('/drinks', { abv: 12, volumeMl: 148, consumedAt: '2026-11-07T19:00:00Z' });

    const first = (await client.get('/history?limit=2&tz=UTC')).json();
    expect(first.days.map((d: { date: string }) => d.date)).toEqual(['2026-11-07', '2026-11-06']);
    const nov6 = first.days[1];
    expect(nov6.earned).toBe(0.5);
    expect(nov6.drunk).toBeCloseTo(1.0003, 4);
    expect(nov6.entries.map((e: { type: string; id: string }) => e.type)).toEqual([
      'drink',
      'session',
    ]);
    expect(nov6.entries[0].id).toBe(drink.id);
    expect(first.nextCursor).toBe('2026-11-06');

    const second = (await client.get(`/history?limit=2&tz=UTC&cursor=${first.nextCursor}`)).json();
    expect(second.days).toHaveLength(1);
    expect(second.days[0].entries[0]).toMatchObject({
      type: 'session',
      id: s1,
      workoutName: 'Legs',
      setCount: 1,
      earnedDrinks: 1,
    });
    expect(second.nextCursor).toBeNull();
  });

  it('stores notes on sessions and drinks and shows them in history', async () => {
    const s = await session('2026-11-07T09:00:00Z', 100);
    const patched = await client.patch(`/sessions/${s}`, { note: '  felt strong  ' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().note).toBe('felt strong');
    const drink = (
      await client.post('/drinks', {
        abv: 5,
        volumeMl: 330,
        consumedAt: '2026-11-07T20:00:00Z',
        note: 'birthday',
      })
    ).json();
    expect(drink.note).toBe('birthday');
    const edited = await client.patch(`/drinks/${drink.id}`, { note: '' });
    expect(edited.json().note).toBeNull();
    await client.patch(`/drinks/${drink.id}`, { note: 'birthday party' });

    const day = (await client.get('/history?tz=UTC')).json().days[0];
    expect(day.entries.map((e: { note: string | null }) => e.note)).toEqual([
      'birthday party',
      'felt strong',
    ]);
    expect((await client.patch(`/sessions/${s}`, { note: 'x'.repeat(501) })).statusCode).toBe(400);
  });

  it('bulk-deletes only your own sessions and drinks', async () => {
    const s = await session('2026-11-07T09:00:00Z', 100);
    const keep = await session('2026-11-06T09:00:00Z', 100);
    const drink = (
      await client.post('/drinks', { abv: 5, volumeMl: 330, consumedAt: '2026-11-07T20:00:00Z' })
    ).json();
    const other = await signedInUser(app);
    const theirs = (await other.client.post('/drinks', { abv: 5, volumeMl: 330 })).json();

    const res = await client.post('/history/delete', {
      sessionIds: [s],
      drinkIds: [drink.id, theirs.id],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessions: 1, drinks: 1 });
    const days = (await client.get('/history?tz=UTC')).json().days;
    expect(days.flatMap((d: { entries: { id: string }[] }) => d.entries.map((e) => e.id))).toEqual([
      keep,
    ]);
    expect((await other.client.get('/drinks')).json().items).toHaveLength(1);
    expect((await client.post('/history/delete', { sessionIds: ['nope'] })).statusCode).toBe(400);
  });
});
