import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import type { AppConfig } from './config.js';
import { createDb, type Database } from './db/client.js';
import { frameworkErrorHandler, registerErrorHandling } from './lib/errors.js';
import { buildLoggerOptions, type LogDestination } from './lib/logger.js';
import { createGoogleCodeExchanger } from './auth/google.code.js';
import { createGoogleVerifier } from './auth/google.verify.js';
import { registerJwt } from './auth/jwt.js';
import { authGuard } from './auth/guard.js';
import { authRoutes } from './routes/auth.routes.js';
import { containerRoutes } from './routes/containers.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { drinkRoutes } from './routes/drinks.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { historyRoutes } from './routes/history.routes.js';
import { meRoutes } from './routes/me.routes.js';
import { sessionRoutes } from './routes/sessions.routes.js';
import { workoutRoutes } from './routes/workouts.routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Database;
    /** Current time for dashboard "today" and default timestamps; injectable in tests. */
    clock: () => Date;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  /** false disables logging; a destination captures log lines (tests). Defaults to stdout. */
  logger?: boolean | LogDestination;
  /** Defaults to the system clock. */
  clock?: () => Date;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const logger =
    opts.logger === false
      ? false
      : buildLoggerOptions(config, opts.logger === true ? undefined : opts.logger);

  const app = Fastify({
    logger,
    frameworkErrors: frameworkErrorHandler,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const db = createDb(config.DATABASE_URL);
  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('clock', opts.clock ?? (() => new Date()));
  app.addHook('onClose', async () => {
    await db.$client.end({ timeout: 5 });
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Sobi API', version: '1.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
    // Emits schemas registered with .meta({ id }) under components.schemas so $refs resolve.
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await registerJwt(app, config);
  await app.register(authGuard);

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    verifyGoogleIdToken: createGoogleVerifier({
      jwksUrl: config.GOOGLE_JWKS_URL,
      clientId: config.GOOGLE_CLIENT_ID,
    }),
    exchangeGoogleCode: createGoogleCodeExchanger({
      tokenUrl: config.GOOGLE_TOKEN_URL,
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectAllowlist: config.GOOGLE_REDIRECT_ALLOWLIST,
    }),
  });
  await app.register(meRoutes);
  await app.register(workoutRoutes);
  await app.register(sessionRoutes);
  await app.register(containerRoutes);
  await app.register(drinkRoutes);
  await app.register(dashboardRoutes);
  await app.register(historyRoutes);

  return app;
}
