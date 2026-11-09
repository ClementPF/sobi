import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  deleteSet,
  endSession,
  getActiveSession,
  listWorkouts,
  logSet,
  startSession,
  updateSessionNote,
} from '@/api/endpoints';
import type { Exercise, SessionDetail, SetEntry, Workout } from '@/api/types';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { NoteField } from '@/components/note-field';
import { formatAmount, formatDrinks, formatRate } from '@/lib/conversions';
import { queryKeys, useInvalidateTotals } from '@/lib/queries';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { SetSheet } from './set-sheet';

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong.';
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {messageOf(error)}
    </Text>
  );
}

function WorkoutPicker({ workouts }: { workouts: Workout[] }) {
  const units = useUnits();
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: startSession,
    onSuccess: (session) => client.setQueryData(queryKeys.activeSession, session),
  });

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.container}>
      <Text style={Typography.title}>Pick a workout</Text>
      {workouts.length === 0 && (
        <Text style={Typography.bodySecondary}>
          Create a workout first: its exercises and how many drinks each one earns.
        </Text>
      )}
      {workouts.map((workout) => (
        <View key={workout.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={[Typography.body, styles.bold, styles.flex]}>{workout.name}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${workout.name}`}
              onPress={() =>
                router.push({ pathname: '/workouts/[id]', params: { id: workout.id } })
              }
              hitSlop={8}
            >
              <Text style={styles.link}>Edit</Text>
            </Pressable>
          </View>
          {workout.exercises.map((e) => (
            <Text key={e.id} style={Typography.caption}>
              {e.name} · {formatRate(e.metric, e.earnDrinks, e.earnPer, units)}
            </Text>
          ))}
          <Button
            title="Start"
            loading={start.isPending && start.variables === workout.id}
            disabled={start.isPending || workout.exercises.length === 0}
            onPress={() => start.mutate(workout.id)}
          />
        </View>
      ))}
      <ErrorText error={start.error} />
      <Button
        title="New workout"
        variant="secondary"
        onPress={() => router.push('/workouts/new')}
      />
    </ScrollView>
  );
}

function ExerciseCard({
  exercise,
  onAddSet,
  onRemoveSet,
}: {
  exercise: Exercise & { sets: SetEntry[] };
  onAddSet(): void;
  onRemoveSet(set: SetEntry): void;
}) {
  const units = useUnits();
  const earned = exercise.sets.reduce((sum, s) => sum + s.earnedDrinks, 0);
  return (
    <View style={styles.card} testID={`exercise-${exercise.id}`}>
      <View style={styles.row}>
        <Text style={[Typography.body, styles.bold, styles.flex]}>{exercise.name}</Text>
        <Text style={styles.earned}>+{formatDrinks(earned)}</Text>
      </View>
      <Text style={Typography.caption}>
        {formatRate(exercise.metric, exercise.earnDrinks, exercise.earnPer, units)}
      </Text>
      <View style={styles.chips}>
        {exercise.sets.map((set) => (
          <Pressable
            key={set.id}
            accessibilityRole="button"
            accessibilityLabel={`Remove set ${formatAmount(exercise.metric, set.amount, units)}`}
            onPress={() => onRemoveSet(set)}
            style={styles.chip}
          >
            <Text style={Typography.body}>{formatAmount(exercise.metric, set.amount, units)}</Text>
          </Pressable>
        ))}
        {!exercise.archived && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add set of ${exercise.name}`}
            onPress={onAddSet}
            style={[styles.chip, styles.addChip]}
          >
            <Text style={[Typography.body, styles.bold]}>+ Set</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ActiveSession({ session }: { session: SessionDetail }) {
  const client = useQueryClient();
  const invalidate = useInvalidateTotals();
  const [sheetFor, setSheetFor] = useState<Exercise | null>(null);
  const [removing, setRemoving] = useState<SetEntry | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const refresh = async () => {
    await invalidate();
  };

  const log = useMutation({
    mutationFn: (amount: number) => logSet(session.id, { exerciseId: sheetFor!.id, amount }),
    onSuccess: async () => {
      setSheetFor(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (set: SetEntry) => deleteSet(set.id),
    onSuccess: async () => {
      setRemoving(null);
      await refresh();
    },
  });
  const saveNote = useMutation({
    mutationFn: (note: string | null) => updateSessionNote(session.id, note),
    onSuccess: async (updated) => {
      client.setQueryData(queryKeys.activeSession, updated);
      await refresh();
    },
  });
  const end = useMutation({
    mutationFn: () => endSession(session.id),
    onSuccess: async () => {
      setConfirmEnd(false);
      client.setQueryData(queryKeys.activeSession, null);
      await refresh();
    },
  });

  const lastAmount = (exercise: Exercise) =>
    session.exercises.find((e) => e.id === exercise.id)?.sets.at(-1)?.amount;

  return (
    <View style={Palette.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={Typography.title}>{session.workout.name}</Text>
          <Text style={styles.total} testID="session-earned">
            +{formatDrinks(session.earnedDrinks)} drinks earned
          </Text>
        </View>
        {session.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            onAddSet={() => setSheetFor(exercise)}
            onRemoveSet={setRemoving}
          />
        ))}
        <NoteField
          value={session.note}
          onSave={(note) => saveNote.mutate(note)}
          saving={saveNote.isPending}
          placeholder="Session note"
        />
        <ErrorText error={log.error ?? remove.error ?? end.error ?? saveNote.error} />
        <Button title="End session" onPress={() => setConfirmEnd(true)} />
      </ScrollView>
      <SetSheet
        exercise={sheetFor}
        lastAmount={sheetFor ? lastAmount(sheetFor) : undefined}
        saving={log.isPending}
        onLog={(amount) => log.mutate(amount)}
        onClose={() => setSheetFor(null)}
      />
      <ConfirmDialog
        visible={removing !== null}
        title="Remove set?"
        message={`It earned ${formatDrinks(removing?.earnedDrinks ?? 0)} drinks.`}
        confirmTitle="Remove"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        visible={confirmEnd}
        title="End session?"
        message={`You earned ${formatDrinks(session.earnedDrinks)} drinks in ${session.setCount} sets.`}
        confirmTitle="End"
        loading={end.isPending}
        onConfirm={() => end.mutate()}
        onCancel={() => setConfirmEnd(false)}
      />
    </View>
  );
}

export function WorkoutScreen() {
  const active = useQuery({ queryKey: queryKeys.activeSession, queryFn: getActiveSession });
  const workouts = useQuery({
    queryKey: queryKeys.workouts,
    queryFn: listWorkouts,
    enabled: active.isSuccess && active.data === null,
  });

  if (active.isPending) return <CenteredLoading />;
  if (active.isError) {
    return (
      <EmptyState
        title="Could not load your session."
        actionTitle="Try again"
        onAction={() => void active.refetch()}
      />
    );
  }
  if (active.data) return <ActiveSession session={active.data} />;
  if (workouts.isPending) return <CenteredLoading />;
  if (workouts.isError) {
    return (
      <EmptyState
        title="Could not load your workouts."
        actionTitle="Try again"
        onAction={() => void workouts.refetch()}
      />
    );
  }
  return <WorkoutPicker workouts={workouts.data} />;
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.md,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  header: { gap: Spacing.xs },
  total: { ...Typography.body, color: Colors.earned, fontWeight: '700', fontSize: 20 },
  card: { ...Palette.card, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  link: { ...Typography.body, color: Colors.accent, fontWeight: '700' },
  earned: { ...Typography.body, color: Colors.earned, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addChip: { borderColor: Colors.accent },
  error: { ...Typography.body, color: Colors.error },
});
