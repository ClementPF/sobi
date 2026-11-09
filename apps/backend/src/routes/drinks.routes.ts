import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { containers, drinks } from '../db/schema.js';
import { convertDrink } from '../domain/conversions.js';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { cursorQuerySchema, decodeCursor, encodeCursor } from '../lib/pagination.js';
import { drinkDtoSchema, idParamsSchema, noteInputSchema, toDrinkDto } from '../lib/serializers.js';
import { findOwnedContainer } from '../services/container.service.js';

const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema };

const drinkInputSchema = z
  .object({
    abv: z.number().min(0).max(100).describe('Alcohol by volume, percent'),
    volumeMl: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Defaults to the container's volume"),
    containerId: z.uuid().optional(),
    consumedAt: z.iso.datetime({ offset: true }).optional().describe('Defaults to now'),
    note: noteInputSchema.optional(),
  })
  .meta({ id: 'NewDrink' });

export const drinkRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['drinks'], security: [{ bearerAuth: [] }] };

  app.post(
    '/drinks',
    {
      schema: {
        ...common,
        summary: 'Log a drink',
        description:
          'alcoholG = volumeMl × abv / 100 × 0.789 and stdDrinks = alcoholG / 14, computed now and stored.',
        body: drinkInputSchema,
        response: { 201: drinkDtoSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { abv, containerId, consumedAt, note } = request.body;
      const container = containerId
        ? await findOwnedContainer(app.db, request.user.id, containerId)
        : null;
      const volumeMl = request.body.volumeMl ?? container?.volumeMl;
      if (volumeMl === undefined) {
        throw ApiError.badRequest('Give a volume or a container', 'VOLUME_REQUIRED');
      }
      const [row] = await app.db
        .insert(drinks)
        .values({
          userId: request.user.id,
          abv,
          volumeMl,
          containerId: container?.id ?? null,
          consumedAt: consumedAt ? new Date(consumedAt) : app.clock(),
          note: note ?? null,
          ...convertDrink(volumeMl, abv),
        })
        .returning();
      return reply.code(201).send(toDrinkDto(row!, container?.name ?? null));
    },
  );

  app.get(
    '/drinks',
    {
      schema: {
        ...common,
        summary: 'Your drinks, newest first',
        querystring: cursorQuerySchema,
        response: {
          200: z.object({ items: z.array(drinkDtoSchema), nextCursor: z.string().nullable() }),
          ...errors,
        },
      },
    },
    async (request) => {
      const cursor = decodeCursor(request.query.cursor);
      const { limit } = request.query;
      const rows = await app.db
        .select({ drink: drinks, containerName: containers.name })
        .from(drinks)
        .leftJoin(containers, eq(containers.id, drinks.containerId))
        .where(
          and(
            eq(drinks.userId, request.user.id),
            cursor
              ? sql`(${drinks.consumedAt}, ${drinks.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(drinks.consumedAt), desc(drinks.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => toDrinkDto(r.drink, r.containerName)),
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ at: last.drink.consumedAt, id: last.drink.id })
            : null,
      };
    },
  );

  app.patch(
    '/drinks/:id',
    {
      schema: {
        ...common,
        summary: "Edit a drink's note",
        params: idParamsSchema,
        body: z.object({ note: noteInputSchema }),
        response: { 200: drinkDtoSchema, ...errors },
      },
    },
    async (request) => {
      const [row] = await app.db
        .update(drinks)
        .set({ note: request.body.note })
        .where(and(eq(drinks.id, request.params.id), eq(drinks.userId, request.user.id)))
        .returning();
      if (!row) throw ApiError.notFound('Drink not found', 'DRINK_NOT_FOUND');
      const container = row.containerId
        ? await app.db
            .select({ name: containers.name })
            .from(containers)
            .where(eq(containers.id, row.containerId))
        : [];
      return toDrinkDto(row, container[0]?.name ?? null);
    },
  );

  app.delete(
    '/drinks/:id',
    {
      schema: {
        ...common,
        summary: 'Delete a drink',
        params: idParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const deleted = await app.db
        .delete(drinks)
        .where(and(eq(drinks.id, request.params.id), eq(drinks.userId, request.user.id)))
        .returning({ id: drinks.id });
      if (deleted.length === 0) throw ApiError.notFound('Drink not found', 'DRINK_NOT_FOUND');
      return reply.code(204).send(null);
    },
  );
};
