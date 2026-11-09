import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  addExercise,
  createWorkout,
  deleteExercise,
  deleteWorkout,
  getWorkout,
  renameWorkout,
  updateExercise,
} from '@/api/endpoints';
import type { ExerciseInput, Metric, Units, Workout } from '@/api/types';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { displayEarnPer, METRIC_LABELS, metricUnit, parseEarnPer } from '@/lib/conversions';
import { queryKeys } from '@/lib/queries';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

export interface Row {
  key: string;
  id?: string;
  name: string;
  metric: Metric;
  earnDrinks: string;
  earnPer: string;
  /** The stored rate, kept while its displayed text is untouched so a miles round trip can't drift it. */
  saved?: { metric: Metric; earnPer: number; text: string };
}

const METRICS: Metric[] = ['count', 'seconds', 'meters'];

function defaultPer(metric: Metric, units: Units): string {
  if (metric === 'count') return '100';
  if (metric === 'seconds') return '60';
  return units === 'imperial' ? '1' : '1000';
}

let rowSeq = 0;
const newRow = (): Row => ({
  key: `new-${++rowSeq}`,
  name: '',
  metric: 'count',
  earnDrinks: '1',
  earnPer: defaultPer('count', 'metric'),
});

/** The exercise a row describes, or an error message when a field is invalid. */
export function parseRow(row: Row, units: Units = 'metric'): ExerciseInput | string {
  const name = row.name.trim();
  if (!name) return 'Every exercise needs a name.';
  const earnDrinks = Number(row.earnDrinks.replace(',', '.'));
  if (!Number.isFinite(earnDrinks) || earnDrinks < 0 || earnDrinks > 100) {
    return `${name}: drinks must be between 0 and 100.`;
  }
  const unchanged = row.saved?.metric === row.metric && row.saved.text === row.earnPer;
  const earnPer = unchanged ? row.saved!.earnPer : parseEarnPer(row.metric, row.earnPer, units);
  if (earnPer === null) {
    return row.metric === 'meters' && units === 'imperial'
      ? `${name}: the distance must be a positive number of miles.`
      : `${name}: the unit count must be a whole number of at least 1.`;
  }
  return { name, metric: row.metric, earnDrinks, earnPer };
}

function rowsOf(workout: Workout, units: Units): Row[] {
  return workout.exercises.map((e) => {
    const text = String(displayEarnPer(e.metric, e.earnPer, units));
    return {
      key: e.id,
      id: e.id,
      name: e.name,
      metric: e.metric,
      earnDrinks: String(e.earnDrinks),
      earnPer: text,
      saved: { metric: e.metric, earnPer: e.earnPer, text },
    };
  });
}

async function save(workout: Workout | undefined, name: string, rows: Row[], units: Units) {
  const parsed = rows.map((row) => parseRow(row, units));
  const invalid = parsed.find((p): p is string => typeof p === 'string');
  if (invalid) throw new Error(invalid);
  const inputs = parsed as ExerciseInput[];
  if (!workout) return createWorkout({ name, exercises: inputs });

  if (name !== workout.name) await renameWorkout(workout.id, name);
  const kept = new Set(rows.map((r) => r.id).filter(Boolean));
  for (const e of workout.exercises) {
    if (!kept.has(e.id)) await deleteExercise(workout.id, e.id);
  }
  for (const [i, row] of rows.entries()) {
    const input = inputs[i]!;
    const original = workout.exercises.find((e) => e.id === row.id);
    if (!original) {
      await addExercise(workout.id, input);
    } else if (
      original.name !== input.name ||
      original.metric !== input.metric ||
      original.earnDrinks !== input.earnDrinks ||
      original.earnPer !== input.earnPer
    ) {
      await updateExercise(workout.id, original.id, input);
    }
  }
  return getWorkout(workout.id);
}

