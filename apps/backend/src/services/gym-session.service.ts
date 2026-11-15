import { and, asc, count, desc, eq, inArray, isNull, lte, ne, or, sql, sum } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { exercises, sessions, setEntries, workouts } from '../db/schema.js';
import { roundTo } from '../domain/conversions.js';
import { isUniqueViolation } from '../lib/db-errors.js';
import { ApiError } from '../lib/errors.js';
import type { Cursor } from '../lib/pagination.js';
import {
  toExerciseDto,
  type SessionDetailDto,
  type SessionSummaryDto,
  type SetDto,
} from '../lib/serializers.js';

type SessionRow = typeof sessions.$inferSelect;
type SetRow = typeof setEntries.$inferSelect;

export const sessionNotFound = () => ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');

export function toSetDto(row: SetRow): SetDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    exerciseId: row.exerciseId,
    amount: row.amount,
    weightKg: row.weightKg,
    earnedDrinks: row.earnedDrinks,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findOwnedSession(db: Database, userId: string, id: string) {
  const [row] = await db
    .select({ session: sessions, workout: workouts })
    .from(sessions)
    .innerJoin(workouts, eq(workouts.id, sessions.workoutId))
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
  if (!row) throw sessionNotFound();
  return row;
}

export async function startSession(
  db: Database,
  userId: string,
  workoutId: string,
  now: Date,
): Promise<SessionRow> {
  const [active] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.endedAt)));
  if (active) throw activeSessionExists();
  try {
    const [row] = await db
      .insert(sessions)
      .values({ userId, workoutId, startedAt: now })
      .returning();
    if (!row) throw new Error('session insert returned no row');
    return row;
  } catch (err) {
    if (isUniqueViolation(err, 'sessions_one_active_per_user')) throw activeSessionExists();
    throw err;
  }
}

const activeSessionExists = () =>
  ApiError.conflict('End your current session before starting another', 'ACTIVE_SESSION_EXISTS');

export async function sessionDetail(
  db: Database,
  row: { session: SessionRow; workout: typeof workouts.$inferSelect },
): Promise<SessionDetailDto> {
  const sets = await db
    .select()
    .from(setEntries)
    .where(eq(setEntries.sessionId, row.session.id))
    .orderBy(asc(setEntries.createdAt), asc(setEntries.id));
  const usedIds = [...new Set(sets.map((s) => s.exerciseId))];
  // Active exercises plus archived ones that already have sets in this session.
  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(
      and(
        eq(exercises.workoutId, row.workout.id),
        usedIds.length > 0
          ? or(isNull(exercises.archivedAt), inArray(exercises.id, usedIds))
          : isNull(exercises.archivedAt),
      ),
    )
    .orderBy(asc(exercises.sortOrder), asc(exercises.createdAt));
  const previous = await previousSets(
    db,
    row.session,
    exerciseRows.map((e) => e.id),
  );
  const earned = sets.reduce((acc, s) => acc + s.earnedDrinks, 0);
  return {
    id: row.session.id,
    workout: { id: row.workout.id, name: row.workout.name },
    startedAt: row.session.startedAt.toISOString(),
    endedAt: row.session.endedAt?.toISOString() ?? null,
    note: row.session.note,
    setCount: sets.length,
    earnedDrinks: roundTo(earned, 4),
    exercises: exerciseRows.map((e) => ({
      ...toExerciseDto(e),
      sets: sets.filter((s) => s.exerciseId === e.id).map(toSetDto),
      previousSet: previous.get(e.id) ?? null,
    })),
  };
}

/**
 * The last set of each exercise logged in an earlier session, so the set picker can start where
 * the user left off.
 */
async function previousSets(db: Database, session: SessionRow, exerciseIds: string[]) {
  const previous = new Map<string, { amount: number; weightKg: number | null }>();
  if (exerciseIds.length === 0) return previous;
  const rows = await db
    .selectDistinctOn([setEntries.exerciseId], {
      exerciseId: setEntries.exerciseId,
      amount: setEntries.amount,
      weightKg: setEntries.weightKg,
    })
    .from(setEntries)
    .innerJoin(sessions, eq(sessions.id, setEntries.sessionId))
    .where(
      and(
        inArray(setEntries.exerciseId, exerciseIds),
        eq(sessions.userId, session.userId),
        ne(sessions.id, session.id),
        lte(sessions.startedAt, session.startedAt),
      ),
    )
    .orderBy(
      setEntries.exerciseId,
      desc(sessions.startedAt),
      desc(setEntries.createdAt),
      desc(setEntries.id),
    );
  for (const r of rows) previous.set(r.exerciseId, { amount: r.amount, weightKg: r.weightKg });
  return previous;
}

/** Set count and earned total per session id. */
export async function sessionTotals(db: Database, sessionIds: string[]) {
  const totals = new Map<string, { setCount: number; earnedDrinks: number }>();
  if (sessionIds.length === 0) return totals;
  const rows = await db
    .select({
      sessionId: setEntries.sessionId,
      setCount: count(),
      earned: sum(setEntries.earnedDrinks).mapWith(Number),
    })
    .from(setEntries)
    .where(inArray(setEntries.sessionId, sessionIds))
    .groupBy(setEntries.sessionId);
  for (const r of rows) {
    totals.set(r.sessionId, { setCount: r.setCount, earnedDrinks: roundTo(r.earned ?? 0, 4) });
  }
  return totals;
}

export async function listSessions(
  db: Database,
  userId: string,
  cursor: Cursor | undefined,
  limit: number,
): Promise<{ items: SessionSummaryDto[]; next: Cursor | null }> {
  const rows = await db
    .select({ session: sessions, workout: workouts })
    .from(sessions)
    .innerJoin(workouts, eq(workouts.id, sessions.workoutId))
    .where(
      and(
        eq(sessions.userId, userId),
        cursor
          ? sql`(${sessions.startedAt}, ${sessions.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const totals = await sessionTotals(
    db,
    page.map((r) => r.session.id),
  );
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.session.id,
      workout: { id: r.workout.id, name: r.workout.name },
      startedAt: r.session.startedAt.toISOString(),
      endedAt: r.session.endedAt?.toISOString() ?? null,
      note: r.session.note,
      ...(totals.get(r.session.id) ?? { setCount: 0, earnedDrinks: 0 }),
    })),
    next: rows.length > limit && last ? { at: last.session.startedAt, id: last.session.id } : null,
  };
}
