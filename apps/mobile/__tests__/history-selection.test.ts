import type { HistoryEntry } from '@/api/types';
import { selectionLabel } from '@/features/history/selection';

const session = (id: string): HistoryEntry => ({
  type: 'session',
  id,
  at: '2026-11-08T12:00:00Z',
  endedAt: null,
  workoutName: 'Workout',
  setCount: 1,
  earnedDrinks: 0.1,
  note: null,
});
const drink = (id: string): HistoryEntry => ({
  type: 'drink',
  id,
  at: '2026-11-08T20:00:00Z',
  abv: 5,
  volumeMl: 330,
  containerName: null,
  alcoholG: 13,
  stdDrinks: 0.93,
  note: null,
});

describe('selectionLabel', () => {
  it('counts sessions and drinks with plurals', () => {
    expect(selectionLabel([session('a')])).toBe('1 session');
    expect(selectionLabel([drink('a'), drink('b')])).toBe('2 drinks');
    expect(selectionLabel([session('a'), session('b'), drink('c')])).toBe('2 sessions and 1 drink');
  });
});
