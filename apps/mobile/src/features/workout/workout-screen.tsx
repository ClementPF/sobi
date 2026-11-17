import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  deleteSession,
  deleteSet,
  duplicateWorkout,
  endSession,
  getActiveSession,
  listWorkouts,
  logSet,
  startSession,
  updateSessionNote,
} from '@/api/endpoints';
import type { Exercise, SessionDetail, SetEntry, SetValues, Workout } from '@/api/types';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { NoteField } from '@/components/note-field';
import { formatDrinks, formatRate, formatSet } from '@/lib/conversions';
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
  const duplicate = useMutation({
    mutationFn: duplicateWorkout,
    onSuccess: async (copy) => {
      await client.invalidateQueries({ queryKey: queryKeys.workouts });
      // Open the copy so it can be renamed and adjusted straight away.
      router.push({ pathname: '/workouts/[id]', params: { id: copy.id } });
    },
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
              accessibilityLabel={`Duplicate ${workout.name}`}
              disabled={duplicate.isPending}
              onPress={() => duplicate.mutate(workout.id)}
              hitSlop={8}
            >
              <Text style={[styles.link, duplicate.isPending && styles.muted]}>
                {duplicate.isPending && duplicate.variables === workout.id
                  ? 'Duplicating…'
                  : 'Duplicate'}
              </Text>
            </Pressable>
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
      <ErrorText error={start.error ?? duplicate.error} />
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
  lastSet,
  onAddSet,
  onRepeatSet,
  onRemoveSet,
  disabled,
}: {
  exercise: SessionDetail['exercises'][number];
  lastSet: SetValues | null;
  onAddSet(): void;
  onRepeatSet(values: SetValues): void;
  onRemoveSet(set: SetEntry): void;
  disabled: boolean;
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
            accessibilityLabel={`Remove set ${formatSet(exercise.metric, set, units)}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onRemoveSet(set)}
            style={styles.chip}
          >
            <Text style={Typography.body}>{formatSet(exercise.metric, set, units)}</Text>
          </Pressable>
        ))}
        {!exercise.archived && (
          <View style={styles.row}>
            {lastSet !== null && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Repeat ${formatSet(exercise.metric, lastSet, units)} of ${exercise.name}`}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => onRepeatSet(lastSet)}
                style={[styles.chip, styles.addChip, disabled && styles.inactive]}
              >
                <Text style={[Typography.body, styles.bold]}>
                  + {formatSet(exercise.metric, lastSet, units)}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add set of ${exercise.name}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={onAddSet}
              style={[styles.chip, styles.addChip, disabled && styles.inactive]}
            >
              <Text style={[Typography.body, styles.bold]}>+ Set</Text>
            </Pressable>
          </View>
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
  const [confirmCancel, setConfirmCancel] = useState(false);

  const refresh = async () => {
    await invalidate();
  };

  const log = useMutation({
    mutationFn: (input: { exerciseId: string } & SetValues) => logSet(session.id, input),
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
  const cancel = useMutation({
    mutationFn: () => deleteSession(session.id),
    onSuccess: async () => {
      setConfirmCancel(false);
      client.setQueryData(queryKeys.activeSession, null);
      await refresh();
    },
  });
  const busy =
    log.isPending || remove.isPending || saveNote.isPending || end.isPending || cancel.isPending;

  /** This session's last set of the exercise, else the last one from an earlier session. */
  const lastSet = (exercise: Exercise): SetValues | null => {
    const current = session.exercises.find((e) => e.id === exercise.id);
    const set = current?.sets.at(-1);
    return set ? { amount: set.amount, weightKg: set.weightKg } : (current?.previousSet ?? null);
  };

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
            lastSet={lastSet(exercise)}
            onAddSet={() => setSheetFor(exercise)}
            onRepeatSet={(values) => log.mutate({ exerciseId: exercise.id, ...values })}
            onRemoveSet={setRemoving}
            disabled={busy}
          />
        ))}
        <NoteField
          value={session.note}
          onSave={(note) => saveNote.mutate(note)}
          saving={saveNote.isPending}
          placeholder="Session note"
        />
        <ErrorText
          error={
            log.error ??
            remove.error ??
            end.error ??
            (confirmCancel ? null : cancel.error) ??
            saveNote.error
          }
        />
        <Button
          title="End session"
          disabled={busy}
          onPress={() => (session.setCount === 0 ? cancel.mutate() : setConfirmEnd(true))}
        />
        <Button
          title="Cancel workout"
          variant="secondary"
          loading={cancel.isPending}
          disabled={busy}
          onPress={() => (session.setCount === 0 ? cancel.mutate() : setConfirmCancel(true))}
        />
      </ScrollView>
      <SetSheet
        exercise={sheetFor}
        last={sheetFor ? lastSet(sheetFor) : null}
        saving={log.isPending}
        onLog={(values) => sheetFor && log.mutate({ exerciseId: sheetFor.id, ...values })}
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
        visible={confirmCancel}
        title="Cancel workout?"
        message="This session and all its sets will be deleted. The drinks they earned will be removed from your balance."
        confirmTitle="Discard workout"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirmCancel(false)}
      >
        <ErrorText error={cancel.error} />
      </ConfirmDialog>
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
  if (active.data) return <ActiveSession key={active.data.id} session={active.data} />;
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
  muted: { opacity: 0.5 },
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
  inactive: { opacity: 0.5 },
  error: { ...Typography.body, color: Colors.error },
});
