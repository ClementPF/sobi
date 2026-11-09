import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteSession, getSession } from '@/api/endpoints';
import { useUnits } from '@/auth/session';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { formatAmount, formatDrinks, formatRate } from '@/lib/conversions';
import { queryKeys, useInvalidateTotals } from '@/lib/queries';
import { formatDate, formatTime } from '@/lib/time';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export function SessionDetailScreen({ id }: { id: string }) {
  const units = useUnits();
  const invalidate = useInvalidateTotals();
  const [confirm, setConfirm] = useState(false);
  const query = useQuery({ queryKey: queryKeys.session(id), queryFn: () => getSession(id) });
  const remove = useMutation({
    mutationFn: () => deleteSession(id),
    onSuccess: async () => {
      setConfirm(false);
      await invalidate();
      if (router.canGoBack()) router.back();
      else router.replace('/history');
    },
  });

  if (query.isPending) return <CenteredLoading />;
  if (query.isError) return <EmptyState title="Session not found." />;
  const session = query.data;
  const started = session.startedAt;

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.container}>
      <Text style={Typography.title}>{session.workout.name}</Text>
      <Text style={Typography.bodySecondary}>
        {formatDate(started)} · {formatTime(started)}
        {session.endedAt ? ` – ${formatTime(session.endedAt)}` : ' · in progress'}
      </Text>
      <Text style={styles.total}>+{formatDrinks(session.earnedDrinks)} drinks earned</Text>
      {session.exercises
        .filter((e) => e.sets.length > 0)
        .map((exercise) => (
          <View key={exercise.id} style={styles.card}>
            <Text style={[Typography.body, styles.bold]}>{exercise.name}</Text>
            <Text style={Typography.caption}>
              {formatRate(exercise.metric, exercise.earnDrinks, exercise.earnPer, units)}
            </Text>
            {exercise.sets.map((set) => (
              <View key={set.id} style={styles.line}>
                <Text style={Typography.body}>
                  {formatAmount(exercise.metric, set.amount, units)}
                </Text>
                <Text style={styles.earned}>+{formatDrinks(set.earnedDrinks)}</Text>
              </View>
            ))}
          </View>
        ))}
      <Button title="Delete session" variant="secondary" onPress={() => setConfirm(true)} />
      <ConfirmDialog
        visible={confirm}
        title="Delete session?"
        message="Its sets and the drinks they earned are removed from your balance."
        confirmTitle="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirm(false)}
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
  total: { ...Typography.body, color: Colors.earned, fontWeight: '700', fontSize: 20 },
  card: { ...Palette.card, gap: Spacing.xs },
  bold: { fontWeight: '700' },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  earned: { ...Typography.body, color: Colors.earned },
});
