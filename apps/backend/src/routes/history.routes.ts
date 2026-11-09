import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { containers, drinks, sessions, workouts } from '../db/schema.js';
import { roundTo } from '../domain/conversions.js';
import { errorResponseSchema } from '../lib/errors.js';
import { timeZoneSchema } from '../lib/time.js';
import { localDay } from '../services/dashboard.service.js';
import { sessionTotals } from '../services/gym-session.service.js';

const sessionEntry = z.object({
  type: z.literal('session'),
  id: z.uuid(),
  at: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  workoutName: z.string(),
  setCount: z.number().int(),
  earnedDrinks: z.number(),
  note: z.string().nullable(),
});

const drinkEntry = z.object({
  type: z.literal('drink'),
  id: z.uuid(),
  at: z.iso.datetime(),
  abv: z.number(),
  volumeMl: z.number().int(),
  containerName: z.string().nullable(),
  alcoholG: z.number(),
  stdDrinks: z.number(),
  note: z.string().nullable(),
});

const historySchema = z
  .object({
    days: z.array(
      z.object({
        date: z.string(),
        earned: z.number(),
        drunk: z.number(),
        entries: z.array(z.discriminatedUnion('type', [sessionEntry, drinkEntry])),
      }),
    ),
    nextCursor: z.string().nullable().describe('Local date; pass it back to load older days'),
  })
  .meta({ id: 'History' });

type Entry = z.infer<typeof sessionEntry> | z.infer<typeof drinkEntry>;

export const historyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/history',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['history'],
        summary: 'Sessions and drinks merged and grouped by local day, newest first',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          cursor: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          limit: z.coerce.number().int().min(1).max(60).default(14).describe('Days per page'),
          tz: timeZoneSchema,
        }),
        response: { 200: historySchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const userId = request.user.id;
      const { cursor, limit, tz } = request.query;
      const sessionDay = localDay(sessions.startedAt, tz);
      const drinkDay = localDay(drinks.consumedAt, tz);

      const dayRows = await app.db.execute<{ day: string }>(sql`
        select day from (
          select ${sessionDay} as day from ${sessions} where ${sessions.userId} = ${userId}
          union
          select ${drinkDay} as day from ${drinks} where ${drinks.userId} = ${userId}
        ) d
        ${cursor ? sql`where day < ${cursor}` : sql``}
        order by day desc
        limit ${limit + 1}
      `);
      const allDays = dayRows.map((r) => r.day);
      const days = allDays.slice(0, limit);
      if (days.length === 0) return { days: [], nextCursor: null };

      const [sessionRows, drinkRows] = await Promise.all([
        app.db
          .select({ session: sessions, workoutName: workouts.name, day: sessionDay })
          .from(sessions)
          .innerJoin(workouts, eq(workouts.id, sessions.workoutId))
          .where(and(eq(sessions.userId, userId), inArray(sessionDay, days)))
          .orderBy(desc(sessions.startedAt)),
        app.db
          .select({ drink: drinks, containerName: containers.name, day: drinkDay })
          .from(drinks)
          .leftJoin(containers, eq(containers.id, drinks.containerId))
          .where(and(eq(drinks.userId, userId), inArray(drinkDay, days)))
          .orderBy(desc(drinks.consumedAt)),
      ]);
      const totals = await sessionTotals(
        app.db,
        sessionRows.map((r) => r.session.id),
      );

      const grouped = new Map(
        days.map((date) => [date, { date, earned: 0, drunk: 0, entries: [] as Entry[] }]),
      );
      for (const r of sessionRows) {
        const day = grouped.get(r.day);
        if (!day) continue;
        const t = totals.get(r.session.id) ?? { setCount: 0, earnedDrinks: 0 };
        day.earned += t.earnedDrinks;
        day.entries.push({
          type: 'session',
          id: r.session.id,
          at: r.session.startedAt.toISOString(),
          endedAt: r.session.endedAt?.toISOString() ?? null,
          workoutName: r.workoutName,
          note: r.session.note,
          ...t,
        });
      }
      for (const r of drinkRows) {
        const day = grouped.get(r.day);
        if (!day) continue;
        day.drunk += r.drink.stdDrinks;
        day.entries.push({
          type: 'drink',
          id: r.drink.id,
          at: r.drink.consumedAt.toISOString(),
          abv: r.drink.abv,
          volumeMl: r.drink.volumeMl,
          containerName: r.containerName,
          alcoholG: r.drink.alcoholG,
          stdDrinks: r.drink.stdDrinks,
          note: r.drink.note,
        });
      }

      return {
        days: [...grouped.values()].map((d) => ({
          ...d,
          earned: roundTo(d.earned, 4),
          drunk: roundTo(d.drunk, 4),
          entries: d.entries.sort((a, b) => b.at.localeCompare(a.at)),
        })),
        nextCursor: allDays.length > limit ? (days[days.length - 1] ?? null) : null,
      };
    },
  );

  app.post(
    '/history/delete',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['history'],
        summary: 'Delete several sessions and drinks at once',
        description: 'Ids that are not yours or no longer exist are ignored.',
        security: [{ bearerAuth: [] }],
        body: z.object({
          sessionIds: z.array(z.uuid()).max(500).default([]),
          drinkIds: z.array(z.uuid()).max(500).default([]),
        }),
        response: {
          200: z.object({ sessions: z.number().int(), drinks: z.number().int() }),
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.user.id;
      const { sessionIds, drinkIds } = request.body;
      return app.db.transaction(async (tx) => {
        const deletedSessions = sessionIds.length
          ? await tx
              .delete(sessions)
              .where(and(eq(sessions.userId, userId), inArray(sessions.id, sessionIds)))
              .returning({ id: sessions.id })
          : [];
        const deletedDrinks = drinkIds.length
          ? await tx
              .delete(drinks)
              .where(and(eq(drinks.userId, userId), inArray(drinks.id, drinkIds)))
              .returning({ id: drinks.id })
          : [];
        return { sessions: deletedSessions.length, drinks: deletedDrinks.length };
      });
    },
  );
};
