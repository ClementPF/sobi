import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const unitSystem = pgEnum('unit_system', ['metric', 'imperial']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email'),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  pictureUrl: text('picture_url'),
  units: unitSystem('units').notNull().default('metric'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    jti: text('jti').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('refresh_tokens_family_idx').on(t.familyId),
    unique('refresh_tokens_jti_unique').on(t.jti),
  ],
);

export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Workouts with history are archived instead of deleted so past sessions keep their name.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('workouts_user_idx').on(t.userId)],
);

export const exerciseMetric = pgEnum('exercise_metric', ['count', 'seconds', 'meters']);

export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    metric: exerciseMetric('metric').notNull(),
    /** Standard drinks earned per `earnPer` units of the metric. */
    earnDrinks: numeric('earn_drinks', { precision: 10, scale: 4, mode: 'number' }).notNull(),
    earnPer: integer('earn_per').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('exercises_workout_idx').on(t.workoutId),
    check('exercises_earn_per_positive', sql`${t.earnPer} > 0`),
    check('exercises_earn_drinks_non_negative', sql`${t.earnDrinks} >= 0`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('sessions_user_started_idx').on(t.userId, t.startedAt),
    uniqueIndex('sessions_one_active_per_user')
      .on(t.userId)
      .where(sql`${t.endedAt} is null`),
  ],
);

export const setEntries = pgTable(
  'set_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    /** Copied at log time so later rate changes never rewrite history. */
    earnedDrinks: numeric('earned_drinks', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('set_entries_session_idx').on(t.sessionId),
    check('set_entries_amount_positive', sql`${t.amount} > 0`),
  ],
);

export const containers = pgTable(
  'containers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    volumeMl: integer('volume_ml').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('containers_user_idx').on(t.userId),
    check('containers_volume_positive', sql`${t.volumeMl} > 0`),
  ],
);

export const drinks = pgTable(
  'drinks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
    abv: numeric('abv', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    volumeMl: integer('volume_ml').notNull(),
    containerId: uuid('container_id').references(() => containers.id, { onDelete: 'set null' }),
    /** Both copied at log time from the conversion formula. */
    alcoholG: numeric('alcohol_g', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    stdDrinks: numeric('std_drinks', { precision: 10, scale: 4, mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('drinks_user_consumed_idx').on(t.userId, t.consumedAt),
    check('drinks_abv_range', sql`${t.abv} >= 0 and ${t.abv} <= 100`),
    check('drinks_volume_positive', sql`${t.volumeMl} > 0`),
  ],
);
