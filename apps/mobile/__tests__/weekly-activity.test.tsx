import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { getHistoryDay } from '@/api/endpoints';
import type { Dashboard, HistoryDay } from '@/api/types';
import { useUnits } from '@/auth/session';
import { WeeklyActivity } from '@/features/dashboard/weekly-activity';
import { queryKeys } from '@/lib/queries';

jest.mock('@/api/endpoints', () => ({ getHistoryDay: jest.fn() }));
jest.mock('@/auth/session', () => ({ useUnits: jest.fn(() => 'metric') }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const latest: HistoryDay = {
  date: '2026-11-09',
  earned: 2,
  drunk: 2.0012,
  entries: [
    {
      type: 'drink',
      id: 'beer',
      at: '2026-11-09T21:00:00Z',
      abv: 5,
      volumeMl: 355,
      containerName: 'Can',
      alcoholG: 14,
      stdDrinks: 1.0003,
      note: 'Dinner with friends',
    },
    {
      type: 'drink',
      id: 'wine',
      at: '2026-11-09T20:00:00Z',
      abv: 12,
      volumeMl: 148,
      containerName: null,
      alcoholG: 14.01,
      stdDrinks: 1.0009,
      note: null,
    },
    {
      type: 'session',
      id: 'legs',
      at: '2026-11-09T09:00:00Z',
      endedAt: '2026-11-09T10:00:00Z',
      workoutName: 'Leg day',
      setCount: 3,
      earnedDrinks: 2,
      note: 'Felt strong',
    },
  ],
};
const older: HistoryDay = {
  date: '2026-11-07',
  earned: 0,
  drunk: 1.0003,
  entries: [
    { ...latest.entries[0]!, id: 'older', at: '2026-11-07T20:00:00Z', note: 'Older drink note' },
  ],
};
const dashboard: Dashboard = {
  range: '30d',
  from: '2026-11-07',
  to: '2026-11-09',
  balance: -1.0015,
  totalEarned: 2,
  totalDrunk: 3.0015,
  rangeEarned: 2,
  rangeDrunk: 3.0015,
  series: [
    { date: '2026-11-07', earned: 0, drunk: 1.0003, balance: -1.0003 },
    { date: '2026-11-08', earned: 0, drunk: 0, balance: -1.0003 },
    { date: '2026-11-09', earned: 2, drunk: 2.0012, balance: -1.0015 },
  ],
  weekly: [
    { weekStart: '2026-11-02', earned: 0, drunk: 1.0003 },
    { weekStart: '2026-11-09', earned: 2, drunk: 2.0012 },
  ],
  stats: {
    avgDrunkPerWeek: 3.0015,
    avgEarnedPerWeek: 2,
    sessionsPerWeek: 1,
    dryStreakDays: 0,
    maxDryStreakDays: 1,
    topDrinkingWeekday: 1,
  },
};
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.mocked(useUnits).mockReturnValue('metric');
  jest
    .mocked(getHistoryDay)
    .mockImplementation(async (date) =>
      date === latest.date
        ? latest
        : date === older.date
          ? older
          : { date, earned: 0, drunk: 0, entries: [] },
    );
});
afterEach(() => client.clear());
async function show(data = dashboard) {
  return render(<WeeklyActivity dashboard={data} />, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

async function scrub(index: number) {
  // Nov 7 is five days into the first week; two 142-point week slots in a 300-point plot.
  const pageX = 8 + ((5 + index + 0.5) / 7) * 142;
  await fireEvent(screen.getByTestId('activity-date-graph'), 'responderGrant', {
    nativeEvent: { pageX, locationX: pageX, pageY: 60 },
  });
}

it('defaults to the latest date and shows every drink, note, and workout', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  expect(screen.getByText('Felt strong')).toBeTruthy();
  expect(screen.getByText('Can')).toBeTruthy();
  expect(screen.getByText('Custom drink')).toBeTruthy();
  expect(screen.getByText(/355 ml · 5%/)).toBeTruthy();
  expect(screen.getByText(/148 ml · 12%/)).toBeTruthy();
  expect(screen.getByText('Workouts (1)')).toBeTruthy();
  expect(screen.getByText('Drinks (2)')).toBeTruthy();
  expect(screen.getByTestId('activity-day-totals')).toHaveTextContent(/Earned 2/);
  expect(screen.getByTestId('activity-day-totals')).toHaveTextContent(/Drunk 2/);
  expect(screen.queryByTestId('activity-date-slider')).toBeNull();
  expect(
    screen.getByRole('adjustable', { name: 'Activity date' }).props.accessibilityValue.now,
  ).toBe(2);
  expect(screen.getByTestId('activity-date-marker', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('activity-date-label', { includeHiddenElements: true })).toHaveStyle({
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  });
  expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'View Leg day session' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/sessions/[id]', params: { id: 'legs' } });
});

it('steps through quiet days and highlights the week containing the selected date', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  const lastWeekX = screen.getByTestId('selected-week', { includeHiddenElements: true }).props.x;
  await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
  await screen.findByText('No drinks or workouts logged on this day.');
  expect(getHistoryDay).toHaveBeenCalledWith('2026-11-08', expect.any(String), expect.anything());
  expect(screen.queryByTestId('activity-day-totals')).toBeNull();
  expect(screen.getByTestId('selected-week', { includeHiddenElements: true }).props.x).toBeLessThan(
    lastWeekX,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
  await screen.findByText('Older drink note');
  expect(screen.queryByText(/^Workouts/)).toBeNull();
  expect(screen.queryByText('No workouts logged.')).toBeNull();
  expect(screen.getByText('Drinks (1)')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next day' })).not.toBeDisabled();
});

it('updates totals immediately but fetches only the date where scrubbing settles', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  jest.mocked(getHistoryDay).mockClear();
  await scrub(0);
  expect(screen.getByTestId('activity-day-totals')).toHaveTextContent('Drunk 1');
  await scrub(1);
  await scrub(0);
  await screen.findByText('Older drink note');
  expect(jest.mocked(getHistoryDay).mock.calls.map(([date]) => date)).toEqual(['2026-11-07']);
});

it('hides the previous date’s notes while loading another day and preserves layout height', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  await fireEvent(screen.getByTestId('activity-day-details'), 'layout', {
    nativeEvent: { layout: { height: 360 } },
  });
  let resolveDay!: (day: HistoryDay) => void;
  jest.mocked(getHistoryDay).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDay = resolve;
      }),
  );
  await scrub(0);
  expect(screen.queryByText('Dinner with friends')).toBeNull();
  expect(screen.getByText('Loading day…')).toBeTruthy();
  expect(screen.getByTestId('activity-day-details')).toHaveStyle({ minHeight: 360 });
  await waitFor(() => expect(resolveDay).toBeDefined());
  await act(async () => resolveDay(older));
  await screen.findByText('Older drink note');
});

