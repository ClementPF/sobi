import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { Icon, IconButton } from '@/components/icon';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { NoteField } from '@/components/note-field';
import { Screen } from '@/components/screen';
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

import { CONTAINER_PORTIONS, portionVolume } from './portions';

const ABV_WHOLE = rangeItems(0, 80);
const ABV_TENTH = rangeItems(0, 9, 1, (v) => `.${v}`);
const HOURS = rangeItems(0, 23, 1, (v) => String(v).padStart(2, '0'));
const MINUTES = rangeItems(0, 55, 5, (v) => String(v).padStart(2, '0'));
const CUSTOM_VOLUME = '__custom__';

/** How far back a drink can be logged. */
export const MAX_DAYS_AGO = 365;

type Volume = { kind: 'container'; container: Container } | { kind: 'custom'; text: string };
type When = { kind: 'now' } | { kind: 'at'; daysAgo: number; hour: number; minute: number };

export function volumeOf(volume: Volume | null, units: Units, portion = 1): number | null {
  if (!volume) return null;
  if (volume.kind === 'container') return portionVolume(volume.container.volumeMl, portion);
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
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
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
      <SafeAreaView style={Palette.screen}>
        <Screen footer={<Button title="Done" onPress={onClose} />}>
          <Text style={Typography.title}>Containers</Text>
          <Text style={Typography.bodySecondary}>Set the sizes you use most often.</Text>
          {containers.data?.map((c) => (
            <View key={`${c.id}-${units}`} style={styles.card}>
              <View style={styles.line}>
                <TextInput
                  accessibilityLabel={`${c.name} name`}
                  defaultValue={c.name}
                  onEndEditing={(e) => {
                    const next = e.nativeEvent.text.trim();
                    if (next && next !== c.name) rename.mutate({ id: c.id, name: next });
                  }}
                  style={[styles.input, styles.flex]}
                />
                <IconButton
                  icon="trash"
                  label={`Delete ${c.name}`}
                  color={Colors.error}
                  disabled={remove.isPending}
                  onPress={() => remove.mutate(c.id)}
                />
              </View>
              <View style={styles.line}>
                <Text style={[Typography.caption, styles.flex]}>Volume</Text>
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
              </View>
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
          {(add.error || rename.error || remove.error || containers.error) && (
            <Text style={styles.danger} accessibilityRole="alert">
              {(add.error ?? rename.error ?? remove.error ?? containers.error)?.message}
            </Text>
          )}
        </Screen>
      </SafeAreaView>
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
  const [portion, setPortion] = useState(1);
  const [when, setWhen] = useState<When>({ kind: 'now' });
  const [editingWhen, setEditingWhen] = useState(false);
  const [note, setNote] = useState('');
  const [managing, setManaging] = useState(false);
  const [logged, setLogged] = useState<string | null>(null);

  const ordered = [...(containers.data ?? [])].sort(
    (a, b) => a.volumeMl - b.volumeMl || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const selected: Volume =
    volume ??
    (ordered[0] ? { kind: 'container', container: ordered[0] } : { kind: 'custom', text: '' });
  const containerItems = [
    ...ordered.map((c) => ({ value: c.id, label: `${c.name} ${formatVolume(c.volumeMl, units)}` })),
    { value: CUSTOM_VOLUME, label: 'Custom volume' },
  ];
  const abv = roundTo(abvWhole + abvTenth / 10, 1);
  const ml = volumeOf(selected, units, portion);
  const portionLabel = CONTAINER_PORTIONS.find((item) => item.value === portion)!.label;
  const preview = ml ? convertDrink(ml, abv) : null;
  const balance = dashboard.data?.balance;

  const log = useMutation({
    mutationFn: () => {
      const body: NewDrink = { abv, consumedAt: consumedAtOf(when), note: note.trim() || null };
      body.volumeMl = ml!;
      if (selected?.kind === 'container') body.containerId = selected.container.id;
      return logDrink(body);
    },
    onSuccess: async (drink) => {
      setLogged(`Logged ${formatDrinks(drink.stdDrinks)} standard drinks.`);
      setWhen({ kind: 'now' });
      setEditingWhen(false);
      setNote('');
      setPortion(1);
      await invalidate();
    },
  });

  if (containers.isPending) return <CenteredLoading />;
  if (containers.isError) {
    return (
      <EmptyState
        title="Could not load your containers."
        actionTitle="Try again"
        onAction={() => void containers.refetch()}
      />
    );
  }

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
    <Screen
      footer={
        <>
          <View testID="drink-preview" style={styles.portionSummary}>
            {preview && ml ? (
              <>
                <Text style={Typography.body}>
                  {formatVolume(ml, units)} × {abv}% ·{' '}
                  <Text style={styles.bold}>{formatDrinks(preview.stdDrinks)} std drinks</Text>
                </Text>
                {balance !== undefined && (
                  <Text style={Typography.caption}>
                    Balance after:{' '}
                    <Text
                      style={{
                        color: balance - preview.stdDrinks < 0 ? Colors.drunk : Colors.earned,
                      }}
                    >
                      {formatDrinks(balance - preview.stdDrinks)}
                    </Text>
                  </Text>
                )}
              </>
            ) : (
              <Text style={Typography.caption}>Pick a container or enter a volume.</Text>
            )}
          </View>
          {log.error && (
            <Text style={styles.danger} accessibilityRole="alert">
              {log.error.message}
            </Text>
          )}
          {logged && !log.isPending && (
            <Text style={styles.success} accessibilityLiveRegion="polite">
              {logged}
            </Text>
          )}
          <Button
            title="Log drink"
            loading={log.isPending}
            disabled={!preview}
            onPress={() => {
              setLogged(null);
              log.mutate();
            }}
          />
        </>
      }
    >
      <View style={styles.formSection}>
        <View style={styles.amountFields} testID="drink-fields">
          <View style={styles.flex}>
            <DrumPicker
              label="Container"
              labelPosition="above"
              items={containerItems}
              value={selected.kind === 'container' ? selected.container.id : CUSTOM_VOLUME}
              width="100%"
              visibleCount={3}
              itemTextStyle={Typography.body}
              onChange={(id) => {
                const container = ordered.find((c) => c.id === id);
                setVolume(
                  container ? { kind: 'container', container } : { kind: 'custom', text: '' },
                );
                setPortion(1);
              }}
            />
          </View>
          {selected?.kind === 'container' && (
            <DrumPicker
              label="Quantity"
              labelPosition="above"
              items={CONTAINER_PORTIONS}
              value={portion}
              onChange={setPortion}
              width={56}
              visibleCount={3}
            />
          )}
          {selected.kind === 'custom' && (
            <View style={styles.customField}>
              <Text style={Typography.caption}>Volume ({volumeUnit(units)})</Text>
              <View style={styles.customInput}>
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
                />
              </View>
            </View>
          )}
          <View style={styles.strengthField} testID="drink-strength">
            <Text style={[Typography.caption, styles.fieldLabel]}>ABV %</Text>
            <View style={styles.strengthDrums}>
              <DrumPicker
                label="ABV whole percent"
                labelPosition="hidden"
                items={ABV_WHOLE}
                value={abvWhole}
                onChange={setAbvWhole}
                width={44}
                visibleCount={3}
              />
              <DrumPicker
                label="ABV tenths"
                labelPosition="hidden"
                items={ABV_TENTH}
                value={abvTenth}
                onChange={setAbvTenth}
                width={44}
                visibleCount={3}
              />
            </View>
          </View>
        </View>
        <View style={styles.line}>
          <Text style={[Typography.bodySecondary, styles.flex]} accessibilityLiveRegion="polite">
            {selected.kind === 'container'
              ? `${portionLabel} × ${selected.container.name} (${formatVolume(selected.container.volumeMl, units)})`
              : 'Custom volume'}
          </Text>
          {selected.kind === 'container' && portion !== 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset to one container"
              onPress={() => setPortion(1)}
              style={styles.resetPortion}
            >
              <Text style={styles.link}>Reset to 1</Text>
            </Pressable>
          )}
          <IconButton icon="edit" label="Manage containers" onPress={() => setManaging(true)} />
        </View>
        {selected.kind === 'container' && ml === null && (
          <Text style={styles.danger} accessibilityRole="alert">
            Total must be between 1 and 10,000 ml.
          </Text>
        )}
      </View>

      <View style={styles.formSection}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change drink time"
          accessibilityState={{ expanded: editingWhen }}
          aria-expanded={editingWhen}
          onPress={() => setEditingWhen((value) => !value)}
          style={styles.whenRow}
        >
          <Text style={Typography.body}>When</Text>
          <Text style={[Typography.bodySecondary, styles.whenValue]}>
            {when.kind === 'now'
              ? 'Now'
              : `${dayLabel(when.daysAgo, now)} · ${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')}`}
          </Text>
          <Icon name={editingWhen ? 'chevronDown' : 'chevron'} color={Colors.textMuted} size={18} />
        </Pressable>
        {editingWhen && (
          <>
            <View
              style={styles.chips}
              accessibilityRole="radiogroup"
              accessibilityLabel="Drink time"
            >
              <Chip
                label="Now"
                selected={when.kind === 'now'}
                onPress={() => {
                  setWhen({ kind: 'now' });
                  setEditingWhen(false);
                }}
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
                  width={140}
                  itemTextStyle={{ fontSize: 14 }}
                  visibleCount={3}
                  onChange={(daysAgo) => setWhen({ ...when, daysAgo })}
                />
                <DrumPicker
                  label="hour"
                  items={HOURS}
                  value={when.hour}
                  width={48}
                  visibleCount={3}
                  onChange={(hour) => setWhen({ ...when, hour })}
                />
                <DrumPicker
                  label="min"
                  items={MINUTES}
                  value={when.minute}
                  width={48}
                  visibleCount={3}
                  onChange={(minute) => setWhen({ ...when, minute })}
                />
              </View>
            )}
          </>
        )}
      </View>

      <NoteField value={note} onChangeText={setNote} compact placeholder="Note (optional)" />

      <ContainerManager
        visible={managing}
        onClose={() => {
          setManaging(false);
          setVolume(null);
          setPortion(1);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, gap: Spacing.sm },
  formSection: { gap: Spacing.sm },
  amountFields: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  strengthField: { width: 92, marginStart: Spacing.sm, gap: Spacing.xs },
  strengthDrums: { flexDirection: 'row', gap: Spacing.xs },
  fieldLabel: { textAlign: 'center' },
  customField: { width: 90, gap: Spacing.xs },
  customInput: { height: 132, justifyContent: 'center' },
  whenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  whenValue: { flex: 1, textAlign: 'right' },
  drums: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm },
  portionSummary: { gap: Spacing.xs },
  resetPortion: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.surfaceRaised },
  input: {
    ...Typography.body,
    minHeight: 48,
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
