import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { deleteDrink, deleteSession, getHistory } from '@/api/endpoints';
import type { HistoryDay, HistoryEntry, Units } from '@/api/types';
import { useUnits } from '@/auth/session';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { formatDrinks, formatSigned, formatVolume } from '@/lib/conversions';
import { queryKeys, useInvalidateTotals } from '@/lib/queries';
import { deviceTimeZone, formatDay, formatTime } from '@/lib/time';
import { Colors, Palette, Spacing, Typography } from '@/theme';

function describe(
  entry: HistoryEntry,
  units: Units,
): { title: string; detail: string; amount: number } {
  if (entry.type === 'session') {
    return {
      title: entry.workoutName,
      detail: `${entry.setCount} set${entry.setCount === 1 ? '' : 's'}${entry.endedAt ? '' : ' · in progress'}`,
      amount: entry.earnedDrinks,
    };
  }
  return {
    title: entry.containerName ?? 'Drink',
    detail: `${formatVolume(entry.volumeMl, units)} · ${entry.abv}% · ${formatDrinks(entry.alcoholG)} g`,
    amount: -entry.stdDrinks,
  };
}

function EntryRow({ entry, onDelete }: { entry: HistoryEntry; onDelete(): void }) {
  const ref = useRef<SwipeableMethods>(null);
  const { title, detail, amount } = describe(entry, useUnits());
  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${title}`}
          style={styles.deleteAction}
          onPress={() => {
            ref.current?.close();
            onDelete();
          }}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      )}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          entry.type === 'session'
            ? router.push({ pathname: '/sessions/[id]', params: { id: entry.id } })
            : undefined
        }
        onLongPress={onDelete}
        style={styles.entry}
        testID={`history-${entry.type}-${entry.id}`}
      >
        <Text style={styles.time}>{formatTime(entry.at)}</Text>
        <View style={styles.flex}>
          <Text style={Typography.body}>{title}</Text>
          <Text style={Typography.caption}>{detail}</Text>
        </View>
        <Text style={[styles.amount, { color: amount < 0 ? Colors.drunk : Colors.earned }]}>
          {formatSigned(amount)}
        </Text>
      </Pressable>
    </Swipeable>
  );
}

function DayHeader({ day }: { day: HistoryDay }) {
  return (
    <View style={styles.dayHeader}>
      <Text style={[Typography.body, styles.flex, styles.bold]}>{formatDay(day.date)}</Text>
      {day.earned > 0 && <Text style={styles.earned}>{formatSigned(day.earned)}</Text>}
      {day.drunk > 0 && <Text style={styles.drunk}>{formatSigned(-day.drunk)}</Text>}
    </View>
  );
}

export function HistoryScreen() {
  const invalidate = useInvalidateTotals();
  const [pending, setPending] = useState<HistoryEntry | null>(null);
  const query = useInfiniteQuery({
    queryKey: queryKeys.history,
    queryFn: ({ pageParam }) => getHistory(deviceTimeZone(), pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (entry: HistoryEntry) =>
      entry.type === 'session' ? deleteSession(entry.id) : deleteDrink(entry.id),
    onSuccess: async () => {
      setPending(null);
      await invalidate();
    },
  });

  if (query.isPending) return <CenteredLoading />;
  if (query.isError) {
    return (
      <EmptyState
        title="Could not load your history."
        actionTitle="Try again"
        onAction={() => void query.refetch()}
      />
    );
  }

  const sections = query.data.pages.flatMap((page) =>
    page.days.map((day) => ({ day, key: day.date, data: day.entries })),
  );

  return (
    <View style={Palette.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(entry) => `${entry.type}-${entry.id}`}
        renderSectionHeader={({ section }) => <DayHeader day={section.day} />}
        renderItem={({ item }) => <EntryRow entry={item} onDelete={() => setPending(item)} />}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.list}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => void query.refetch()}
            tintColor={Colors.text}
          />
        }
        ListEmptyComponent={
          <EmptyState title="Nothing yet. Log a workout or a drink and it shows up here." />
        }
        ListFooterComponent={
          query.isFetchingNextPage ? <CenteredLoading /> : <View style={styles.footer} />
        }
      />
      <ConfirmDialog
        visible={pending !== null}
        title={pending?.type === 'session' ? 'Delete session?' : 'Delete drink?'}
        message={
          pending?.type === 'session'
            ? 'Its sets and the drinks they earned are removed from your balance.'
            : 'It is removed from your balance.'
        }
        confirmTitle="Delete"
        loading={remove.isPending}
        onConfirm={() => pending && remove.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { width: '100%', maxWidth: 640, alignSelf: 'center', flexGrow: 1 },
  dayHeader: {
    userSelect: 'none',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  entry: {
    userSelect: 'none',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  time: { ...Typography.caption, width: 48 },
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  amount: { ...Typography.body, fontWeight: '700' },
  earned: { ...Typography.body, color: Colors.earned, fontWeight: '700' },
  drunk: { ...Typography.body, color: Colors.drunk, fontWeight: '700' },
  deleteAction: {
    backgroundColor: Colors.error,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  deleteText: { ...Typography.body, fontWeight: '700' },
  footer: { height: Spacing.xl },
});
