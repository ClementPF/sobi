import { and, count, desc, eq, isNotNull, or, sum } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { containers, drinks, sessions, setEntries, workouts } from '../db/schema.js';
import { roundTo } from '../domain/conversions.js';
import { localDay } from './dashboard.service.js';

/** A day drill-down uses set timestamps, like the dashboard, not the session's start date. */
export async function historyDay(db: Database, userId: string, date: string, tz: string) {
  const [sessionRows, drinkRows] = await Promise.all([
    db
      .select({
        session: sessions,
        workoutName: workouts.name,
        setCount: count(setEntries.id),
        earned: sum(setEntries.earnedDrinks).mapWith(Number),
      })
      .from(sessions)
      .innerJoin(workouts, eq(workouts.id, sessions.workoutId))
      .leftJoin(
        setEntries,
        and(eq(setEntries.sessionId, sessions.id), eq(localDay(setEntries.createdAt, tz), date)),
      )
      .where(
        and(
          eq(sessions.userId, userId),
          or(eq(localDay(sessions.startedAt, tz), date), isNotNull(setEntries.id)),
        ),
      )
      .groupBy(sessions.id, workouts.name)
      .orderBy(desc(sessions.startedAt), desc(sessions.id)),
    db
      .select({ drink: drinks, containerName: containers.name })
      .from(drinks)
      .leftJoin(containers, eq(containers.id, drinks.containerId))
      .where(and(eq(drinks.userId, userId), eq(localDay(drinks.consumedAt, tz), date)))
      .orderBy(desc(drinks.consumedAt), desc(drinks.id)),
  ]);

  const entries = [
    ...sessionRows.map(({ session, workoutName, setCount, earned }) => ({
      type: 'session' as const,
      id: session.id,
      at: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      workoutName,
      setCount,
      earnedDrinks: roundTo(earned ?? 0, 4),
      note: session.note,
    })),
    ...drinkRows.map(({ drink, containerName }) => ({
      type: 'drink' as const,
      id: drink.id,
      at: drink.consumedAt.toISOString(),
      abv: drink.abv,
      volumeMl: drink.volumeMl,
      containerName,
      alcoholG: drink.alcoholG,
      stdDrinks: drink.stdDrinks,
      note: drink.note,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

  return {
    date,
    earned: roundTo(
      sessionRows.reduce((total, row) => total + (row.earned ?? 0), 0),
      4,
    ),
    drunk: roundTo(
      drinkRows.reduce((total, row) => total + row.drink.stdDrinks, 0),
      4,
    ),
    entries,
  };
}
