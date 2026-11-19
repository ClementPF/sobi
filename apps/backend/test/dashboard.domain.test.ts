import { describe, expect, it } from 'vitest';
import { buildDashboard, type DayTotals } from '../src/domain/dashboard.js';
import { addDays, isoWeekday, localDate, weekStart } from '../src/lib/time.js';

const day = (date: string, earned = 0, drunk = 0, sessions = 0): DayTotals => ({
  date,
  earned,
  drunk,
  sessions,
});

describe('time helpers', () => {
  it('maps instants to local dates', () => {
    const at = new Date('2026-11-08T23:30:00Z');
    expect(localDate(at, 'UTC')).toBe('2026-11-08');
    expect(localDate(at, 'Europe/Paris')).toBe('2026-11-09');
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-11-08');
  });

  it('computes ISO weekdays and week starts', () => {
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('buildDashboard', () => {
  const today = '2026-11-08';

  it.each([
    ['1d', 1, '2026-11-08'],
    ['30d', 30, '2026-10-10'],
    ['90d', 90, '2026-08-11'],
    ['365d', 365, '2025-11-09'],
  ] as const)('builds the %s window with the correct inclusive boundary', (range, count, from) => {
    const days = [day(addDays(from, -1), 7, 4, 1), day(from, 2, 1, 1)];
    if (from !== today) days.push(day(today, 3, 2, 1));
    const result = buildDashboard({ range, today, signupDate: '2025-01-01', days });
    expect(result.from).toBe(from);
    expect(result.to).toBe(today);
    expect(result.series).toHaveLength(count);
    expect(result.series[0]).toEqual({ date: from, earned: 2, drunk: 1, balance: 4 });
    expect(result.rangeEarned).toBe(count === 1 ? 2 : 5);
    expect(result.rangeDrunk).toBe(count === 1 ? 1 : 3);
    expect(result.stats.avgDrunkPerWeek).toBeCloseTo(((count === 1 ? 1 : 3) * 7) / count, 2);
    expect(result.balance).toBe(count === 1 ? 4 : 5);
  });

  it('starts the range balance from everything before the range', () => {
    const result = buildDashboard({
      range: '7d',
      today,
      signupDate: '2026-01-01',
      days: [day('2026-10-01', 3, 0, 1), day('2026-11-05', 0, 2), day(today, 1, 0, 1)],
    });
    expect(result.from).toBe('2026-11-02');
    expect(result.to).toBe(today);
    expect(result.series).toHaveLength(7);
    expect(result.series[0]).toEqual({ date: '2026-11-02', earned: 0, drunk: 0, balance: 3 });
    expect(result.series.find((p) => p.date === '2026-11-05')?.balance).toBe(1);
    expect(result.series.at(-1)?.balance).toBe(2);
    expect(result.balance).toBe(2);
    expect(result.totalEarned).toBe(4);
    expect(result.totalDrunk).toBe(2);
    expect(result.rangeEarned).toBe(1);
    expect(result.rangeDrunk).toBe(2);
    expect(result.stats.avgDrunkPerWeek).toBe(2);
    expect(result.stats.sessionsPerWeek).toBe(1);
  });

  it('reports debt as a negative balance', () => {
    const result = buildDashboard({
      range: '30d',
      today,
      signupDate: '2026-11-01',
      days: [day('2026-11-03', 1, 0, 1), day('2026-11-07', 0, 3.5)],
    });
    expect(result.balance).toBe(-2.5);
    expect(result.series.at(-1)?.balance).toBe(-2.5);
  });

  it('groups the range into Monday-based weeks', () => {
    const result = buildDashboard({
      range: '7d',
      today,
      signupDate: '2026-01-01',
      days: [day('2026-11-02', 2, 1), day('2026-11-08', 1, 0.5)],
    });
    expect(result.weekly).toEqual([{ weekStart: '2026-11-02', earned: 3, drunk: 1.5 }]);
  });

  it('counts the dry streak from the last drink day, or from signup', () => {
    const drank = buildDashboard({
      range: '7d',
      today,
      signupDate: '2026-01-01',
      days: [day('2026-11-05', 0, 1)],
    });
    expect(drank.stats.dryStreakDays).toBe(3);
    const drankToday = buildDashboard({
      range: '7d',
      today,
      signupDate: '2026-01-01',
      days: [day(today, 0, 1)],
    });
    expect(drankToday.stats.dryStreakDays).toBe(0);
    const never = buildDashboard({ range: '7d', today, signupDate: '2026-11-06', days: [] });
    expect(never.stats.dryStreakDays).toBe(3);
  });

  it('finds the longest dry streak, including the current one', () => {
    const gaps = buildDashboard({
      range: '7d',
      today,
      signupDate: '2026-11-01',
      days: [
        day('2026-01-01', 1, 0),
        day('2026-01-04', 0, 1),
        day('2026-01-20', 0, 1),
        day('2026-11-06', 0, 1),
      ],
    });
    // First activity 01-01 to the 01-04 drink: 3 dry days; 01-04 to 01-20: 15; 01-20 to 11-06: 289.
    expect(gaps.stats.maxDryStreakDays).toBe(289);
    expect(gaps.stats.dryStreakDays).toBe(2);
    const current = buildDashboard({
      range: '7d',
      today,
      signupDate: '2026-01-01',
      days: [day('2026-01-03', 0, 1), day('2026-01-05', 0, 1)],
    });
    expect(current.stats.maxDryStreakDays).toBe(current.stats.dryStreakDays);
    const never = buildDashboard({ range: '7d', today, signupDate: '2026-11-06', days: [] });
    expect(never.stats.maxDryStreakDays).toBe(3);
  });

  it('finds the top drinking weekday in range', () => {
    const result = buildDashboard({
      range: '30d',
      today,
      signupDate: '2026-01-01',
      days: [day('2026-10-30', 0, 2), day('2026-11-06', 0, 1.5), day('2026-11-07', 0, 3)],
    });
    expect(result.stats.topDrinkingWeekday).toBe(5);
    const none = buildDashboard({ range: '30d', today, signupDate: '2026-01-01', days: [] });
    expect(none.stats.topDrinkingWeekday).toBeNull();
  });

  it('spans from the first activity day for the all range', () => {
    const result = buildDashboard({
      range: 'all',
      today,
      signupDate: '2026-01-01',
      days: [day('2026-10-26', 1, 0)],
    });
    expect(result.from).toBe('2026-10-26');
    expect(result.series).toHaveLength(14);
    expect(result.stats.avgEarnedPerWeek).toBe(0.5);
    const empty = buildDashboard({ range: 'all', today, signupDate: '2026-01-01', days: [] });
    expect(empty.series).toHaveLength(1);
  });
});
