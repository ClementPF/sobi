import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { exercises, sessions, setEntries } from '../db/schema.js';
import { earnedDrinks } from '../domain/conversions.js';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { cursorQuerySchema, decodeCursor, encodeCursor } from '../lib/pagination.js';
import {
  idParamsSchema,
  sessionDetailSchema,
  sessionSummarySchema,
  setDtoSchema,
} from '../lib/serializers.js';
import {
  findOwnedSession,
  listSessions,
  sessionDetail,
  startSession,
  toSetDto,
} from '../services/gym-session.service.js';
import { findOwnedWorkout } from '../services/workout.service.js';

const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema };

export const sessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['sessions'], security: [{ bearerAuth: [] }] };

  app.post(
    '/sessions',
    {
      schema: {
        ...common,
        summary: 'Start a gym session for a workout',
        body: z.object({ workoutId: z.uuid() }),
        response: { 201: sessionDetailSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const workout = await findOwnedWorkout(app.db, request.user.id, request.body.workoutId);
      const session = await startSession(app.db, request.user.id, workout.id, app.clock());
      return reply.code(201).send(await sessionDetail(app.db, { session, workout }));
    },
  );

  app.get(
    '/sessions/active',
    {
      schema: {
        ...common,
        summary: 'The session in progress, or null',
        response: { 200: sessionDetailSchema.nullable(), 401: errorResponseSchema },
      },
    },
    async (request) => {
      const [active] = await app.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.userId, request.user.id), isNull(sessions.endedAt)));
      if (!active) return null;
      return sessionDetail(app.db, await findOwnedSession(app.db, request.user.id, active.id));
    },
  );

  app.get(
    '/sessions',
    {
      schema: {
        ...common,
        summary: 'Your sessions, newest first',
        querystring: cursorQuerySchema,
        response: {
          200: z.object({
            items: z.array(sessionSummarySchema),
            nextCursor: z.string().nullable(),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const { items, next } = await listSessions(
        app.db,
        request.user.id,
        decodeCursor(request.query.cursor),
        request.query.limit,
      );
      return { items, nextCursor: next ? encodeCursor(next) : null };
    },
  );

  app.get(
    '/sessions/:id',
    {
      schema: {
        ...common,
        summary: 'One session with its exercises and sets',
        params: idParamsSchema,
        response: { 200: sessionDetailSchema, ...errors },
      },
    },
    async (request) =>
      sessionDetail(app.db, await findOwnedSession(app.db, request.user.id, request.params.id)),
  );

  app.post(
    '/sessions/:id/end',
    {
      schema: {
        ...common,
        summary: 'End a session (idempotent)',
        params: idParamsSchema,
        response: { 200: sessionDetailSchema, ...errors },
      },
    },
    async (request) => {
      const row = await findOwnedSession(app.db, request.user.id, request.params.id);
      if (row.session.endedAt === null) {
        const [ended] = await app.db
          .update(sessions)
          .set({ endedAt: app.clock() })
          .where(eq(sessions.id, row.session.id))
          .returning();
        row.session = ended!;
      }
      return sessionDetail(app.db, row);
    },
  );

  app.delete(
    '/sessions/:id',
    {
      schema: {
        ...common,
        summary: 'Delete a session and its sets',
        params: idParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const row = await findOwnedSession(app.db, request.user.id, request.params.id);
      await app.db.delete(sessions).where(eq(sessions.id, row.session.id));
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/sessions/:id/sets',
    {
      schema: {
        ...common,
        summary: 'Log a set',
        description:
          'earnedDrinks = amount / earnPer × earnDrinks, using the exercise rate at log time.',
        params: idParamsSchema,
        body: z.object({
          exerciseId: z.uuid(),
          amount: z.number().int().min(1).max(1_000_000),
        }),
        response: { 201: setDtoSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { session, workout } = await findOwnedSession(
        app.db,
        request.user.id,
        request.params.id,
      );
      if (session.endedAt !== null) {
        throw ApiError.conflict('This session has ended', 'SESSION_ENDED');
      }
      const [exercise] = await app.db
        .select()
        .from(exercises)
        .where(
          and(
            eq(exercises.id, request.body.exerciseId),
            eq(exercises.workoutId, workout.id),
            isNull(exercises.archivedAt),
          ),
        );
      if (!exercise) throw ApiError.notFound('Exercise not found', 'EXERCISE_NOT_FOUND');
      const [row] = await app.db
        .insert(setEntries)
        .values({
          sessionId: session.id,
          exerciseId: exercise.id,
          amount: request.body.amount,
          earnedDrinks: earnedDrinks(request.body.amount, exercise.earnDrinks, exercise.earnPer),
          createdAt: app.clock(),
        })
        .returning();
      return reply.code(201).send(toSetDto(row!));
    },
  );

  app.delete(
    '/sets/:id',
    {
      schema: {
        ...common,
        summary: 'Delete a set',
        params: idParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const [owned] = await app.db
        .select({ id: setEntries.id })
        .from(setEntries)
        .innerJoin(sessions, eq(sessions.id, setEntries.sessionId))
        .where(and(eq(setEntries.id, request.params.id), eq(sessions.userId, request.user.id)));
      if (!owned) throw ApiError.notFound('Set not found', 'SET_NOT_FOUND');
      await app.db.delete(setEntries).where(eq(setEntries.id, owned.id));
      return reply.code(204).send(null);
    },
  );
};
