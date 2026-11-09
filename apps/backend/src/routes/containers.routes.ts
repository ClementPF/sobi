import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { containers } from '../db/schema.js';
import { errorResponseSchema } from '../lib/errors.js';
import { containerDtoSchema, idParamsSchema, toContainerDto } from '../lib/serializers.js';
import { findOwnedContainer, listContainers } from '../services/container.service.js';

const containerInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  volumeMl: z.number().int().min(1).max(10_000),
});

const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema };

export const containerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['containers'], security: [{ bearerAuth: [] }] };

  app.get(
    '/containers',
    {
      schema: {
        ...common,
        summary: 'Your saved containers, smallest first',
        response: { 200: z.array(containerDtoSchema), 401: errorResponseSchema },
      },
    },
    async (request) => (await listContainers(app.db, request.user.id)).map(toContainerDto),
  );

  app.post(
    '/containers',
    {
      schema: {
        ...common,
        summary: 'Save a container',
        body: containerInputSchema,
        response: { 201: containerDtoSchema, ...errors },
      },
    },
    async (request, reply) => {
      const [row] = await app.db
        .insert(containers)
        .values({ ...request.body, userId: request.user.id })
        .returning();
      return reply.code(201).send(toContainerDto(row!));
    },
  );

  app.patch(
    '/containers/:id',
    {
      schema: {
        ...common,
        summary: 'Rename or resize a container',
        description: 'Drinks already logged keep their volume.',
        params: idParamsSchema,
        body: containerInputSchema.partial(),
        response: { 200: containerDtoSchema, ...errors },
      },
    },
    async (request) => {
      const container = await findOwnedContainer(app.db, request.user.id, request.params.id);
      const patch = Object.fromEntries(
        Object.entries(request.body).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(patch).length === 0) return toContainerDto(container);
      const [row] = await app.db
        .update(containers)
        .set(patch)
        .where(eq(containers.id, container.id))
        .returning();
      return toContainerDto(row!);
    },
  );

  app.delete(
    '/containers/:id',
    {
      schema: {
        ...common,
        summary: 'Delete a container',
        params: idParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const container = await findOwnedContainer(app.db, request.user.id, request.params.id);
      await app.db.delete(containers).where(eq(containers.id, container.id));
      return reply.code(204).send(null);
    },
  );
};
