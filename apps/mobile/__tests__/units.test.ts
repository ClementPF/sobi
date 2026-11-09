import {
  formatAmount,
  formatRate,
  formatVolume,
  parseEarnPer,
  parseVolume,
} from '@/lib/conversions';
import { composeAmount, splitAmount } from '@/features/workout/set-sheet';
import { parseRow } from '@/features/workout/workout-editor';
import { consumedAtOf, dayLabel } from '@/features/drinks/drinks-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('imperial units', () => {
  it('shows and parses volumes in US fluid ounces, storing whole ml', () => {
    expect(formatVolume(355, 'imperial')).toBe('12 fl oz');
    expect(formatVolume(355, 'metric')).toBe('355 ml');
    expect(parseVolume('12', 'imperial')).toBe(355);
    expect(parseVolume('1,5', 'imperial')).toBe(44);
    expect(parseVolume('330', 'metric')).toBe(330);
    expect(parseVolume('33.5', 'metric')).toBeNull();
    expect(parseVolume('', 'imperial')).toBeNull();
    expect(parseVolume('0', 'imperial')).toBeNull();
  });

  it('shows distances and rates in miles', () => {
    expect(formatAmount('meters', 1609, 'imperial')).toBe('1 mi');
    expect(formatAmount('meters', 1609, 'metric')).toBe('1.61 km');
    expect(formatAmount('count', 20, 'imperial')).toBe('20');
    expect(formatRate('meters', 1, 1609, 'imperial')).toBe('1 drink per 1 mi');
    expect(parseEarnPer('meters', '0.5', 'imperial')).toBe(805);
    expect(parseEarnPer('count', '0.5', 'imperial')).toBeNull();
  });

  it('uses mile and tenth drums for distance sets', () => {
    expect(composeAmount('meters', [2, 5], 'imperial')).toBe(4023);
    expect(splitAmount('meters', 4023, 'imperial')).toEqual([2, 5]);
  });

  it('keeps a stored rate whose miles text was not edited', () => {
    const saved = { metric: 'meters' as const, earnPer: 1000, text: '0.62' };
    const row = {
      key: 'a',
      name: 'Run',
      metric: 'meters' as const,
      earnDrinks: '1',
      earnPer: '0.62',
      saved,
    };
    expect(parseRow(row, 'imperial')).toMatchObject({ earnPer: 1000 });
    expect(parseRow({ ...row, earnPer: '1' }, 'imperial')).toMatchObject({ earnPer: 1609 });
  });
});

describe('drink date', () => {
  const now = new Date(2026, 10, 8, 22, 30);

  it('labels recent days and older dates', () => {
    expect(dayLabel(0, now)).toBe('Today');
    expect(dayLabel(1, now)).toBe('Yesterday');
    expect(dayLabel(10, now)).toContain('29');
    expect(dayLabel(365, now)).toContain('2025');
  });

  it('builds a local timestamp any number of days back', () => {
    const iso = consumedAtOf({ kind: 'at', daysAgo: 40, hour: 21, minute: 15 }, now)!;
    const at = new Date(iso);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual(
      [2026, 8, 29, 21, 15],
    );
    expect(consumedAtOf({ kind: 'now' }, now)).toBeUndefined();
  });
});
