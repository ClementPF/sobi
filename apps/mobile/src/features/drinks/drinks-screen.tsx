import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createContainer,
  deleteContainer,
  getDashboard,
  listContainers,
  logDrink,
  updateContainer,
} from '@/api/endpoints';
import type { Container, NewDrink, Units } from '@/api/types';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { DrumPicker, rangeItems } from '@/components/drum-picker';
import { CenteredLoading } from '@/components/list-parts';
import {
  convertDrink,
  formatDrinks,
  formatVolume,
  parseVolume,
  roundTo,
  volumeUnit,
  volumeValue,
} from '@/lib/conversions';
import { queryKeys, useInvalidateTotals } from '@/lib/queries';
import { deviceTimeZone } from '@/lib/time';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

const ABV_WHOLE = rangeItems(0, 80);
const ABV_TENTH = rangeItems(0, 9, 1, (v) => `.${v}`);
const HOURS = rangeItems(0, 23, 1, (v) => String(v).padStart(2, '0'));
const MINUTES = rangeItems(0, 55, 5, (v) => String(v).padStart(2, '0'));

/** How far back a drink can be logged. */
export const MAX_DAYS_AGO = 365;

type Volume = { kind: 'container'; container: Container } | { kind: 'custom'; text: string };
type When = { kind: 'now' } | { kind: 'at'; daysAgo: number; hour: number; minute: number };

export function volumeOf(volume: Volume | null, units: Units): number | null {
  if (!volume) return null;
  if (volume.kind === 'container') return volume.container.volumeMl;
  return parseVolume(volume.text, units);
}

/** "Today", "Yesterday", "Mon 3 Nov" or, in an earlier year, "Mon 3 Nov 2025". */
export function dayLabel(daysAgo: number, now = new Date()): string {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  const day = new Date(now);
  day.setDate(day.getDate() - daysAgo);
  return day.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** ISO time for a picked day and clock time, local to the device. */
export function consumedAtOf(when: When, now = new Date()): string | undefined {
  if (when.kind === 'now') return undefined;
  const at = new Date(now);
  at.setDate(at.getDate() - when.daysAgo);
  at.setHours(when.hour, when.minute, 0, 0);
  return at.toISOString();
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[Typography.body, selected && styles.bold]}>{label}</Text>
    </Pressable>
  );
}

