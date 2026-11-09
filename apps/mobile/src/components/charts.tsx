import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import type { Dashboard } from '@/api/types';
import { formatDrinks } from '@/lib/conversions';
import { Colors, Spacing, Typography } from '@/theme';

function useWidth(initial = 300) {
  const [width, setWidth] = useState(initial);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };
  return { width, onLayout };
}

const CHART_HEIGHT = 160;
const PAD = 8;

/** Running balance per day; the line is green above zero and red below it. */
export function BalanceChart({ series }: { series: Dashboard['series'] }) {
  const { width, onLayout } = useWidth();
  if (series.length === 0) return null;
  const values = series.map((p) => p.balance);
  const flat = values.every((v) => v === 0);
  const max = flat ? 1 : Math.max(...values, 0);
  const min = flat ? -1 : Math.min(...values, 0);
  const span = max - min || 1;
  const innerW = width - PAD * 2;
  const innerH = CHART_HEIGHT - PAD * 2;
  const x = (i: number) =>
    PAD + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => PAD + ((max - v) / span) * innerH;
  const zeroY = y(0);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  const last = values[values.length - 1] ?? 0;
  const lastColor = last < 0 ? Colors.drunk : Colors.earned;

  return (
    <View onLayout={onLayout} testID="balance-chart">
      <Svg width={width} height={CHART_HEIGHT}>
        <Line
          x1={PAD}
          x2={width - PAD}
          y1={zeroY}
          y2={zeroY}
          stroke={Colors.border}
          strokeDasharray="4 4"
        />
        <Path d={path} stroke={Colors.accent} strokeWidth={2} fill="none" />
        <Circle cx={x(values.length - 1)} cy={y(last)} r={4} fill={lastColor} />
      </Svg>
      <View style={styles.axis}>
        <Text style={Typography.caption}>{series[0]?.date}</Text>
        <Text style={Typography.caption}>{series[series.length - 1]?.date}</Text>
      </View>
    </View>
  );
}

/** Earned (green) and drunk (red) bars side by side per week. */
export function WeeklyBars({ weekly }: { weekly: Dashboard['weekly'] }) {
  const { width, onLayout } = useWidth();
  if (weekly.length === 0) return null;
  const max = Math.max(...weekly.flatMap((w) => [w.earned, w.drunk]), 1);
  const innerH = CHART_HEIGHT - PAD * 2;
  const slot = (width - PAD * 2) / weekly.length;
  const bar = Math.max(Math.min(slot / 3, 24), 2);
  const h = (v: number) => (v / max) * innerH;

  return (
    <View onLayout={onLayout} testID="weekly-bars">
      <Svg width={width} height={CHART_HEIGHT}>
        {weekly.map((w, i) => {
          const cx = PAD + slot * i + slot / 2;
          return [
            <Rect
              key={`${w.weekStart}-e`}
              x={cx - bar}
              y={CHART_HEIGHT - PAD - h(w.earned)}
              width={bar}
              height={h(w.earned)}
              fill={Colors.earned}
            />,
            <Rect
              key={`${w.weekStart}-d`}
              x={cx}
              y={CHART_HEIGHT - PAD - h(w.drunk)}
              width={bar}
              height={h(w.drunk)}
              fill={Colors.drunk}
            />,
          ];
        })}
      </Svg>
      <View style={styles.axis}>
        <Text style={Typography.caption}>Week of {weekly[0]?.weekStart}</Text>
        <Text style={Typography.caption}>max {formatDrinks(max)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
});
