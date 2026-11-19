import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Units } from '@/api/types';

import { useSession, useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { versionLabel } from '@/lib/app-info';
import { formatVolume } from '@/lib/conversions';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: 'metric', label: 'Metric (ml, km)' },
  { value: 'imperial', label: 'Imperial (fl oz, mi)' },
];

function UnitsSwitch() {
  const { user, setUnits } = useSession();
  const current = user?.units ?? 'metric';
  const [pending, setPending] = useState<Units | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (units: Units) => {
    if (units === current || pending) return;
    setError(null);
    setPending(units);
    try {
      await setUnits(units);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your units.');
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.unitsBox}>
      <Text style={styles.sectionTitle}>Units</Text>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel="Units">
        {UNIT_OPTIONS.map(({ value, label }) => {
          const selected = (pending ?? current) === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityState={{
                checked: selected,
                disabled: pending !== null,
                busy: pending === value,
              }}
              accessibilityLabel={label}
              disabled={pending !== null}
              onPress={() => void choose(value)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[Typography.body, styles.flex, selected && styles.bold]}>{label}</Text>
              {selected && <Icon name="check" />}
            </Pressable>
          );
        })}
      </View>
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

export function SettingsScreen() {
  const units = useUnits();
  const { user, logout } = useSession();
  const [pending, setPending] = useState(false);

  const onLogout = async () => {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
    }
  };

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Account</Text>
        {user && <Text style={Typography.bodySecondary}>{user.email ?? user.name}</Text>}
      </View>
      <UnitsSwitch />
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>What is a standard drink?</Text>
        <Text style={styles.note}>
          One standard drink is 14 g of alcohol (US definition): about a {formatVolume(355, units)}{' '}
          beer at 5%, a {formatVolume(148, units)} glass of wine at 12% or a{' '}
          {formatVolume(44, units)} shot at 40%.
        </Text>
      </View>
      <Button
        title="Log out"
        variant="secondary"
        loading={pending}
        onPress={() => void onLogout()}
      />
      <Text style={styles.version}>{versionLabel()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, gap: Spacing.sm },
  sectionTitle: { ...Typography.body, fontWeight: '700' },
  note: { ...Typography.bodySecondary, lineHeight: 24 },
  version: { ...Typography.caption, textAlign: 'center' },
  unitsBox: { ...Palette.card, gap: Spacing.sm },
  segments: { gap: Spacing.sm },
  flex: { flex: 1 },
  segment: {
    flexDirection: 'row',
    gap: Spacing.sm,
    minHeight: 48,
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segmentSelected: { borderColor: Colors.accent, backgroundColor: Colors.surfaceRaised },
  bold: { fontWeight: '700' },
  error: { ...Typography.body, color: Colors.error },
});
