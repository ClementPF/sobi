import { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewProps,
} from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import type { Dashboard } from '@/api/types';
import { formatDrinks } from '@/lib/conversions';
import { formatDay } from '@/lib/time';
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
export function WeeklyBars({
  weekly,
  selection,
}: {
  weekly: Dashboard['weekly'];
  selection?: {
    days: Dashboard['series'];
    index: number;
    onChange(index: number): void;
  };
}) {
  const { width, onLayout } = useWidth();
  const left = useRef(0);
  const start = useRef({ x: 0, y: 0 });
  if (weekly.length === 0) return null;
  const selectedDate = selection?.days[selection.index]?.date;
  const max = Math.max(...weekly.flatMap((w) => [w.earned, w.drunk]), 1);
  const innerH = CHART_HEIGHT - PAD * 2;
  const slot = (width - PAD * 2) / weekly.length;
  const bar = Math.min(slot / 3, 24);
  const h = (v: number) => (v / max) * innerH;
  const firstDate = selection?.days[0]?.date;
  const firstOffset = firstDate
    ? Math.round(
        (Date.parse(`${firstDate}T00:00:00Z`) - Date.parse(`${weekly[0]!.weekStart}T00:00:00Z`)) /
          86_400_000,
      )
    : 0;
  const markerX = selection ? PAD + ((firstOffset + selection.index + 0.5) / 7) * slot : 0;
  const labelWidth = Math.min(170, width - PAD * 2);
  const labelX = Math.max(PAD, Math.min(width - PAD - labelWidth, markerX - labelWidth / 2));
  const select = (index: number) => {
    if (!selection || selection.days.length < 2) return;
    selection.onChange(Math.max(0, Math.min(selection.days.length - 1, index)));
  };
  const selectAt = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.pageX - left.current;
    select(Math.round(((x - PAD) / slot) * 7 - firstOffset - 0.5));
  };
  const onKeyDown: NonNullable<ViewProps['onKeyDown']> = (event) => {
    if (!selection) return;
    const key = event.nativeEvent.key;
    let index = selection.index;
    if (key === 'Home') index = 0;
    else if (key === 'End') index = selection.days.length - 1;
    else if (key === 'ArrowRight' || key === 'ArrowUp') index++;
    else if (key === 'ArrowLeft' || key === 'ArrowDown') index--;
    else return;
    event.preventDefault();
    select(index);
  };

  return (
    <View testID="weekly-bars">
      <View
        onLayout={onLayout}
        testID={selection ? 'activity-date-graph' : undefined}
        pointerEvents="box-only"
        accessible={selection !== undefined}
        accessibilityRole={selection ? 'adjustable' : undefined}
        accessibilityLabel={selection ? 'Activity date' : undefined}
        accessibilityHint={
          selection
            ? 'Drag across the graph to inspect a day’s drinks, notes, and workouts'
            : undefined
        }
        accessibilityState={selection ? { disabled: selection.days.length < 2 } : undefined}
        accessibilityValue={
          selection
            ? {
                min: 0,
                max: selection.days.length - 1,
                now: selection.index,
                text: selectedDate ? formatDay(selectedDate) : '',
              }
            : undefined
        }
        aria-valuemin={selection ? 0 : undefined}
        aria-valuemax={selection ? selection.days.length - 1 : undefined}
        aria-valuenow={selection?.index}
        aria-valuetext={selectedDate ? formatDay(selectedDate) : undefined}
        tabIndex={selection ? 0 : undefined}
        accessibilityActions={
          selection
            ? [
                { name: 'increment', label: 'Next day' },
                { name: 'decrement', label: 'Previous day' },
              ]
            : undefined
        }
        onAccessibilityAction={(event) => {
          if (selection && event.nativeEvent.actionName === 'increment')
            select(selection.index + 1);
          else if (selection && event.nativeEvent.actionName === 'decrement')
            select(selection.index - 1);
        }}
        onKeyDown={onKeyDown}
        onStartShouldSetResponder={() => !!selection && selection.days.length > 1}
        onResponderGrant={(event) => {
          // Derive the origin from this gesture, even if a centered plot moved after a resize.
          left.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
          start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
          selectAt(event);
        }}
        onResponderMove={(event) => {
          // Let the parent ScrollView take vertical swipes; inspect horizontal movement only.
          if (
            Math.abs(event.nativeEvent.pageX - start.current.x) >=
            Math.abs(event.nativeEvent.pageY - start.current.y)
          )
            selectAt(event);
        }}
        onResponderTerminationRequest={() => true}
        style={styles.plot}
      >
        <Svg width={width} height={CHART_HEIGHT} aria-hidden>
          <Line
            x1={PAD}
            x2={width - PAD}
            y1={CHART_HEIGHT - PAD}
            y2={CHART_HEIGHT - PAD}
            stroke={Colors.border}
          />
          {weekly.map((w, i) => {
            const cx = PAD + slot * i + slot / 2;
            const selected =
              selectedDate !== undefined &&
              selectedDate >= w.weekStart &&
              (weekly[i + 1] === undefined || selectedDate < weekly[i + 1]!.weekStart);
            return [
              selected && (
                <Rect
                  key={`${w.weekStart}-selected`}
                  testID="selected-week"
                  x={PAD + slot * i}
                  y={0}
                  width={slot}
                  height={CHART_HEIGHT}
                  fill={Colors.accent}
                  fillOpacity={0.15}
                />
              ),
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
          {selectedDate && (
            <>
              <Line
                testID="activity-date-marker"
                x1={markerX}
                x2={markerX}
                y1={24}
                y2={CHART_HEIGHT - PAD}
                stroke={Colors.accent}
                strokeWidth={2}
              />
              <Circle cx={markerX} cy={CHART_HEIGHT - PAD} r={5} fill={Colors.accent} />
            </>
          )}
        </Svg>
        {selectedDate && (
          <View
            pointerEvents="none"
            aria-hidden
            style={[styles.dateLabel, { left: labelX, width: labelWidth }]}
          >
            <Text testID="activity-date-label" style={styles.dateText} numberOfLines={1}>
              {formatDay(selectedDate)}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.axis}>
        <Text style={Typography.caption}>Week of {weekly[0]?.weekStart}</Text>
        <Text style={Typography.caption}>max {formatDrinks(max)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { height: CHART_HEIGHT, touchAction: 'pan-y' },
  dateLabel: {
    position: 'absolute',
    top: 0,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  dateText: {
    ...Typography.caption,
    color: Colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
});
