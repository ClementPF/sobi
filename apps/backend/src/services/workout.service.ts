import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { exercises, workouts } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { toWorkoutDto, type WorkoutDto } from '../lib/serializers.js';

type WorkoutRow = typeof workouts.$inferSelect;
type ExerciseRow = typeof exercises.$inferSelect;

export interface ExerciseInput {
  name: string;
  metric: ExerciseRow['metric'];
  earnDrinks: number;
  earnPer: number;
}

export const workoutNotFound = () => ApiError.notFound('Workout not found', 'WORKOUT_NOT_FOUND');
export const exerciseNotFound = () => ApiError.notFound('Exercise not found', 'EXERCISE_NOT_FOUND');

/** An active (not archived) workout of the user; anything else is a 404. */
export async function findOwnedWorkout(
  db: Database,
  userId: string,
  id: string,
): Promise<WorkoutRow> {
  const [row] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId), isNull(workouts.archivedAt)));
  if (!row) throw workoutNotFound();
  return row;
}

export async function activeExercises(db: Database, workoutIds: string[]) {
  if (workoutIds.length === 0) return [];
  return db
    .select()
    .from(exercises)
    .where(and(inArray(exercises.workoutId, workoutIds), isNull(exercises.archivedAt)))
    .orderBy(asc(exercises.sortOrder), asc(exercises.createdAt));
}

export async function workoutDto(db: Database, row: WorkoutRow): Promise<WorkoutDto> {
  return toWorkoutDto(row, await activeExercises(db, [row.id]));
}

export async function listWorkouts(db: Database, userId: string): Promise<WorkoutDto[]> {
  const rows = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, userId), isNull(workouts.archivedAt)))
    .orderBy(asc(workouts.createdAt));
  const all = await activeExercises(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) =>
    toWorkoutDto(
      row,
      all.filter((e) => e.workoutId === row.id),
    ),
  );
}

export async function createWorkout(
  db: Database,
  userId: string,
  input: { name: string; exercises: ExerciseInput[] },
): Promise<WorkoutDto> {
  return db.transaction(async (tx) => {
    const [workout] = await tx.insert(workouts).values({ userId, name: input.name }).returning();
    if (!workout) throw new Error('workout insert returned no row');
    const created =
      input.exercises.length === 0
        ? []
        : await tx
            .insert(exercises)
            .values(input.exercises.map((e, i) => ({ ...e, workoutId: workout.id, sortOrder: i })))
            .returning();
    return toWorkoutDto(workout, created);
  });
}

export async function addExercise(
  db: Database,
  workoutId: string,
  input: ExerciseInput,
): Promise<ExerciseRow> {
  const [last] = await db
    .select({ value: max(exercises.sortOrder) })
    .from(exercises)
    .where(eq(exercises.workoutId, workoutId));
  const [row] = await db
    .insert(exercises)
    .values({ ...input, workoutId, sortOrder: (last?.value ?? -1) + 1 })
    .returning();
  if (!row) throw new Error('exercise insert returned no row');
  return row;
}

export async function findWorkoutExercise(
  db: Database,
  workoutId: string,
  exerciseId: string,
): Promise<ExerciseRow> {
  const [row] = await db
    .select()
    .from(exercises)
    .where(
      and(
        eq(exercises.id, exerciseId),
        eq(exercises.workoutId, workoutId),
        isNull(exercises.archivedAt),
      ),
    );
  if (!row) throw exerciseNotFound();
  return row;
}
