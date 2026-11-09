import { eq, sql, sum, count } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { drinks, sessions, setEntries, users } from '../db/schema.js';
import type { DayTotals } from '../domain/dashboard.js';

/** to_char(<ts> at time zone tz, 'YYYY-MM-DD'): the local calendar date of a timestamp. */
export function localDay(column: unknown, timeZone: string) {
  return sql<string>`to_char(${column} at time zone ${timeZone}, 'YYYY-MM-DD')`;
}

/** Earned, drunk and session counts per local day over the user's whole history. */
export async function loadDailyTotals(
  db: Database,
  userId: string,
  timeZone: string,
): Promise<DayTotals[]> {
  // Grouped by ordinal: the tz parameter makes each to_char expression textually distinct.
  const [earned, drunk, started] = await Promise.all([
    db
      .select({
        day: localDay(setEntries.createdAt, timeZone),
        value: sum(setEntries.earnedDrinks).mapWith(Number),
      })
      .from(setEntries)
      .innerJoin(sessions, eq(sessions.id, setEntries.sessionId))
      .where(eq(sessions.userId, userId))
      .groupBy(sql`1`),
    db
      .select({
        day: localDay(drinks.consumedAt, timeZone),
        value: sum(drinks.stdDrinks).mapWith(Number),
      })
      .from(drinks)
      .where(eq(drinks.userId, userId))
      .groupBy(sql`1`),
    db
      .select({ day: localDay(sessions.startedAt, timeZone), value: count() })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .groupBy(sql`1`),
  ]);
  const days = new Map<string, DayTotals>();
  const at = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = { date, earned: 0, drunk: 0, sessions: 0 };
      days.set(date, d);
    }
    return d;
  };
  for (const r of earned) at(r.day).earned += r.value ?? 0;
  for (const r of drunk) at(r.day).drunk += r.value ?? 0;
  for (const r of started) at(r.day).sessions += r.value;
  return [...days.values()];
}

export async function userCreatedAt(db: Database, userId: string): Promise<Date> {
  const [row] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.createdAt ?? new Date();
}
