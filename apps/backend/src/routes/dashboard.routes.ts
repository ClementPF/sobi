import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { buildDashboard, DASHBOARD_RANGES } from '../domain/dashboard.js';
import { errorResponseSchema } from '../lib/errors.js';
import { localDate, timeZoneSchema } from '../lib/time.js';
import { loadDailyTotals, userCreatedAt } from '../services/dashboard.service.js';

const point = z.object({
  date: z.string(),
  earned: z.number(),
  drunk: z.number(),
  balance: z.number().describe('Running balance at the end of the day'),
});

const dashboardSchema = z
  .object({
    range: z.enum(DASHBOARD_RANGES),
    from: z.string().describe('First local date of the range'),
    to: z.string().describe('Today, local date'),
    balance: z.number().describe('All-time earned minus drunk; negative is debt'),
    totalEarned: z.number(),
    totalDrunk: z.number(),
    rangeEarned: z.number(),
    rangeDrunk: z.number(),
    series: z.array(point),
    weekly: z.array(z.object({ weekStart: z.string(), earned: z.number(), drunk: z.number() })),
    stats: z.object({
      avgDrunkPerWeek: z.number(),
      avgEarnedPerWeek: z.number(),
      sessionsPerWeek: z.number(),
      dryStreakDays: z.number().int(),
      maxDryStreakDays: z.number().int().describe('Longest run of days without a drink, all time'),
      topDrinkingWeekday: z.number().int().min(1).max(7).nullable(),
    }),
  })
  .meta({ id: 'Dashboard' });

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/dashboard',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['dashboard'],
        summary: 'Balance of standard drinks, history series and stats',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          range: z.enum(DASHBOARD_RANGES).default('30d'),
          tz: timeZoneSchema,
        }),
        response: { 200: dashboardSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const { range, tz } = request.query;
      const [days, createdAt] = await Promise.all([
        loadDailyTotals(app.db, request.user.id, tz),
        userCreatedAt(app.db, request.user.id),
      ]);
      return buildDashboard({
        range,
        today: localDate(app.clock(), tz),
        signupDate: localDate(createdAt, tz),
        days,
      });
    },
  );
};
