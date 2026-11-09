import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, signedInUser, truncateAll, type TestClient } from './helpers.js';

describe('per-user data isolation', () => {
  let app: FastifyInstance;
  let owner: TestClient;
  let other: TestClient;
  let ids: {
    workout: string;
    exercise: string;
    session: string;
    set: string;
    container: string;
    drink: string;
  };

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    ({ client: owner } = await signedInUser(app));
    ({ client: other } = await signedInUser(app));
    const workout = (
      await owner.post('/workouts', {
        name: 'Mine',
        exercises: [{ name: 'Squats', metric: 'count', earnDrinks: 1, earnPer: 50 }],
      })
    ).json();
    const session = (await owner.post('/sessions', { workoutId: workout.id })).json();
    const set = (
      await owner.post(`/sessions/${session.id}/sets`, {
        exerciseId: workout.exercises[0].id,
        amount: 50,
      })
    ).json();
    const container = (await owner.post('/containers', { name: 'Mug', volumeMl: 400 })).json();
    const drink = (await owner.post('/drinks', { abv: 5, volumeMl: 330 })).json();
    ids = {
      workout: workout.id,
      exercise: workout.exercises[0].id,
      session: session.id,
      set: set.id,
      container: container.id,
      drink: drink.id,
    };
  });

  it('returns 404 for every resource owned by someone else', async () => {
    const { workout, exercise, session, set, container, drink } = ids;
    const attempts = [
      other.get(`/workouts/${workout}`),
      other.patch(`/workouts/${workout}`, { name: 'Stolen' }),
      other.delete(`/workouts/${workout}`),
      other.get(`/workouts/${workout}/exercises`),
      other.post(`/workouts/${workout}/exercises`, {
        name: 'x',
        metric: 'count',
        earnDrinks: 1,
        earnPer: 1,
      }),
      other.patch(`/workouts/${workout}/exercises/${exercise}`, { earnDrinks: 50 }),
      other.delete(`/workouts/${workout}/exercises/${exercise}`),
      other.post('/sessions', { workoutId: workout }),
      other.get(`/sessions/${session}`),
      other.post(`/sessions/${session}/end`),
      other.post(`/sessions/${session}/sets`, { exerciseId: exercise, amount: 1000 }),
      other.delete(`/sessions/${session}`),
      other.delete(`/sets/${set}`),
      other.patch(`/containers/${container}`, { volumeMl: 1 }),
      other.delete(`/containers/${container}`),
      other.post('/drinks', { abv: 5, containerId: container }),
      other.delete(`/drinks/${drink}`),
    ];
    const results = await Promise.all(attempts);
    expect(results.map((r) => r.statusCode)).toEqual(results.map(() => 404));

    const detail = (await owner.get(`/sessions/${session}`)).json();
    expect(detail).toMatchObject({ endedAt: null, setCount: 1, earnedDrinks: 1 });
    expect((await owner.get(`/workouts/${workout}`)).json().name).toBe('Mine');
    expect((await owner.get('/drinks')).json().items).toHaveLength(1);
  });

  it("never lists or aggregates someone else's data", async () => {
    expect((await other.get('/workouts')).json()).toEqual([]);
    expect((await other.get('/sessions')).json().items).toEqual([]);
    expect((await other.get('/sessions/active')).json()).toBeNull();
    expect((await other.get('/containers')).json()).toEqual([]);
    expect((await other.get('/drinks')).json().items).toEqual([]);
    expect((await other.get('/history')).json().days).toEqual([]);
    const dashboard = (await other.get('/dashboard')).json();
    expect(dashboard).toMatchObject({ balance: 0, totalEarned: 0, totalDrunk: 0 });
  });
});
