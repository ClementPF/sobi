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

const RANGES: DashboardRange[] = ['7d', '30d', '90d', 'all'];

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
    <View style={styles.tile}>
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
      <View style={styles.ranges} accessibilityRole="tablist">
        {RANGES.map((r) => (
          <Pressable
            key={r}
            accessibilityRole="tab"
            accessibilityState={{ selected: r === range }}
            onPress={() => onRangeChange(r)}
            style={[styles.range, r === range && styles.rangeSelected]}
          >
            <Text style={[Typography.body, r === range && styles.rangeTextSelected]}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Balance</Text>
        <BalanceChart series={dashboard.series} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Weekly earned vs drunk</Text>
        <WeeklyBars weekly={dashboard.weekly} />
      </View>
      <View style={styles.tiles}>
        <StatTile label="drunk / week" value={formatDrinks(stats.avgDrunkPerWeek)} />
        <StatTile label="earned / week" value={formatDrinks(stats.avgEarnedPerWeek)} />
        <StatTile label="sessions / week" value={formatDrinks(stats.sessionsPerWeek)} />
        <StatTile label="dry streak (days)" value={String(stats.dryStreakDays)} />
        <StatTile
          label="top drinking day"
          value={
            stats.topDrinkingWeekday ? isoWeekdayName(stats.topDrinkingWeekday).slice(0, 3) : '—'
          }
        />
      </View>
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
  container: {
    padding: Spacing.md,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  card: { ...Palette.card, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  debtCard: { borderColor: Colors.drunk },
  cardLabel: { ...Typography.caption, letterSpacing: 2 },
  balance: { fontSize: 56, fontWeight: '800' },
  totals: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  total: { ...Typography.body, fontWeight: '600' },
  quick: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
  ranges: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center' },
  range: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rangeSelected: { borderColor: Colors.accent, backgroundColor: Colors.surfaceRaised },
  rangeTextSelected: { fontWeight: '700' },
  section: { ...Palette.card, gap: Spacing.sm },
  sectionTitle: { ...Typography.body, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { ...Palette.card, flexGrow: 1, minWidth: 100, alignItems: 'center', gap: Spacing.xs },
  tileValue: { ...Typography.title, fontSize: 22 },
});
