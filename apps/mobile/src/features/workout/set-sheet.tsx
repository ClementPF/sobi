import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Exercise, Metric, SetValues, Units } from '@/api/types';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { DrumPicker, rangeItems, type DrumItem } from '@/components/drum-picker';
import {
  earnedDrinks,
  formatSet,
  formatDrinks,
  KG_PER_LB,
  METERS_PER_MILE,
  roundTo,
  weightUnit,
} from '@/lib/conversions';
import { Colors, Palette, Spacing, Typography } from '@/theme';

interface DrumSpec {
  label: string;
  items: DrumItem<number>[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const DRUMS: Record<Metric, DrumSpec[]> = {
  count: [{ label: 'reps', items: rangeItems(1, 500) }],
  seconds: [
    { label: 'min', items: rangeItems(0, 59) },
    { label: 'sec', items: rangeItems(0, 59, 1, pad2) },
  ],
  meters: [
    { label: 'km', items: rangeItems(0, 50) },
    { label: '100 m', items: rangeItems(0, 9, 1, (v) => String(v * 100)) },
  ],
};

const IMPERIAL_DISTANCE: DrumSpec[] = [
  { label: 'mi', items: rangeItems(0, 30) },
  { label: 'tenths', items: rangeItems(0, 9, 1, (v) => `.${v}`) },
];

function drumsFor(metric: Metric, units: Units): DrumSpec[] {
  return metric === 'meters' && units === 'imperial' ? IMPERIAL_DISTANCE : DRUMS[metric];
}

/** Drum positions for an amount (reps, seconds or meters) in the user's units. */
export function splitAmount(metric: Metric, amount: number, units: Units = 'metric'): number[] {
  if (metric === 'seconds') return [Math.min(Math.floor(amount / 60), 59), amount % 60];
  if (metric === 'meters' && units === 'imperial') {
    const tenths = Math.min(Math.round((amount / METERS_PER_MILE) * 10), 309);
    return [Math.floor(tenths / 10), tenths % 10];
  }
  if (metric === 'meters') {
    return [Math.min(Math.floor(amount / 1000), 50), Math.floor((amount % 1000) / 100)];
  }
  return [Math.min(Math.max(amount, 1), 500)];
}

/** The amount the API stores (reps, seconds or whole meters) for drum positions. */
export function composeAmount(metric: Metric, parts: number[], units: Units = 'metric'): number {
  const [a = 0, b = 0] = parts;
  if (metric === 'seconds') return a * 60 + b;
  if (metric === 'meters' && units === 'imperial') {
    return Math.round((a + b / 10) * METERS_PER_MILE);
  }
  if (metric === 'meters') return a * 1000 + b * 100;
  return a;
}

/**
 * The weight drum counts in steps (0.5 kg or 2.5 lb) so its values stay integers; step 0 is a
 * bodyweight set.
 */
const WEIGHT_STEP: Record<Units, number> = { metric: 0.5, imperial: 2.5 };
const WEIGHT_MAX_STEPS: Record<Units, number> = { metric: 600, imperial: 280 };

function weightDrum(units: Units): DrumSpec {
  const step = WEIGHT_STEP[units];
  return {
    label: weightUnit(units),
    items: rangeItems(0, WEIGHT_MAX_STEPS[units], 1, (v) => (v === 0 ? '—' : String(v * step))),
  };
}

/** Weight drum position for a weight in kg (null: bodyweight). */
export function weightToStep(weightKg: number | null, units: Units = 'metric'): number {
  if (!weightKg || weightKg <= 0) return 0;
  const value = units === 'imperial' ? weightKg / KG_PER_LB : weightKg;
  return Math.min(Math.max(Math.round(value / WEIGHT_STEP[units]), 0), WEIGHT_MAX_STEPS[units]);
}

/** The weight in kg the API stores for a weight drum position; null for bodyweight. */
export function stepToWeight(step: number, units: Units = 'metric'): number | null {
  if (step <= 0) return null;
  const value = step * WEIGHT_STEP[units];
  return roundTo(units === 'imperial' ? value * KG_PER_LB : value, 3);
}

const DEFAULT_AMOUNT: Record<Metric, number> = { count: 10, seconds: 60, meters: 1000 };

export interface SetSheetProps {
  exercise: Exercise | null;
  /** The last set logged for this exercise, used as the starting position. */
  last?: SetValues | null;
  saving: boolean;
  onLog(values: SetValues): void;
  onClose(): void;
}

export function SetSheet({ exercise, last, saving, onLog, onClose }: SetSheetProps) {
  return (
    <Modal visible={exercise !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {exercise && (
        <SetSheetBody
          key={exercise.id}
          exercise={exercise}
          initial={last ?? { amount: DEFAULT_AMOUNT[exercise.metric], weightKg: null }}
          saving={saving}
          onLog={onLog}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function SetSheetBody({
  exercise,
  initial,
  saving,
  onLog,
  onClose,
}: {
  exercise: Exercise;
  initial: SetValues;
  saving: boolean;
  onLog(values: SetValues): void;
  onClose(): void;
}) {
  const units = useUnits();
  const [parts, setParts] = useState(() => splitAmount(exercise.metric, initial.amount, units));
  const [weightStep, setWeightStep] = useState(() => weightToStep(initial.weightKg, units));
  const amount = composeAmount(exercise.metric, parts, units);
  const weightKg = stepToWeight(weightStep, units);
  const earned = earnedDrinks(amount, exercise.earnDrinks, exercise.earnPer);
  const weight = weightDrum(units);

  return (
    <View style={styles.sheet} testID="set-sheet">
      <Text style={Typography.title}>{exercise.name}</Text>
      <View style={styles.drums}>
        {drumsFor(exercise.metric, units).map((drum, i) => (
          <DrumPicker
            key={drum.label}
            label={drum.label}
            items={drum.items}
            value={parts[i] ?? 0}
            onChange={(v) => setParts((prev) => prev.map((p, j) => (j === i ? v : p)))}
          />
        ))}
        <DrumPicker
          label={weight.label}
          items={weight.items}
          value={weightStep}
          onChange={setWeightStep}
        />
      </View>
      <Text style={styles.preview}>
        {formatSet(exercise.metric, { amount, weightKg }, units)} → +{formatDrinks(earned)} drinks
      </Text>
      <View style={styles.actions}>
        <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex} />
        <Button
          title="Log set"
          loading={saving}
          disabled={amount < 1}
          onPress={() => onLog({ amount, weightKg })}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    ...Palette.card,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  drums: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
  preview: { ...Typography.body, textAlign: 'center', color: Colors.earned, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
});
