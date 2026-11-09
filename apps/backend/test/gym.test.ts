import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, signedInUser, testClock, truncateAll, type TestClient } from './helpers.js';

const clock = testClock('2026-11-08T10:00:00Z');

async function createWorkout(client: TestClient) {
  const res = await client.post('/workouts', {
    name: 'Push day',
    exercises: [
      { name: 'Push-ups', metric: 'count', earnDrinks: 1, earnPer: 100 },
      { name: 'Plank', metric: 'seconds', earnDrinks: 0.5, earnPer: 60 },
      { name: 'Run', metric: 'meters', earnDrinks: 1, earnPer: 1000 },
    ],
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('workouts and sessions', () => {
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
    clock.set('2026-11-08T10:00:00Z');
    ({ client } = await signedInUser(app));
  });

  it('creates, lists, renames and archives workouts', async () => {
    const workout = await createWorkout(client);
    expect(workout.exercises.map((e: { name: string }) => e.name)).toEqual([
      'Push-ups',
      'Plank',
      'Run',
    ]);
    expect((await client.get('/workouts')).json()).toHaveLength(1);

    const renamed = await client.patch(`/workouts/${workout.id}`, { name: 'Pull day' });
    expect(renamed.json().name).toBe('Pull day');

    const added = await client.post(`/workouts/${workout.id}/exercises`, {
      name: 'Squats',
      metric: 'count',
      earnDrinks: 1,
      earnPer: 50,
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().sortOrder).toBe(3);

    const removed = await client.delete(`/workouts/${workout.id}/exercises/${added.json().id}`);
    expect(removed.statusCode).toBe(204);
    expect((await client.get(`/workouts/${workout.id}/exercises`)).json()).toHaveLength(3);

    expect((await client.delete(`/workouts/${workout.id}`)).statusCode).toBe(204);
    expect((await client.get('/workouts')).json()).toEqual([]);
    expect((await client.get(`/workouts/${workout.id}`)).statusCode).toBe(404);
  });

  it('validates exercise rates', async () => {
    const res = await client.post('/workouts', {
      name: 'Bad',
      exercises: [{ name: 'x', metric: 'count', earnDrinks: 1, earnPer: 0 }],
    });
    expect(res.statusCode).toBe(400);
    const metric = await client.post('/workouts', {
      name: 'Bad',
      exercises: [{ name: 'x', metric: 'kg', earnDrinks: 1, earnPer: 1 }],
    });
    expect(metric.statusCode).toBe(400);
  });

  it('runs a session: start, log sets with server-computed earnings, end', async () => {
    const workout = await createWorkout(client);
    const [pushUps, plank, run] = workout.exercises;

    expect((await client.get('/sessions/active')).json()).toBeNull();
    const started = await client.post('/sessions', { workoutId: workout.id });
    expect(started.statusCode).toBe(201);
    const session = started.json();
    expect(session).toMatchObject({
      workout: { id: workout.id, name: 'Push day' },
      startedAt: '2026-11-08T10:00:00.000Z',
      endedAt: null,
      setCount: 0,
      earnedDrinks: 0,
    });

    const conflict = await client.post('/sessions', { workoutId: workout.id });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('ACTIVE_SESSION_EXISTS');

    const set = await client.post(`/sessions/${session.id}/sets`, {
      exerciseId: pushUps.id,
      amount: 50,
      earnedDrinks: 99,
    });
    expect(set.statusCode).toBe(201);
    expect(set.json()).toMatchObject({ amount: 50, earnedDrinks: 0.5 });
    await client.post(`/sessions/${session.id}/sets`, { exerciseId: plank.id, amount: 90 });
    await client.post(`/sessions/${session.id}/sets`, { exerciseId: run.id, amount: 5000 });

    const active = (await client.get('/sessions/active')).json();
    expect(active.id).toBe(session.id);
    expect(active.setCount).toBe(3);
    expect(active.earnedDrinks).toBe(6.25);
    expect(active.exercises[1].sets.map((s: { amount: number }) => s.amount)).toEqual([90]);

    const removed = await client.delete(`/sets/${set.json().id}`);
    expect(removed.statusCode).toBe(204);
    expect((await client.get(`/sessions/${session.id}`)).json().earnedDrinks).toBe(5.75);

    clock.set('2026-11-08T11:00:00Z');
    const ended = await client.post(`/sessions/${session.id}/end`);
    expect(ended.json().endedAt).toBe('2026-11-08T11:00:00.000Z');
    expect((await client.get('/sessions/active')).json()).toBeNull();

    const late = await client.post(`/sessions/${session.id}/sets`, {
      exerciseId: pushUps.id,
      amount: 10,
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('SESSION_ENDED');

    const list = (await client.get('/sessions')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ setCount: 2, earnedDrinks: 5.75 });
  });

  it('rejects a set for an exercise of another workout', async () => {
    const a = await createWorkout(client);
    const b = await createWorkout(client);
    const session = (await client.post('/sessions', { workoutId: a.id })).json();
    const res = await client.post(`/sessions/${session.id}/sets`, {
      exerciseId: b.exercises[0].id,
      amount: 10,
    });
    expect(res.statusCode).toBe(404);
  });

  it('keeps past sets when the rate changes', async () => {
    const workout = await createWorkout(client);
    const pushUps = workout.exercises[0];
    const session = (await client.post('/sessions', { workoutId: workout.id })).json();
    await client.post(`/sessions/${session.id}/sets`, { exerciseId: pushUps.id, amount: 100 });

    const patched = await client.patch(`/workouts/${workout.id}/exercises/${pushUps.id}`, {
      earnDrinks: 2,
      earnPer: 50,
    });
    expect(patched.json()).toMatchObject({ earnDrinks: 2, earnPer: 50 });
    clock.set('2026-11-08T10:05:00Z');
    await client.post(`/sessions/${session.id}/sets`, { exerciseId: pushUps.id, amount: 100 });

    const detail = (await client.get(`/sessions/${session.id}`)).json();
    expect(detail.exercises[0].sets.map((s: { earnedDrinks: number }) => s.earnedDrinks)).toEqual([
      1, 4,
    ]);
    expect(detail.earnedDrinks).toBe(5);
  });

  it('keeps archived exercises that have sets in the session detail', async () => {
    const workout = await createWorkout(client);
    const pushUps = workout.exercises[0];
    const session = (await client.post('/sessions', { workoutId: workout.id })).json();
    await client.post(`/sessions/${session.id}/sets`, { exerciseId: pushUps.id, amount: 20 });
    await client.delete(`/workouts/${workout.id}/exercises/${pushUps.id}`);
    const detail = (await client.get(`/sessions/${session.id}`)).json();
    expect(detail.exercises.find((e: { id: string }) => e.id === pushUps.id)).toMatchObject({
      archived: true,
      sets: [expect.objectContaining({ amount: 20 })],
    });
  });

  it('paginates sessions with a cursor', async () => {
    const workout = await createWorkout(client);
    for (let i = 0; i < 3; i++) {
      clock.set(`2026-11-0${i + 1}T10:00:00Z`);
      const s = (await client.post('/sessions', { workoutId: workout.id })).json();
      await client.post(`/sessions/${s.id}/end`);
    }
    const first = (await client.get('/sessions?limit=2')).json();
    expect(first.items.map((s: { startedAt: string }) => s.startedAt.slice(0, 10))).toEqual([
      '2026-11-03',
      '2026-11-02',
    ]);
    const second = (await client.get(`/sessions?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect((await client.get('/sessions?cursor=garbage')).statusCode).toBe(400);
  });

  it('deletes a session with its sets', async () => {
    const workout = await createWorkout(client);
    const session = (await client.post('/sessions', { workoutId: workout.id })).json();
    await client.post(`/sessions/${session.id}/sets`, {
      exerciseId: workout.exercises[0].id,
      amount: 10,
    });
    expect((await client.delete(`/sessions/${session.id}`)).statusCode).toBe(204);
    expect((await client.get(`/sessions/${session.id}`)).statusCode).toBe(404);
  });

  it('cannot start an archived workout', async () => {
    const workout = await createWorkout(client);
    await client.delete(`/workouts/${workout.id}`);
    expect((await client.post('/sessions', { workoutId: workout.id })).statusCode).toBe(404);
  });
});
