import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { users } from '../db/schema.js';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { toUserDto, unitsSchema, userDtoSchema } from '../lib/serializers.js';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const common = { tags: ['users'], security: [{ bearerAuth: [] }] };

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        ...common,
        summary: 'The signed-in user',
        response: { 200: userDtoSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const [user] = await app.db.select().from(users).where(eq(users.id, request.user.id));
      if (!user) throw ApiError.unauthorized('User no longer exists', 'USER_NOT_FOUND');
      return toUserDto(user);
    },
  );

  app.patch(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        ...common,
        summary: 'Update your preferences',
        body: z.object({ units: unitsSchema }),
        response: { 200: userDtoSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const [user] = await app.db
        .update(users)
        .set({ units: request.body.units, updatedAt: app.clock() })
        .where(eq(users.id, request.user.id))
        .returning();
      if (!user) throw ApiError.unauthorized('User no longer exists', 'USER_NOT_FOUND');
      return toUserDto(user);
    },
  );
};
