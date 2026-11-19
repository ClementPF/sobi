import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getHistoryDay } from '@/api/endpoints';
import type { Dashboard } from '@/api/types';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { WeeklyBars } from '@/components/charts';
import { IconButton } from '@/components/icon';
import { formatDrinks, formatVolume } from '@/lib/conversions';
import { queryKeys } from '@/lib/queries';
import { deviceTimeZone, formatTime } from '@/lib/time';
import { Colors, Spacing, Typography } from '@/theme';

/** Reset to the latest day when the period changes, but preserve selection on refresh. */
export function WeeklyActivity({ dashboard }: { dashboard: Dashboard }) {
  if (dashboard.series.length === 0) return null;
  return <ActivityTimeline key={`${dashboard.from}/${dashboard.to}`} dashboard={dashboard} />;
}

function ActivityTimeline({ dashboard }: { dashboard: Dashboard }) {
  const units = useUnits();
  const tz = deviceTimeZone();
  const [index, setIndex] = useState(dashboard.series.length - 1);
  const selectedIndex = Math.min(index, dashboard.series.length - 1);
  const point = dashboard.series[selectedIndex]!;
  const [settledDate, setSettledDate] = useState(point.date);
  const [detailsHeight, setDetailsHeight] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setSettledDate(point.date), 200);
    return () => clearTimeout(timer);
  }, [point.date]);
  const query = useQuery({
    queryKey: queryKeys.historyDay(point.date, tz),
    queryFn: ({ signal }) => getHistoryDay(point.date, tz, signal),
    enabled: settledDate === point.date,
    staleTime: 60_000,
  });
  const sessions = query.data?.entries.filter((entry) => entry.type === 'session') ?? [];
  const drinks = query.data?.entries.filter((entry) => entry.type === 'drink') ?? [];

  return (
    <View style={styles.section} testID="weekly-activity">
      <Text style={styles.heading}>Weekly earned vs drunk</Text>
      <View style={styles.row}>
        <View style={[styles.row, styles.flex]}>
          <Text style={[Typography.caption, styles.earned]}>Earned</Text>
          <Text style={[Typography.caption, styles.drunk]}>Drunk</Text>
        </View>
        <IconButton
          icon="chevronLeft"
          label="Previous day"
          disabled={selectedIndex === 0}
          onPress={() => setIndex(selectedIndex - 1)}
        />
        <IconButton
          icon="chevron"
          label="Next day"
          disabled={selectedIndex === dashboard.series.length - 1}
          onPress={() => setIndex(selectedIndex + 1)}
        />
      </View>
      <WeeklyBars
        weekly={dashboard.weekly}
        selection={{ days: dashboard.series, index: selectedIndex, onChange: setIndex }}
      />
      <Text style={Typography.caption}>Drag across the graph to explore a day.</Text>
      <View style={styles.day} testID="activity-day">
        {(point.earned !== 0 || point.drunk !== 0) && (
          <>
            <Text style={Typography.caption}>Daily totals · standard drinks</Text>
            <View style={styles.totals} testID="activity-day-totals">
              {point.earned !== 0 && (
                <Text style={[Typography.body, styles.earned]}>
                  Earned {formatDrinks(point.earned)}
                </Text>
              )}
              {point.drunk !== 0 && (
                <Text style={[Typography.body, styles.drunk]}>
                  Drunk {formatDrinks(point.drunk)}
                </Text>
              )}
            </View>
          </>
        )}
        <View
          style={{ minHeight: query.data ? undefined : detailsHeight }}
          onLayout={(event) => {
            if (query.data) setDetailsHeight(event.nativeEvent.layout.height);
          }}
          testID="activity-day-details"
        >
          {query.isError ? (
            <View style={styles.section}>
              <Text style={Typography.bodySecondary} accessibilityRole="alert">
                Could not load this day's activity.
              </Text>
              <Button title="Retry day" variant="secondary" onPress={() => void query.refetch()} />
            </View>
          ) : !query.data ? (
            <Text style={Typography.bodySecondary} accessibilityLiveRegion="polite">
              Loading day…
            </Text>
          ) : query.data.entries.length === 0 ? (
            <Text style={Typography.bodySecondary}>No drinks or workouts logged on this day.</Text>
          ) : (
            <View style={styles.section}>
              {sessions.length > 0 && (
                <Text style={styles.heading}>Workouts ({sessions.length})</Text>
              )}
              {sessions.map((session) => (
                <Pressable
                  key={session.id}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${session.workoutName} session`}
                  onPress={() =>
                    router.push({ pathname: '/sessions/[id]', params: { id: session.id } })
                  }
                  style={styles.entry}
                >
                  <View style={styles.entryHeading}>
                    <Text style={[Typography.body, styles.flex]}>{session.workoutName}</Text>
                    <Text style={[Typography.body, styles.earned]}>
                      +{formatDrinks(session.earnedDrinks)}
                    </Text>
                  </View>
                  <Text style={Typography.caption}>
                    {session.setCount} {session.setCount === 1 ? 'set' : 'sets'} logged
                    {session.endedAt === null ? ' · In progress' : ''}
                  </Text>
                  {session.note && <Text style={Typography.bodySecondary}>{session.note}</Text>}
                </Pressable>
              ))}
              {drinks.length > 0 && <Text style={styles.heading}>Drinks ({drinks.length})</Text>}
              {drinks.map((drink) => (
                <View key={drink.id} style={styles.entry}>
                  <View style={styles.entryHeading}>
                    <Text style={[Typography.body, styles.flex]}>
                      {drink.containerName ?? 'Custom drink'}
                    </Text>
                    <Text style={[Typography.body, styles.drunk]}>
                      −{formatDrinks(drink.stdDrinks)}
                    </Text>
                  </View>
                  <Text style={Typography.caption}>
                    {formatTime(drink.at)} · {formatVolume(drink.volumeMl, units)} · {drink.abv}%
                  </Text>
                  {drink.note && <Text style={Typography.bodySecondary}>{drink.note}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  heading: { ...Typography.body, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  entryHeading: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  day: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  entry: { minHeight: 44, gap: Spacing.xs, paddingVertical: Spacing.sm },
  earned: { color: Colors.earned },
  drunk: { color: Colors.drunk },
});