function ContainerManager({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const client = useQueryClient();
  const units = useUnits();
  const unit = volumeUnit(units);
  const containers = useQuery({ queryKey: queryKeys.containers, queryFn: listContainers });
  const [name, setName] = useState('');
  const [ml, setMl] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.containers });

  const add = useMutation({
    mutationFn: () => createContainer({ name: name.trim(), volumeMl: newVolume! }),
    onSuccess: async () => {
      setName('');
      setMl('');
      await refresh();
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; volumeMl?: number }) =>
      updateContainer(id, body),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: deleteContainer, onSuccess: refresh });
  const newVolume = parseVolume(ml, units);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={Palette.screen} contentContainerStyle={styles.container}>
        <Text style={Typography.title}>Containers</Text>
        {containers.data?.map((c) => (
          <View key={`${c.id}-${units}`} style={styles.line}>
            <TextInput
              accessibilityLabel={`${c.name} name`}
              defaultValue={c.name}
              onEndEditing={(e) => {
                const next = e.nativeEvent.text.trim();
                if (next && next !== c.name) rename.mutate({ id: c.id, name: next });
              }}
              style={[styles.input, styles.flex]}
            />
            <TextInput
              accessibilityLabel={`${c.name} volume`}
              defaultValue={volumeValue(c.volumeMl, units)}
              keyboardType="decimal-pad"
              onEndEditing={(e) => {
                const text = e.nativeEvent.text;
                if (text === volumeValue(c.volumeMl, units)) return;
                const next = parseVolume(text, units);
                if (next !== null && next !== c.volumeMl) {
                  rename.mutate({ id: c.id, volumeMl: next });
                }
              }}
              style={[styles.input, styles.ml]}
            />
            <Text style={Typography.bodySecondary}>{unit}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${c.name}`}
              onPress={() => remove.mutate(c.id)}
            >
              <Text style={styles.danger}>Delete</Text>
            </Pressable>
          </View>
        ))}
        <View style={styles.line}>
          <TextInput
            accessibilityLabel="New container name"
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={Colors.textMuted}
            style={[styles.input, styles.flex]}
          />
          <TextInput
            accessibilityLabel="New container volume"
            value={ml}
            onChangeText={setMl}
            placeholder={unit}
            placeholderTextColor={Colors.textMuted}
            keyboardType="decimal-pad"
            style={[styles.input, styles.ml]}
          />
        </View>
        <Button
          title="Add container"
          variant="secondary"
          loading={add.isPending}
          disabled={!name.trim() || newVolume === null}
          onPress={() => add.mutate()}
        />
        <Text style={Typography.caption}>Drinks already logged keep their volume.</Text>
        <Button title="Done" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

export function DrinksScreen() {
  const invalidate = useInvalidateTotals();
  const units = useUnits();
  const containers = useQuery({ queryKey: queryKeys.containers, queryFn: listContainers });
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard('7d'),
    queryFn: () => getDashboard('7d', deviceTimeZone()),
  });
  const [abvWhole, setAbvWhole] = useState(5);
  const [abvTenth, setAbvTenth] = useState(0);
  const [volume, setVolume] = useState<Volume | null>(null);
  const [when, setWhen] = useState<When>({ kind: 'now' });
  const [managing, setManaging] = useState(false);
  const [logged, setLogged] = useState<string | null>(null);

  const selected: Volume | null =
    volume ?? (containers.data?.[0] ? { kind: 'container', container: containers.data[0] } : null);
  const abv = roundTo(abvWhole + abvTenth / 10, 1);
  const ml = volumeOf(selected, units);
  const preview = ml ? convertDrink(ml, abv) : null;
  const balance = dashboard.data?.balance;

  const log = useMutation({
    mutationFn: () => {
      const body: NewDrink = { abv, consumedAt: consumedAtOf(when) };
      if (selected?.kind === 'container') body.containerId = selected.container.id;
      else body.volumeMl = ml!;
      return logDrink(body);
    },
    onSuccess: async (drink) => {
      setLogged(`Logged ${formatDrinks(drink.stdDrinks)} standard drinks.`);
      setWhen({ kind: 'now' });
      await invalidate();
    },
  });

  if (containers.isPending) return <CenteredLoading />;

  const now = new Date();
  const pickDay = (daysAgo: number) =>
    setWhen(
      when.kind === 'at'
        ? { ...when, daysAgo }
        : daysAgo === 0
          ? {
              kind: 'at',
              daysAgo,
              hour: now.getHours(),
              minute: Math.floor(now.getMinutes() / 5) * 5,
            }
          : { kind: 'at', daysAgo, hour: 20, minute: 0 },
    );
  const days = rangeItems(0, MAX_DAYS_AGO, 1, (d) => dayLabel(d, now));

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Strength (ABV %)</Text>
        <View style={styles.drums}>
          <DrumPicker label="%" items={ABV_WHOLE} value={abvWhole} onChange={setAbvWhole} />
          <DrumPicker label="tenths" items={ABV_TENTH} value={abvTenth} onChange={setAbvTenth} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.line}>
          <Text style={[styles.sectionTitle, styles.flex]}>Amount</Text>
          <Pressable accessibilityRole="button" onPress={() => setManaging(true)}>
            <Text style={styles.link}>Manage</Text>
          </Pressable>
        </View>
        <View style={styles.chips}>
          {containers.data?.map((c) => (
            <Chip
              key={c.id}
              label={`${c.name} ${formatVolume(c.volumeMl, units)}`}
              selected={selected?.kind === 'container' && selected.container.id === c.id}
              onPress={() => setVolume({ kind: 'container', container: c })}
            />
          ))}
          <Chip
            label="Custom"
            selected={selected?.kind === 'custom'}
            onPress={() => setVolume({ kind: 'custom', text: '' })}
          />
        </View>
        {selected?.kind === 'custom' && (
          <View style={styles.line}>
            <TextInput
              accessibilityLabel={`Custom volume in ${volumeUnit(units)}`}
              value={selected.text}
              onChangeText={(text) =>
                setVolume({ kind: 'custom', text: text.replace(/[^\d.,]/g, '') })
              }
              keyboardType="decimal-pad"
              placeholder={units === 'imperial' ? '12' : '330'}
              placeholderTextColor={Colors.textMuted}
              style={[styles.input, styles.ml]}
              autoFocus
            />
            <Text style={Typography.bodySecondary}>{volumeUnit(units)}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>When</Text>
        <View style={styles.chips}>
          <Chip
            label="Now"
            selected={when.kind === 'now'}
            onPress={() => setWhen({ kind: 'now' })}
          />
          <Chip
            label="Today"
            selected={when.kind === 'at' && when.daysAgo === 0}
            onPress={() => pickDay(0)}
          />
          <Chip
            label="Yesterday"
            selected={when.kind === 'at' && when.daysAgo === 1}
            onPress={() => pickDay(1)}
          />
          <Chip
            label="Other day"
            selected={when.kind === 'at' && when.daysAgo > 1}
            onPress={() => pickDay(when.kind === 'at' && when.daysAgo > 1 ? when.daysAgo : 2)}
          />
        </View>
        {when.kind === 'at' && (
          <View style={styles.drums}>
            <DrumPicker
              label="day"
              items={days}
              value={when.daysAgo}
              width={150}
              onChange={(daysAgo) => setWhen({ ...when, daysAgo })}
            />
            <DrumPicker
              label="hour"
              items={HOURS}
              value={when.hour}
              onChange={(hour) => setWhen({ ...when, hour })}
            />
            <DrumPicker
              label="min"
              items={MINUTES}
              value={when.minute}
              onChange={(minute) => setWhen({ ...when, minute })}
            />
          </View>
        )}
      </View>

      <View style={styles.card} testID="drink-preview">
        {preview && ml ? (
          <>
            <Text style={Typography.body}>
              {formatVolume(ml, units)} × {abv}% → {formatDrinks(preview.alcoholG)} g alcohol →{' '}
              <Text style={styles.bold}>{formatDrinks(preview.stdDrinks)} std drinks</Text>
            </Text>
            {balance !== undefined && (
              <Text style={Typography.bodySecondary}>
                Balance after:{' '}
                <Text
                  style={{
                    color: balance - preview.stdDrinks < 0 ? Colors.drunk : Colors.earned,
                    fontWeight: '700',
                  }}
                >
                  {formatDrinks(balance - preview.stdDrinks)}
                </Text>
              </Text>
            )}
          </>
        ) : (
          <Text style={Typography.bodySecondary}>Pick a container or enter a volume.</Text>
        )}
      </View>

      {log.error && (
        <Text style={styles.danger} accessibilityRole="alert">
          {log.error.message}
        </Text>
      )}
      {logged && !log.isPending && <Text style={styles.success}>{logged}</Text>}
      <Button
        title="Log drink"
        loading={log.isPending}
        disabled={!preview}
        onPress={() => {
          setLogged(null);
          log.mutate();
        }}
      />
      <ContainerManager
        visible={managing}
        onClose={() => {
          setManaging(false);
          setVolume(null);
        }}
      />
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
  card: { ...Palette.card, gap: Spacing.sm },
  sectionTitle: { ...Typography.body, fontWeight: '700' },
  drums: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.surfaceRaised },
  input: {
    ...Typography.body,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  ml: { width: 90, textAlign: 'center' },
  link: { ...Typography.body, color: Colors.accent, fontWeight: '700' },
  danger: { ...Typography.body, color: Colors.error },
  success: { ...Typography.body, color: Colors.earned },
});
