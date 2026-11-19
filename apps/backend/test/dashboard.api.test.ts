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

  it.each([
    ['1d', 1],
    ['30d', 30],
    ['90d', 90],
    ['365d', 365],
    ['all', 2],
  ])('serves the Home %s period through the API', async (range, days) => {
    await client.post('/drinks', { abv: 5, volumeMl: 355, consumedAt: '2026-11-07T20:00:00Z' });
    await client.post('/drinks', { abv: 5, volumeMl: 355, consumedAt: '2026-11-08T08:00:00Z' });
    const response = await client.get(`/dashboard?range=${range}&tz=UTC`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ range, to: '2026-11-08' });
    expect(response.json().series).toHaveLength(days);
    // Each logged drink stores 1.0003 standard drinks; dashboard totals sum stored values.
    expect(response.json().rangeDrunk).toBeCloseTo(range === '1d' ? 1.0003 : 2.0006, 4);
  });

  it('assigns entries to local days in the requested time zone', async () => {
    await client.post('/drinks', { abv: 5, volumeMl: 355, consumedAt: '2026-11-08T02:00:00Z' });
    const utc = (await client.get('/dashboard?range=7d&tz=UTC')).json();
    const ny = (await client.get('/dashboard?range=7d&tz=America/New_York')).json();
    const drunkOn = (body: { series: { date: string; drunk: number }[] }, date: string) =>
      body.series.find((p) => p.date === date)?.drunk;
    expect(drunkOn(utc, '2026-11-08')).toBeCloseTo(1.0003, 4);
    expect(drunkOn(ny, '2026-11-07')).toBeCloseTo(1.0003, 4);
    const todayNy = (await client.get('/dashboard?range=1d&tz=America/New_York')).json();
    expect(todayNy.series).toHaveLength(1);
    expect(todayNy.rangeDrunk).toBe(0);
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

  it('loads the selected day with drink details, full notes, and workout earnings', async () => {
    await session('2026-11-07T09:00:00Z', 100);
    const container = (await client.post('/containers', { name: 'Can', volumeMl: 355 })).json();
    const note = 'a'.repeat(500);
    const drink = (
      await client.post('/drinks', {
        abv: 5,
        containerId: container.id,
        consumedAt: '2026-11-07T20:00:00Z',
        note,
      })
    ).json();
    await client.post('/drinks', { abv: 5, volumeMl: 355, consumedAt: '2026-11-06T20:00:00Z' });
    const response = await client.get('/history/day?date=2026-11-07&tz=UTC');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      date: '2026-11-07',
      earned: 1,
      drunk: 1.0003,
      entries: [
        { type: 'drink', id: drink.id, volumeMl: 355, abv: 5, containerName: 'Can', note },
        { type: 'session', workoutName: 'Legs', setCount: 1, earnedDrinks: 1 },
      ],
    });
    expect(response.json().entries).toHaveLength(2);
  });

  it('returns a real empty day instead of the nearest day with activity', async () => {
    await session('2026-11-07T09:00:00Z', 100);
    const response = await client.get('/history/day?date=2026-11-06&tz=UTC');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ date: '2026-11-06', earned: 0, drunk: 0, entries: [] });
  });

  it('attributes sets across midnight to the selected day, matching the chart', async () => {
    clock.set('2026-11-07T23:50:00Z');
    const id = (await client.post('/sessions', { workoutId })).json().id;
    await client.post(`/sessions/${id}/sets`, { exerciseId, amount: 100 });
    clock.set('2026-11-08T00:10:00Z');
    await client.post(`/sessions/${id}/sets`, { exerciseId, amount: 200 });
    await client.post(`/sessions/${id}/end`);
    const dashboard = (await client.get('/dashboard?range=7d&tz=UTC')).json();
    for (const [date, earned] of [
      ['2026-11-07', 1],
      ['2026-11-08', 2],
    ] as const) {
      const day = (await client.get(`/history/day?date=${date}&tz=UTC`)).json();
      expect(day.earned).toBe(earned);
      expect(day.earned).toBe(
        dashboard.series.find((point: { date: string }) => point.date === date).earned,
      );
      expect(day.entries).toHaveLength(1);
      expect(day.entries[0]).toMatchObject({
        id,
        type: 'session',
        setCount: 1,
        earnedDrinks: earned,
      });
    }
    // The existing paginated History still summarizes the whole session on its start day.
    const history = (await client.get('/history?tz=UTC')).json();
    expect(history.days[0].entries[0]).toMatchObject({ id, setCount: 2, earnedDrinks: 3 });
  });

  it('includes both repeated DST hours and all 25 hours of the selected local day', async () => {
    for (const [at, note] of [
      ['2026-11-01T06:59:00Z', 'before'],
      ['2026-11-01T07:00:00Z', 'start'],
      ['2026-11-01T08:30:00Z', 'first 1:30'],
      ['2026-11-01T09:30:00Z', 'second 1:30'],
      ['2026-11-02T07:59:00Z', 'end'],
      ['2026-11-02T08:00:00Z', 'after'],
    ]) {
      await client.post('/drinks', { abv: 5, volumeMl: 355, consumedAt: at, note });
    }
    const day = (await client.get('/history/day?date=2026-11-01&tz=America/Los_Angeles')).json();
    expect(day.entries.map((entry: { note: string }) => entry.note)).toEqual([
      'end',
      'second 1:30',
      'first 1:30',
      'start',
    ]);
    expect(day.drunk).toBe(4.0012);
    const utc = (await client.get('/history/day?date=2026-11-01&tz=UTC')).json();
    expect(utc.entries.map((entry: { note: string }) => entry.note)).toContain('before');
    expect(utc.entries.map((entry: { note: string }) => entry.note)).not.toContain('end');
  });

  it('does not expose another user’s drinks, notes, or workouts in a day drill-down', async () => {
    await session('2026-11-07T09:00:00Z', 100);
    const other = await signedInUser(app);
    await other.client.post('/drinks', {
      abv: 5,
      volumeMl: 355,
      consumedAt: '2026-11-07T20:00:00Z',
      note: 'private',
    });
    const workout = (
      await other.client.post('/workouts', {
        name: 'Private workout',
        exercises: [{ name: 'Squats', metric: 'count', earnDrinks: 1, earnPer: 100 }],
      })
    ).json();
    const id = (await other.client.post('/sessions', { workoutId: workout.id })).json().id;
    await other.client.post(`/sessions/${id}/sets`, {
      exerciseId: workout.exercises[0].id,
      amount: 500,
    });
    const day = (await client.get('/history/day?date=2026-11-07&tz=UTC')).json();
    expect(day.earned).toBe(1);
    expect(day.drunk).toBe(0);
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0].workoutName).toBe('Legs');
    expect(
      (await app.inject({ method: 'GET', url: '/history/day?date=2026-11-07' })).statusCode,
    ).toBe(401);
  });

  it('includes a started workout even before any drinks have been earned', async () => {
    clock.set('2026-11-07T09:00:00Z');
    const id = (await client.post('/sessions', { workoutId })).json().id;
    const day = (await client.get('/history/day?date=2026-11-07&tz=UTC')).json();
    expect(day).toMatchObject({
      date: '2026-11-07',
      earned: 0,
      drunk: 0,
      entries: [
        { id, type: 'session', workoutName: 'Legs', setCount: 0, earnedDrinks: 0, endedAt: null },
      ],
    });
    expect(day.entries).toHaveLength(1);
  });

  it('validates actual calendar dates and the time zone', async () => {
    for (const query of [
      '',
      'date=2026-02-30',
      'date=2025-02-29',
      'date=2026-1-1',
      'date=2026-11-07&tz=Nope',
    ]) {
      expect((await client.get(`/history/day?${query}`)).statusCode).toBe(400);
    }
    expect((await client.get('/history/day?date=2024-02-29&tz=UTC')).statusCode).toBe(200);
  });
});
