import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Units } from '@/api/types';

import { useSession, useUnits } from '@/auth/session';
import { Button } from '@/components/button';
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
      <Text style={Typography.caption}>UNITS</Text>
      <View style={styles.segments} accessibilityRole="radiogroup">
        {UNIT_OPTIONS.map(({ value, label }) => {
          const selected = (pending ?? current) === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => void choose(value)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[Typography.body, selected && styles.bold]}>{label}</Text>
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
    <View style={styles.container}>
      <View style={styles.content}>
        {user && (
          <Text style={Typography.bodySecondary}>Signed in as {user.email ?? user.name}</Text>
        )}
        <UnitsSwitch />
        <Text style={[Typography.caption, styles.note]}>
          One standard drink is 14 g of alcohol (US definition): about a {formatVolume(355, units)}{' '}
          beer at 5%, a {formatVolume(148, units)} glass of wine at 12% or a{' '}
          {formatVolume(44, units)} shot at 40%.
        </Text>
        <Button
          title="Log out"
          loading={pending}
          onPress={() => void onLogout()}
          style={styles.button}
        />
      </View>
      <Text style={styles.version}>{versionLabel()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...Palette.screen, padding: Spacing.md },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  note: { maxWidth: 360, textAlign: 'center' },
  button: { width: 300, maxWidth: '100%' },
  version: { ...Typography.caption, textAlign: 'center' },
  unitsBox: { width: 300, maxWidth: '100%', gap: Spacing.xs },
  segments: { flexDirection: 'row', gap: Spacing.sm },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segmentSelected: { borderColor: Colors.accent, backgroundColor: Colors.surfaceRaised },
  bold: { fontWeight: '700' },
  error: { ...Typography.body, color: Colors.error },
});
