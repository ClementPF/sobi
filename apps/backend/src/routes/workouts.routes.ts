import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { exercises, workouts } from '../db/schema.js';
import { errorResponseSchema } from '../lib/errors.js';
import {
  exerciseDtoSchema,
  idParamsSchema,
  metricSchema,
  toExerciseDto,
  workoutDtoSchema,
} from '../lib/serializers.js';
import {
  activeExercises,
  addExercise,
  createWorkout,
  findOwnedWorkout,
  findWorkoutExercise,
  listWorkouts,
  workoutDto,
} from '../services/workout.service.js';

const nameSchema = z.string().trim().min(1).max(100);

const exerciseFields = {
  name: nameSchema,
  metric: metricSchema,
  earnDrinks: z.number().min(0).max(100).describe('Standard drinks earned per earnPer units'),
  earnPer: z.number().int().min(1).max(1_000_000).describe('Units (reps, seconds, meters)'),
};

const exerciseInputSchema = z.object(exerciseFields).meta({ id: 'NewExercise' });

const exercisePatchSchema = z
  .object(exerciseFields)
  .partial()
  .extend({ sortOrder: z.number().int().min(0).max(10_000).optional() })
  .meta({ id: 'ExercisePatch' });

const exerciseParamsSchema = z.object({ id: z.uuid(), exerciseId: z.uuid() });

const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema };

export const workoutRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['workouts'], security: [{ bearerAuth: [] }] };

  app.get(
    '/workouts',
    {
      schema: {
        ...common,
        summary: 'Your workouts with their exercises',
        response: { 200: z.array(workoutDtoSchema), 401: errorResponseSchema },
      },
    },
    async (request) => listWorkouts(app.db, request.user.id),
  );

  app.post(
    '/workouts',
    {
      schema: {
        ...common,
        summary: 'Create a workout, optionally with its exercises',
        body: z.object({
          name: nameSchema,
          exercises: z.array(exerciseInputSchema).max(50).default([]),
        }),
        response: { 201: workoutDtoSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await createWorkout(app.db, request.user.id, request.body)),
  );

  app.get(
    '/workouts/:id',
    {
      schema: {
        ...common,
        summary: 'One workout',
        params: idParamsSchema,
        response: { 200: workoutDtoSchema, ...errors },
      },
    },
    async (request) =>
      workoutDto(app.db, await findOwnedWorkout(app.db, request.user.id, request.params.id)),
  );

  app.patch(
    '/workouts/:id',
    {
      schema: {
        ...common,
        summary: 'Rename a workout',
        params: idParamsSchema,
        body: z.object({ name: nameSchema }),
        response: { 200: workoutDtoSchema, ...errors },
      },
    },
    async (request) => {
      const workout = await findOwnedWorkout(app.db, request.user.id, request.params.id);
      const [updated] = await app.db
        .update(workouts)
        .set({ name: request.body.name })
        .where(eq(workouts.id, workout.id))
        .returning();
      return workoutDto(app.db, updated!);
    },
  );

  app.delete(
    '/workouts/:id',
    {
      schema: {
        ...common,
        summary: 'Delete a workout',
        description: 'Archives the workout: past sessions keep it, it can no longer be started.',
        params: idParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const workout = await findOwnedWorkout(app.db, request.user.id, request.params.id);
      await app.db
        .update(workouts)
        .set({ archivedAt: app.clock() })
        .where(eq(workouts.id, workout.id));
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/workouts/:id/exercises',
    {
      schema: {
        ...common,
        summary: "A workout's active exercises",
        params: idParamsSchema,
        response: { 200: z.array(exerciseDtoSchema), ...errors },
      },
    },
    async (request) => {
      const workout = await findOwnedWorkout(app.db, request.user.id, request.params.id);
      return (await activeExercises(app.db, [workout.id])).map(toExerciseDto);
    },
  );

  app.post(
    '/workouts/:id/exercises',
    {
      schema: {
        ...common,
        summary: 'Add an exercise to a workout',
        params: idParamsSchema,
        body: exerciseInputSchema,
        response: { 201: exerciseDtoSchema, ...errors },
      },
    },
    async (request, reply) => {
      const workout = await findOwnedWorkout(app.db, request.user.id, request.params.id);
      return reply
        .code(201)
        .send(toExerciseDto(await addExercise(app.db, workout.id, request.body)));
    },
  );

  app.patch(
    '/workouts/:id/exercises/:exerciseId',
    {
      schema: {
        ...common,
        summary: 'Update an exercise',
        description: 'Rate changes apply to sets logged afterwards; past sets keep their value.',
        params: exerciseParamsSchema,
        body: exercisePatchSchema,
        response: { 200: exerciseDtoSchema, ...errors },
      },
    },
    async (request) => {
      const workout = await findOwnedWorkout(app.db, request.user.id, request.params.id);
      const exercise = await findWorkoutExercise(app.db, workout.id, request.params.exerciseId);
      const patch = Object.fromEntries(
        Object.entries(request.body).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(patch).length === 0) return toExerciseDto(exercise);
      const [updated] = await app.db
        .update(exercises)
        .set(patch)
        .where(and(eq(exercises.id, exercise.id)))
        .returning();
      return toExerciseDto(updated!);
    },
  );

  app.delete(
    '/workouts/:id/exercises/:exerciseId',
    {
      schema: {
        ...common,
        summary: 'Remove an exercise',
        description: 'Archives the exercise; sets already logged for it are kept.',
        params: exerciseParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const workout = await findOwnedWorkout(app.db, request.user.id, request.params.id);
      const exercise = await findWorkoutExercise(app.db, workout.id, request.params.exerciseId);
      await app.db
        .update(exercises)
        .set({ archivedAt: app.clock() })
        .where(eq(exercises.id, exercise.id));
      return reply.code(204).send(null);
    },
  );
};
