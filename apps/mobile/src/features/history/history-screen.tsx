import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { deleteHistoryEntries, getHistory, updateDrinkNote } from '@/api/endpoints';
import type { HistoryDay, HistoryDrinkEntry, HistoryEntry, Units } from '@/api/types';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { NoteField } from '@/components/note-field';
import { formatDrinks, formatSigned, formatVolume } from '@/lib/conversions';
import { queryKeys, useInvalidateTotals } from '@/lib/queries';
import { deviceTimeZone, formatDay, formatTime } from '@/lib/time';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { selectionLabel } from './selection';

const keyOf = (entry: HistoryEntry) => `${entry.type}-${entry.id}`;

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

function EntryRow({
  entry,
  selecting,
  selected,
  onPress,
  onLongPress,
  onDelete,
}: {
  entry: HistoryEntry;
  selecting: boolean;
  selected: boolean;
  onPress(): void;
  onLongPress(): void;
  onDelete(): void;
}) {
  const ref = useRef<SwipeableMethods>(null);
  const { title, detail, amount } = describe(entry, useUnits());
  const row = (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.entry, selected && styles.entrySelected]}
      testID={`history-${entry.type}-${entry.id}`}
    >
      {selecting && (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected && <Text style={styles.checkMark}>✓</Text>}
        </View>
      )}
      <Text style={styles.time}>{formatTime(entry.at)}</Text>
      <View style={styles.flex}>
        <Text style={Typography.body}>{title}</Text>
        <Text style={Typography.caption}>{detail}</Text>
        {entry.note && (
          <Text style={styles.note} numberOfLines={2}>
            {entry.note}
          </Text>
        )}
      </View>
      <Text style={[styles.amount, { color: amount < 0 ? Colors.drunk : Colors.earned }]}>
        {formatSigned(amount)}
      </Text>
    </Pressable>
  );
  if (selecting) return row;
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
      {row}
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

function DrinkNoteSheet({ drink, onClose }: { drink: HistoryDrinkEntry | null; onClose(): void }) {
  const invalidate = useInvalidateTotals();
  const [note, setNote] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updateDrinkNote(drink!.id, (note ?? drink!.note ?? '').trim() || null),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Modal visible={drink !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={Typography.title}>Drink note</Text>
          <NoteField key={drink?.id} value={drink?.note ?? null} onChangeText={setNote} />
          {save.error && <Text style={styles.error}>{save.error.message}</Text>}
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onClose}
              disabled={save.isPending}
              style={styles.flex}
            />
            <Button
              title="Save"
              loading={save.isPending}
              onPress={() => save.mutate()}
              style={styles.flex}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function HistoryScreen() {
  const invalidate = useInvalidateTotals();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<string, HistoryEntry>>(new Map());
  const [pending, setPending] = useState<HistoryEntry[] | null>(null);
  const [editing, setEditing] = useState<HistoryDrinkEntry | null>(null);
  const query = useInfiniteQuery({
    queryKey: queryKeys.history,
    queryFn: ({ pageParam }) => getHistory(deviceTimeZone(), pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Map());
  };
  const remove = useMutation({
    mutationFn: (entries: HistoryEntry[]) =>
      deleteHistoryEntries({
        sessionIds: entries.filter((e) => e.type === 'session').map((e) => e.id),
        drinkIds: entries.filter((e) => e.type === 'drink').map((e) => e.id),
      }),
    onSuccess: async () => {
      setPending(null);
      stopSelecting();
      await invalidate();
    },
  });
  const toggle = (entry: HistoryEntry) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(keyOf(entry))) next.delete(keyOf(entry));
      else next.set(keyOf(entry), entry);
      return next;
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
  const hasEntries = sections.some((s) => s.data.length > 0);
  const chosen = [...selected.values()];
  const pendingSessions = pending?.some((e) => e.type === 'session') ?? false;

  return (
    <View style={Palette.screen}>
      {hasEntries && (
        <View style={styles.toolbar}>
          <Text style={[Typography.bodySecondary, styles.flex]}>
            {selecting ? `${chosen.length} selected` : ''}
          </Text>
          {selecting && (
            <Pressable
              accessibilityRole="button"
              disabled={chosen.length === 0}
              onPress={() => setPending(chosen)}
              hitSlop={8}
            >
              <Text style={[styles.toolbarDanger, chosen.length === 0 && styles.disabled]}>
                Delete
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => (selecting ? stopSelecting() : setSelecting(true))}
            hitSlop={8}
          >
            <Text style={styles.toolbarLink}>{selecting ? 'Cancel' : 'Select'}</Text>
          </Pressable>
        </View>
      )}
      <SectionList
        sections={sections}
        keyExtractor={keyOf}
        extraData={{ selecting, selected }}
        renderSectionHeader={({ section }) => <DayHeader day={section.day} />}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            selecting={selecting}
            selected={selected.has(keyOf(item))}
            onPress={() => {
              if (selecting) toggle(item);
              else if (item.type === 'session')
                router.push({ pathname: '/sessions/[id]', params: { id: item.id } });
              else setEditing(item);
            }}
            onLongPress={() => {
              if (!selecting) setSelecting(true);
              toggle(item);
            }}
            onDelete={() => setPending([item])}
          />
        )}
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
        title={`Delete ${pending ? selectionLabel(pending) : ''}?`}
        message={
          pendingSessions
            ? 'Sessions lose their sets and the drinks they earned. Everything is removed from your balance.'
            : 'It is removed from your balance.'
        }
        confirmTitle="Delete"
        loading={remove.isPending}
        onConfirm={() => pending && remove.mutate(pending)}
        onCancel={() => setPending(null)}
      >
        {remove.error && <Text style={styles.error}>{remove.error.message}</Text>}
      </ConfirmDialog>
      <DrinkNoteSheet drink={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { width: '100%', maxWidth: 640, alignSelf: 'center', flexGrow: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  toolbarLink: { ...Typography.body, color: Colors.accent, fontWeight: '700' },
  toolbarDanger: { ...Typography.body, color: Colors.error, fontWeight: '700' },
  disabled: { opacity: 0.4 },
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
  entrySelected: { backgroundColor: Colors.surfaceRaised },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  checkMark: { color: Colors.background, fontWeight: '700', fontSize: 13 },
  time: { ...Typography.caption, width: 48 },
  note: { ...Typography.caption, color: Colors.textSecondary, fontStyle: 'italic' },
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
  error: { ...Typography.body, color: Colors.error },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  dialog: { ...Palette.card, gap: Spacing.md, width: '100%', maxWidth: 520, alignSelf: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  footer: { height: Spacing.xl },
});