it('cancels stale requests so a late response cannot replace the selected date', async () => {
  let resolveLate!: (day: HistoryDay) => void;
  jest.mocked(getHistoryDay).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
  );
  await show();
  const signal = jest.mocked(getHistoryDay).mock.calls[0]![2]!;
  await scrub(0);
  await screen.findByText('Older drink note');
  expect(signal.aborted).toBe(true);
  await act(async () => resolveLate(latest));
  expect(screen.queryByText('Dinner with friends')).toBeNull();
  expect(screen.getByText('Older drink note')).toBeTruthy();
});

it('resets to the latest date when switching periods and handles a one-day range', async () => {
  const result = await show();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
  const oneDay: Dashboard = {
    ...dashboard,
    range: '1d',
    from: '2026-11-09',
    series: [dashboard.series[2]!],
  };
  await result.rerender(<WeeklyActivity dashboard={oneDay} />);
  await screen.findByText('Dinner with friends');
  expect(screen.getByTestId('activity-date-graph').props.accessibilityValue.now).toBe(0);
  expect(screen.getByTestId('activity-date-graph').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
});

it('keeps date inspection inside the graph even when the whole period is empty', async () => {
  await show({
    ...dashboard,
    rangeEarned: 0,
    rangeDrunk: 0,
    series: [{ date: '2026-11-08', earned: 0, drunk: 0, balance: 0 }],
    weekly: [{ weekStart: '2026-11-02', earned: 0, drunk: 0 }],
  });
  await screen.findByText('No drinks or workouts logged on this day.');
  expect(screen.getByTestId('activity-date-graph')).toBeTruthy();
  expect(screen.queryByText(/^Drinks \(/)).toBeNull();
  expect(screen.queryByText(/^Workouts \(/)).toBeNull();
});

it('hides the Drinks section on workout-only days, including its zero total', async () => {
  jest.mocked(getHistoryDay).mockResolvedValueOnce({
    ...latest,
    drunk: 0,
    entries: latest.entries.filter((entry) => entry.type === 'session'),
  });
  await show({
    ...dashboard,
    series: [...dashboard.series.slice(0, 2), { ...dashboard.series[2]!, drunk: 0 }],
  });
  await screen.findByText('Felt strong');
  expect(screen.getByText('Workouts (1)')).toBeTruthy();
  expect(screen.queryByText(/^Drinks \(/)).toBeNull();
  expect(screen.queryByText('No drinks logged.')).toBeNull();
  expect(screen.queryByText('Drunk 0')).toBeNull();
});

it('supports keyboard and screen-reader date adjustment directly on the graph', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  const preventDefault = jest.fn();
  await fireEvent(screen.getByTestId('activity-date-graph'), 'keyDown', {
    nativeEvent: { key: 'Home' },
    preventDefault,
  });
  await screen.findByText('Older drink note');
  expect(preventDefault).toHaveBeenCalled();
  expect(screen.getByTestId('activity-date-graph').props['aria-valuenow']).toBe(0);
  await fireEvent(screen.getByTestId('activity-date-graph'), 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  await screen.findByText('No drinks or workouts logged on this day.');
  expect(screen.getByTestId('activity-date-graph').props['aria-valuenow']).toBe(1);
  await fireEvent(screen.getByTestId('activity-date-graph'), 'keyDown', {
    nativeEvent: { key: 'End' },
    preventDefault,
  });
  await screen.findByText('Dinner with friends');
  expect(screen.getByTestId('activity-date-graph').props['aria-valuenow']).toBe(2);
});

it('tracks horizontal dragging across the plot while allowing vertical scrolling', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  await scrub(0);
  const graph = screen.getByTestId('activity-date-graph');
  const firstX = 8 + (5.5 / 7) * 142;
  await fireEvent(graph, 'responderMove', { nativeEvent: { pageX: firstX + 2, pageY: 150 } });
  expect(graph.props.accessibilityValue.now).toBe(0);
  expect(graph.props.onResponderTerminationRequest()).toBe(true);
  await fireEvent(graph, 'responderMove', { nativeEvent: { pageX: firstX + 142 / 7, pageY: 60 } });
  expect(graph.props.accessibilityValue.now).toBe(1);
  await screen.findByText('No drinks or workouts logged on this day.');
});

it('maps a resized, offset graph to exact days and clamps drags outside its edges', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  const graph = screen.getByTestId('activity-date-graph');
  await fireEvent(graph, 'layout', { nativeEvent: { layout: { width: 576 } } });
  const x = 8 + (6.5 / 7) * 280;
  await fireEvent(graph, 'responderGrant', {
    nativeEvent: { pageX: 200 + x, locationX: x, pageY: 60 },
  });
  expect(graph.props.accessibilityValue.now).toBe(1);
  await fireEvent(graph, 'responderMove', { nativeEvent: { pageX: 100, pageY: 60 } });
  expect(graph.props.accessibilityValue.now).toBe(0);
  await fireEvent(graph, 'responderMove', { nativeEvent: { pageX: 1000, pageY: 60 } });
  expect(graph.props.accessibilityValue.now).toBe(2);
  await screen.findByText('Dinner with friends');
});

it('shows a retry action if a day fails to load', async () => {
  jest.mocked(getHistoryDay).mockRejectedValueOnce(new Error('offline'));
  await show();
  await screen.findByText("Could not load this day's activity.");
  await fireEvent.press(screen.getByRole('button', { name: 'Retry day' }));
  await screen.findByText('Dinner with friends');
});

it('refreshes edited notes through the existing History invalidation', async () => {
  await show();
  await screen.findByText('Dinner with friends');
  jest.mocked(getHistoryDay).mockResolvedValueOnce({
    ...latest,
    entries: [{ ...latest.entries[0]!, note: 'Edited note' }],
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.history });
  });
  await screen.findByText('Edited note');
  expect(screen.queryByText('Dinner with friends')).toBeNull();
});

it('uses the account’s imperial volume preference in drink details', async () => {
  jest.mocked(useUnits).mockReturnValue('imperial');
  await show();
  await screen.findByText('Dinner with friends');
  expect(screen.getAllByText(/fl oz/)).toHaveLength(2);
  expect(screen.queryByText(/355 ml/)).toBeNull();
});
