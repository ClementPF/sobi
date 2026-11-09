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
