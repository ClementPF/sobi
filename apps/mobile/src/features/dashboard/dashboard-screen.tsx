import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDashboard } from '@/api/endpoints';
import type { Dashboard, DashboardRange } from '@/api/types';
import { Button } from '@/components/button';
import { BalanceChart, WeeklyBars } from '@/components/charts';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { formatDrinks } from '@/lib/conversions';
import { queryKeys } from '@/lib/queries';
import { deviceTimeZone, isoWeekdayName } from '@/lib/time';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

const RANGES: { value: DashboardRange; label: string; description: string }[] = [
  { value: '1d', label: '1d', description: 'Today' },
  { value: '30d', label: '1mo', description: 'Last 30 days' },
  { value: '90d', label: '3mo', description: 'Last 90 days' },
  { value: '365d', label: '1y', description: 'Last 365 days' },
  { value: 'all', label: 'All', description: 'All time' },
];

export function balanceColor(balance: number): string {
  return balance < 0 ? Colors.drunk : Colors.earned;
}

export function BalanceCard({
  balance,
  totalEarned,
  totalDrunk,
}: Pick<Dashboard, 'balance' | 'totalEarned' | 'totalDrunk'>) {
  const debt = balance < 0;
  return (
    <View style={[styles.card, debt && styles.debtCard]} testID="balance-card">
      <Text style={styles.cardLabel}>{debt ? 'DRINK DEBT' : 'DRINKS IN THE BANK'}</Text>
      <Text
        style={[styles.balance, { color: balanceColor(balance) }]}
        testID="balance-value"
        accessibilityLabel={`Balance ${formatDrinks(balance)} standard drinks`}
      >
        {formatDrinks(balance)}
      </Text>
      <Text style={Typography.caption}>standard drinks (14 g alcohol)</Text>
      <View style={styles.totals}>
        <Text style={[styles.total, { color: Colors.earned }]}>
          Earned {formatDrinks(totalEarned)}
        </Text>
        <Text style={[styles.total, { color: Colors.drunk }]}>
          Drunk {formatDrinks(totalDrunk)}
        </Text>
      </View>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile} testID={`stat-${label}`}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={Typography.caption}>{label}</Text>
    </View>
  );
}

export function DashboardView({
  dashboard,
  range,
  onRangeChange,
}: {
  dashboard: Dashboard;
  range: DashboardRange;
  onRangeChange(range: DashboardRange): void;
}) {
  const { stats } = dashboard;
  return (
    <>
      <BalanceCard {...dashboard} />
      <View style={styles.quick}>
        <Button title="Start workout" onPress={() => router.push('/workout')} style={styles.flex} />
        <Button
          title="Log drink"
          variant="secondary"
          onPress={() => router.push('/drinks')}
          style={styles.flex}
        />
      </View>
      <View style={styles.activityHeader}>
        <Text style={styles.sectionTitle}>Activity</Text>
        <Text style={Typography.caption}>
          {RANGES.find((r) => r.value === range)?.description ?? 'Last 7 days'}
        </Text>
      </View>
      <View
        style={styles.ranges}
        accessibilityRole="radiogroup"
        accessibilityLabel="Activity period"
      >
        {RANGES.map(({ value, label, description }) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={description}
            accessibilityState={{ checked: value === range }}
            aria-checked={value === range}
            onPress={() => onRangeChange(value)}
            style={[styles.range, value === range && styles.rangeSelected]}
          >
            <Text style={[Typography.body, value === range && styles.rangeTextSelected]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {dashboard.rangeEarned === 0 && dashboard.rangeDrunk === 0 ? (
        <View style={styles.section} testID="empty-period">
          <Text style={styles.sectionTitle}>No activity in this period</Text>
          <Text style={Typography.bodySecondary}>Your all-time balance is shown above.</Text>
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Balance</Text>
            <BalanceChart series={dashboard.series} />
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Weekly earned vs drunk</Text>
            <View style={styles.legend}>
              <Text style={[Typography.caption, { color: Colors.earned }]}>Earned</Text>
              <Text style={[Typography.caption, { color: Colors.drunk }]}>Drunk</Text>
            </View>
            <WeeklyBars weekly={dashboard.weekly} />
          </View>
        </>
      )}
      <View style={styles.tiles}>
        <View style={styles.tileRow} testID="stats-row">
          <StatTile label="Drunk / week" value={formatDrinks(stats.avgDrunkPerWeek)} />
          <StatTile label="Earned / week" value={formatDrinks(stats.avgEarnedPerWeek)} />
        </View>
        <View style={styles.tileRow} testID="stats-row">
          <StatTile label="Sessions / week" value={formatDrinks(stats.sessionsPerWeek)} />
          <StatTile
            label="Top drinking day"
            value={
              stats.topDrinkingWeekday ? isoWeekdayName(stats.topDrinkingWeekday).slice(0, 3) : '—'
            }
          />
        </View>
        <View style={styles.tileRow} testID="stats-row">
          <StatTile label="Dry streak (days)" value={String(stats.dryStreakDays)} />
          <StatTile label="Longest dry streak" value={String(stats.maxDryStreakDays)} />
        </View>
      </View>
      <Text style={Typography.caption}>Dry streaks count all-time days, regardless of period.</Text>
    </>
  );
}

export function DashboardScreen() {
  const [range, setRange] = useState<DashboardRange>('30d');
  const query = useQuery({
    queryKey: queryKeys.dashboard(range),
    queryFn: () => getDashboard(range, deviceTimeZone()),
    placeholderData: (previous) => previous,
  });

  if (query.isPending) return <CenteredLoading />;
  if (query.isError) {
    return (
      <EmptyState
        title="Could not load your balance."
        actionTitle="Try again"
        onAction={() => void query.refetch()}
      />
    );
  }

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          tintColor={Colors.text}
        />
      }
    >
      <DashboardView dashboard={query.data} range={range} onRangeChange={setRange} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: Palette.content,
  card: { ...Palette.card, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  debtCard: { borderColor: Colors.drunk },
  cardLabel: { ...Typography.caption, letterSpacing: 2 },
  balance: { fontSize: 56, fontWeight: '800' },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.sm,
  },
  total: { ...Typography.body, fontWeight: '600' },
  quick: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ranges: { flexDirection: 'row', gap: Spacing.xs },
  range: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rangeSelected: { borderColor: Colors.accent, backgroundColor: Colors.surfaceRaised },
  rangeTextSelected: { fontWeight: '700' },
  section: { ...Palette.card, gap: Spacing.sm },
  sectionTitle: { ...Typography.body, fontWeight: '700' },
  legend: { flexDirection: 'row', gap: Spacing.md },
  tiles: { gap: Spacing.sm },
  tileRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'stretch' },
  tile: { ...Palette.card, flex: 1, minWidth: 0, justifyContent: 'center', gap: Spacing.xs },
  tileValue: { ...Typography.title, fontSize: 24, fontVariant: ['tabular-nums'] },
});
