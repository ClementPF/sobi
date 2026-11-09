import { roundTo } from './conversions.js';
import { addDays, daysBetween, isoWeekday, weekStart } from '../lib/time.js';

export const DASHBOARD_RANGES = ['7d', '30d', '90d', 'all'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

const RANGE_DAYS: Record<Exclude<DashboardRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export interface DayTotals {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  earned: number;
  drunk: number;
  sessions: number;
}

export interface DashboardInput {
  range: DashboardRange;
  /** Local date of "now". */
  today: string;
  /** Local date the account was created, the start of a dry streak for someone who never drank. */
  signupDate: string;
  days: DayTotals[];
}

export interface Dashboard {
  range: DashboardRange;
  from: string;
  to: string;
  balance: number;
  totalEarned: number;
  totalDrunk: number;
  rangeEarned: number;
  rangeDrunk: number;
  series: { date: string; earned: number; drunk: number; balance: number }[];
  weekly: { weekStart: string; earned: number; drunk: number }[];
  stats: {
    avgDrunkPerWeek: number;
    avgEarnedPerWeek: number;
    sessionsPerWeek: number;
    dryStreakDays: number;
    /** ISO weekday (1 = Monday … 7 = Sunday) with the most drinks in range; null if none. */
    topDrinkingWeekday: number | null;
  };
}

const r4 = (n: number) => roundTo(n, 4);

/** Pure aggregation of per-day totals into the dashboard payload. */
export function buildDashboard({ range, today, signupDate, days }: DashboardInput): Dashboard {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  let totalEarned = 0;
  let totalDrunk = 0;
  for (const d of days) {
    totalEarned += d.earned;
    totalDrunk += d.drunk;
  }

  const firstDay = sorted[0]?.date;
  const from =
    range === 'all'
      ? firstDay && firstDay < today
        ? firstDay
        : today
      : addDays(today, -(RANGE_DAYS[range] - 1));

  let running = 0;
  for (const d of sorted) {
    if (d.date >= from) break;
    running += d.earned - d.drunk;
  }

  const series: Dashboard['series'] = [];
  const weekly = new Map<string, { earned: number; drunk: number }>();
  const drunkByWeekday = new Map<number, number>();
  let rangeEarned = 0;
  let rangeDrunk = 0;
  let rangeSessions = 0;
  for (let date = from; date <= today; date = addDays(date, 1)) {
    const d = byDate.get(date);
    const earned = d?.earned ?? 0;
    const drunk = d?.drunk ?? 0;
    running += earned - drunk;
    rangeEarned += earned;
    rangeDrunk += drunk;
    rangeSessions += d?.sessions ?? 0;
    series.push({ date, earned: r4(earned), drunk: r4(drunk), balance: r4(running) });
    const week = weekStart(date);
    const bucket = weekly.get(week) ?? { earned: 0, drunk: 0 };
    bucket.earned += earned;
    bucket.drunk += drunk;
    weekly.set(week, bucket);
    if (drunk > 0) {
      const weekday = isoWeekday(date);
      drunkByWeekday.set(weekday, (drunkByWeekday.get(weekday) ?? 0) + drunk);
    }
  }

  const weeks = (daysBetween(from, today) + 1) / 7;

  let lastDrinkDay: string | undefined;
  for (const d of sorted) {
    if (d.date > today) break;
    if (d.drunk > 0) lastDrinkDay = d.date;
  }
  const dryStreakDays = lastDrinkDay
    ? daysBetween(lastDrinkDay, today)
    : Math.max(daysBetween(signupDate, today) + 1, 0);

  let topDrinkingWeekday: number | null = null;
  let topAmount = 0;
  for (const [weekday, amount] of drunkByWeekday) {
    if (
      amount > topAmount ||
      (amount === topAmount && topDrinkingWeekday !== null && weekday < topDrinkingWeekday)
    ) {
      topAmount = amount;
      topDrinkingWeekday = weekday;
    }
  }

  return {
    range,
    from,
    to: today,
    balance: r4(totalEarned - totalDrunk),
    totalEarned: r4(totalEarned),
    totalDrunk: r4(totalDrunk),
    rangeEarned: r4(rangeEarned),
    rangeDrunk: r4(rangeDrunk),
    series,
    weekly: [...weekly].map(([start, v]) => ({
      weekStart: start,
      earned: r4(v.earned),
      drunk: r4(v.drunk),
    })),
    stats: {
      avgDrunkPerWeek: roundTo(rangeDrunk / weeks, 2),
      avgEarnedPerWeek: roundTo(rangeEarned / weeks, 2),
      sessionsPerWeek: roundTo(rangeSessions / weeks, 2),
      dryStreakDays,
      topDrinkingWeekday,
    },
  };
}
