import { z } from 'zod';
import type { containers, drinks, exercises, users, workouts } from '../db/schema.js';

/** Free text; blank becomes null. */
export const noteInputSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((v) => (v ? v : null))
  .describe('Free-text note, up to 500 characters; blank clears it');

export const unitsSchema = z
  .enum(['metric', 'imperial'])
  .describe('Display units; the API always stores ml and meters');

export const userDtoSchema = z
  .object({
    id: z.uuid(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    pictureUrl: z.string().nullable(),
    units: unitsSchema,
  })
  .meta({ id: 'User' });

export type UserDto = z.infer<typeof userDtoSchema>;

export function toUserDto(row: typeof users.$inferSelect): UserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    pictureUrl: row.pictureUrl,
    units: row.units,
  };
}

export const metricSchema = z
  .enum(['count', 'seconds', 'meters'])
  .describe('Unit of an exercise: repetitions, seconds or meters');

export const exerciseDtoSchema = z
  .object({
    id: z.uuid(),
    workoutId: z.uuid(),
    name: z.string(),
    metric: metricSchema,
    earnDrinks: z.number().describe('Standard drinks earned per `earnPer` units'),
    earnPer: z.number().int(),
    sortOrder: z.number().int(),
    archived: z.boolean(),
  })
  .meta({ id: 'Exercise' });

export type ExerciseDto = z.infer<typeof exerciseDtoSchema>;

export function toExerciseDto(row: typeof exercises.$inferSelect): ExerciseDto {
  return {
    id: row.id,
    workoutId: row.workoutId,
    name: row.name,
    metric: row.metric,
    earnDrinks: row.earnDrinks,
    earnPer: row.earnPer,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
  };
}

export const workoutDtoSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    exercises: z.array(exerciseDtoSchema).describe('Active exercises in display order'),
  })
  .meta({ id: 'Workout' });

export type WorkoutDto = z.infer<typeof workoutDtoSchema>;

export function toWorkoutDto(
  row: typeof workouts.$inferSelect,
  exerciseRows: (typeof exercises.$inferSelect)[],
): WorkoutDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    exercises: exerciseRows.map(toExerciseDto),
  };
}

export const containerDtoSchema = z
  .object({ id: z.uuid(), name: z.string(), volumeMl: z.number().int() })
  .meta({ id: 'Container' });

export type ContainerDto = z.infer<typeof containerDtoSchema>;

export function toContainerDto(row: typeof containers.$inferSelect): ContainerDto {
  return { id: row.id, name: row.name, volumeMl: row.volumeMl };
}

export const drinkDtoSchema = z
  .object({
    id: z.uuid(),
    consumedAt: z.iso.datetime(),
    abv: z.number(),
    volumeMl: z.number().int(),
    containerId: z.uuid().nullable(),
    containerName: z.string().nullable(),
    alcoholG: z.number(),
    stdDrinks: z.number(),
    note: z.string().nullable(),
  })
  .meta({ id: 'Drink' });

export type DrinkDto = z.infer<typeof drinkDtoSchema>;

export function toDrinkDto(
  row: typeof drinks.$inferSelect,
  containerName: string | null,
): DrinkDto {
  return {
    id: row.id,
    consumedAt: row.consumedAt.toISOString(),
    abv: row.abv,
    volumeMl: row.volumeMl,
    containerId: row.containerId,
    containerName,
    alcoholG: row.alcoholG,
    stdDrinks: row.stdDrinks,
    note: row.note,
  };
}

export const setDtoSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    exerciseId: z.uuid(),
    amount: z.number().int(),
    earnedDrinks: z.number(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'SetEntry' });

export type SetDto = z.infer<typeof setDtoSchema>;

export const sessionSummarySchema = z
  .object({
    id: z.uuid(),
    workout: z.object({ id: z.uuid(), name: z.string() }),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    setCount: z.number().int(),
    earnedDrinks: z.number(),
    note: z.string().nullable(),
  })
  .meta({ id: 'SessionSummary' });

export type SessionSummaryDto = z.infer<typeof sessionSummarySchema>;

export const sessionDetailSchema = sessionSummarySchema
  .extend({
    exercises: z.array(
      exerciseDtoSchema.extend({
        sets: z.array(setDtoSchema),
      }),
    ),
  })
  .meta({ id: 'SessionDetail' });

export type SessionDetailDto = z.infer<typeof sessionDetailSchema>;

export const idParamsSchema = z.object({ id: z.uuid() });
