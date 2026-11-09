import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { Dashboard } from '@/api/types';
import { BalanceCard, DashboardView } from '@/features/dashboard/dashboard-screen';
import { Colors } from '@/theme';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

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
    expect(screen.getByText('max dry streak (days)')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(colorOf('balance-value')).toBe(Colors.drunk);
  });
});