function ExerciseRow({
  row,
  units,
  onChange,
  onRemove,
}: {
  row: Row;
  units: Units;
  onChange(row: Row): void;
  onRemove(): void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.rowLine}>
        <TextInput
          accessibilityLabel="Exercise name"
          value={row.name}
          onChangeText={(name) => onChange({ ...row, name })}
          placeholder="Exercise, e.g. Push-ups"
          placeholderTextColor={Colors.textMuted}
          style={[styles.input, styles.flex]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove exercise"
          onPress={onRemove}
        >
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      </View>
      <View style={styles.segments}>
        {METRICS.map((metric) => (
          <Pressable
            key={metric}
            accessibilityRole="radio"
            accessibilityState={{ selected: row.metric === metric }}
            onPress={() =>
              onChange({
                ...row,
                metric,
                earnPer: row.metric === metric ? row.earnPer : defaultPer(metric, units),
              })
            }
            style={[styles.segment, row.metric === metric && styles.segmentSelected]}
          >
            <Text style={Typography.body}>{METRIC_LABELS[metric]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.rowLine}>
        <Text style={Typography.bodySecondary}>Earn</Text>
        <TextInput
          accessibilityLabel="Drinks earned"
          value={row.earnDrinks}
          onChangeText={(earnDrinks) => onChange({ ...row, earnDrinks })}
          keyboardType="decimal-pad"
          style={[styles.input, styles.number]}
        />
        <Text style={Typography.bodySecondary}>drink(s) per</Text>
        <TextInput
          accessibilityLabel="Units per reward"
          value={row.earnPer}
          onChangeText={(earnPer) => onChange({ ...row, earnPer })}
          keyboardType={
            row.metric === 'meters' && units === 'imperial' ? 'decimal-pad' : 'number-pad'
          }
          style={[styles.input, styles.number]}
        />
        <Text style={Typography.bodySecondary}>{metricUnit(row.metric, units)}</Text>
      </View>
    </View>
  );
}

function Editor({ workout }: { workout?: Workout }) {
  const client = useQueryClient();
  const units = useUnits();
  const [name, setName] = useState(workout?.name ?? '');
  const [rows, setRows] = useState<Row[]>(() => (workout ? rowsOf(workout, units) : [newRow()]));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = async () => {
    await client.invalidateQueries({ queryKey: queryKeys.workouts });
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  };

  const saveMutation = useMutation({
    mutationFn: () => save(workout, name.trim(), rows, units),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => deleteWorkout(workout!.id),
    onSuccess: done,
  });

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.container}>
      <TextInput
        accessibilityLabel="Workout name"
        value={name}
        onChangeText={setName}
        placeholder="Workout name, e.g. Push day"
        placeholderTextColor={Colors.textMuted}
        style={[styles.input, styles.title]}
      />
      {rows.map((row) => (
        <ExerciseRow
          key={row.key}
          row={row}
          units={units}
          onChange={(next) => setRows((prev) => prev.map((r) => (r.key === row.key ? next : r)))}
          onRemove={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
        />
      ))}
      <Button
        title="Add exercise"
        variant="secondary"
        onPress={() => setRows((prev) => [...prev, newRow()])}
      />
      {saveMutation.error && (
        <Text style={styles.error} accessibilityRole="alert">
          {saveMutation.error.message}
        </Text>
      )}
      <Button
        title="Save"
        loading={saveMutation.isPending}
        disabled={!name.trim()}
        onPress={() => saveMutation.mutate()}
      />
      {workout && (
        <Button title="Delete workout" variant="secondary" onPress={() => setConfirmDelete(true)} />
      )}
      <Text style={Typography.caption}>
        Rate changes apply to sets logged from now on; past sets keep what they earned.
      </Text>
      <ConfirmDialog
        visible={confirmDelete}
        title="Delete workout?"
        message="Past sessions and what they earned are kept."
        confirmTitle="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </ScrollView>
  );
}

export function NewWorkoutScreen() {
  return <Editor />;
}

export function EditWorkoutScreen({ id }: { id: string }) {
  const query = useQuery({ queryKey: queryKeys.workout(id), queryFn: () => getWorkout(id) });
  if (query.isPending) return <CenteredLoading />;
  if (query.isError) return <EmptyState title="Workout not found." />;
  return <Editor key={query.data.id} workout={query.data} />;
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.md,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  card: { ...Palette.card, gap: Spacing.sm },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  input: {
    ...Typography.body,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  title: { fontSize: 20, fontWeight: '700' },
  number: { width: 72, textAlign: 'center' },
  remove: { ...Typography.body, color: Colors.error },
  segments: { flexDirection: 'row', gap: Spacing.sm },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segmentSelected: { borderColor: Colors.accent, backgroundColor: Colors.surfaceRaised },
  error: { ...Typography.body, color: Colors.error },
});
