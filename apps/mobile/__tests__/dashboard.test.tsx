import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { Dashboard } from '@/api/types';
import { getDashboard } from '@/api/endpoints';
import { BalanceCard, DashboardScreen, DashboardView } from '@/features/dashboard/dashboard-screen';
import { Colors } from '@/theme';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/api/endpoints', () => ({ getDashboard: jest.fn() }));

const dashboard: Dashboard = {
  range: '7d',
  from: '2026-11-02',
  to: '2026-11-08',
  balance: -1.75,
  totalEarned: 2,
  totalDrunk: 3.75,
  rangeEarned: 2,
  rangeDrunk: 3.75,
  series: [
    { date: '2026-11-07', earned: 2, drunk: 0, balance: 2 },
    { date: '2026-11-08', earned: 0, drunk: 3.75, balance: -1.75 },
  ],
  weekly: [{ weekStart: '2026-11-02', earned: 2, drunk: 3.75 }],
  stats: {
    avgDrunkPerWeek: 3.75,
    avgEarnedPerWeek: 2,
    sessionsPerWeek: 1,
    dryStreakDays: 0,
    maxDryStreakDays: 12,
    topDrinkingWeekday: 7,
  },
};

const colorOf = (testId: string) =>
  StyleSheet.flatten(screen.getByTestId(testId).props.style).color;

describe('dashboard', () => {
  it('shows a negative balance in red as debt', async () => {
    await render(<BalanceCard balance={-1.75} totalEarned={2} totalDrunk={3.75} />);
    expect(screen.getByTestId('balance-value')).toHaveTextContent('-1.75');
    expect(colorOf('balance-value')).toBe(Colors.drunk);
    expect(screen.getByText('DRINK DEBT')).toBeTruthy();
  });

  it('shows a positive balance in green', async () => {
    await render(<BalanceCard balance={0.5} totalEarned={1} totalDrunk={0.5} />);
    expect(colorOf('balance-value')).toBe(Colors.earned);
    expect(screen.queryByText('DRINK DEBT')).toBeNull();
  });

  it('renders charts and stat tiles', async () => {
    await render(<DashboardView dashboard={dashboard} range="7d" onRangeChange={jest.fn()} />);
    expect(screen.getByTestId('balance-chart')).toBeTruthy();
    expect(screen.getByTestId('weekly-bars')).toBeTruthy();
    expect(screen.getByText('Sun')).toBeTruthy();
    expect(screen.getByText('Longest dry streak')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(colorOf('balance-value')).toBe(Colors.drunk);
  });

  it('keeps every statistic, including longest dry streak, in equal two-column rows', async () => {
    await render(<DashboardView dashboard={dashboard} range="30d" onRangeChange={jest.fn()} />);
    const rows = screen.getAllByTestId('stats-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.children).toHaveLength(2);
      for (const tile of row.children) {
        if (typeof tile === 'string') throw new Error('Expected a stat tile');
        expect(StyleSheet.flatten(tile.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
      }
    }
  });

  it('explains an empty period instead of displaying empty charts', async () => {
    await render(
      <DashboardView
        dashboard={{ ...dashboard, rangeEarned: 0, rangeDrunk: 0 }}
        range="1d"
        onRangeChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId('empty-period')).toHaveTextContent(/No activity in this period/);
    expect(screen.queryByTestId('balance-chart')).toBeNull();
    expect(screen.getByTestId('balance-value')).toHaveTextContent('-1.75');
  });

  it('offers the five requested periods and fetches each selected range', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    jest.mocked(getDashboard).mockImplementation(async (range) => ({
      ...dashboard,
      range,
      balance: ['1d', '30d', '90d', '365d', 'all'].indexOf(range) + 1,
    }));
    try {
      await render(
        <QueryClientProvider client={client}>
          <DashboardScreen />
        </QueryClientProvider>,
      );
      await screen.findByText('1mo');
      expect(screen.getAllByRole('radio')).toHaveLength(5);
      for (const [label, description, value] of [
        ['1d', 'Today', '1d'],
        ['1mo', 'Last 30 days', '30d'],
        ['3mo', 'Last 90 days', '90d'],
        ['1y', 'Last 365 days', '365d'],
        ['All', 'All time', 'all'],
      ] as const) {
        expect(screen.getByText(label)).toBeTruthy();
        await fireEvent.press(screen.getByRole('radio', { name: description }));
        await waitFor(() => expect(getDashboard).toHaveBeenCalledWith(value, expect.any(String)));
        expect(screen.getByRole('radio', { name: description })).toBeChecked();
        await waitFor(() =>
          expect(screen.getByTestId('balance-value')).toHaveTextContent(
            String(['1d', '30d', '90d', '365d', 'all'].indexOf(value) + 1),
          ),
        );
      }
    } finally {
      client.clear();
    }
  });
});
