import { useEffect, useMemo, useRef } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export interface DrumItem<T> {
  value: T;
  label: string;
}

export interface DrumPickerProps<T> {
  items: readonly DrumItem<T>[];
  value: T;
  onChange(value: T): void;
  /** Accessible name, also shown unless labelPosition is hidden. */
  label?: string;
  labelPosition?: 'above' | 'below' | 'hidden';
  itemTextStyle?: StyleProp<TextStyle>;
  itemHeight?: number;
  /** Odd number of rows visible; the middle row is the selection. */
  visibleCount?: number;
  width?: ViewStyle['width'];
  testID?: string;
}

/** Index of the row centred at scroll offset `offsetY`, clamped to the list. */
export function snapIndex(offsetY: number, itemHeight: number, count: number): number {
  if (count <= 0) return 0;
  const index = Math.round(offsetY / itemHeight);
  return Math.min(Math.max(index, 0), count - 1);
}

/** Integer items from `min` to `max` in `step`s, labelled by `format`. */
export function rangeItems(
  min: number,
  max: number,
  step = 1,
  format: (value: number) => string = String,
): DrumItem<number>[] {
  const items: DrumItem<number>[] = [];
  for (let v = min; v <= max; v += step) items.push({ value: v, label: format(v) });
  return items;
}

// Web has no momentum-end event, so a scroll that has been still this long counts as settled.
const WEB_SETTLE_MS = 120;

/** A snapping wheel picker built on ScrollView, so it works the same on web and native. */
export function DrumPicker<T>({
  items,
  value,
  onChange,
  label,
  labelPosition = 'below',
  itemTextStyle,
  itemHeight = 44,
  visibleCount = 5,
  width = 80,
  testID,
}: DrumPickerProps<T>) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIndex = Math.max(
    items.findIndex((item) => item.value === value),
    0,
  );
  const lastReported = useRef(selectedIndex);
  const padding = (itemHeight * (visibleCount - 1)) / 2;

  useEffect(() => {
    // Follows external value changes without echoing them back through onChange.
    lastReported.current = selectedIndex;
    scrollRef.current?.scrollTo({ y: selectedIndex * itemHeight, animated: false });
  }, [selectedIndex, itemHeight]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const settle = (offsetY: number) => {
    const index = snapIndex(offsetY, itemHeight, items.length);
    const item = items[index];
    if (Platform.OS === 'web' && Math.abs(offsetY - index * itemHeight) > 1) {
      scrollRef.current?.scrollTo({ y: index * itemHeight, animated: true });
    }
    if (!item || index === lastReported.current) return;
    lastReported.current = index;
    onChange(item.value);
  };

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    settle(event.nativeEvent.contentOffset.y);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Platform.OS !== 'web') return;
    const y = event.nativeEvent.contentOffset.y;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settle(y), WEB_SETTLE_MS);
  };

  const select = (index: number) => {
    scrollRef.current?.scrollTo({ y: index * itemHeight, animated: true });
    const item = items[index];
    if (!item || index === lastReported.current) return;
    lastReported.current = index;
    onChange(item.value);
  };

  const onKeyDown: NonNullable<ScrollViewProps['onKeyDown']> = (event) => {
    const key = event.nativeEvent.key;
    const offsets: Record<string, number> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
    };
    let index = selectedIndex;
    if (key === 'Home') index = 0;
    else if (key === 'End') index = items.length - 1;
    else if (key in offsets) index += offsets[key]!;
    else return;
    event.preventDefault();
    select(Math.min(Math.max(index, 0), items.length - 1));
  };

  const height = itemHeight * visibleCount;
  const webSnap = useMemo(
    () => (Platform.OS === 'web' ? ({ scrollSnapType: 'y mandatory' } as ViewStyle) : null),
    [],
  );
  const webSnapItem = useMemo(
    () => (Platform.OS === 'web' ? ({ scrollSnapAlign: 'center' } as ViewStyle) : null),
    [],
  );
  // Web rows are pointer targets only. The slider itself owns keyboard and screen-reader input.
  const Item = Platform.OS === 'web' ? View : Pressable;

  return (
    <View style={[styles.wrapper, { width }]}>
      {label && labelPosition === 'above' ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.drum, { height }]}>
        <View
          pointerEvents="none"
          style={[styles.highlight, { top: padding, height: itemHeight }]}
        />
        <ScrollView
          onKeyDown={onKeyDown}
          ref={scrollRef}
          testID={testID}
          accessible
          tabIndex={0}
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{
            min: 0,
            max: items.length - 1,
            now: selectedIndex,
            text: items[selectedIndex]?.label,
          }}
          aria-valuemin={0}
          aria-valuemax={items.length - 1}
          aria-valuenow={selectedIndex}
          aria-valuetext={items[selectedIndex]?.label}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1;
            select(Math.min(Math.max(selectedIndex + delta, 0), items.length - 1));
          }}
          showsVerticalScrollIndicator={false}
          snapToInterval={itemHeight}
          decelerationRate="fast"
          contentOffset={{ x: 0, y: selectedIndex * itemHeight }}
          contentContainerStyle={{ paddingVertical: padding }}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={(event) => {
            // Without velocity there is no momentum phase, so this is the final position.
            const velocity = event.nativeEvent.velocity?.y ?? 0;
            if (velocity === 0) onScrollEnd(event);
          }}
          style={webSnap}
        >
          {items.map((item, index) => (
            <Item
              key={index}
              {...(Platform.OS === 'web'
                ? { onClick: () => select(index), 'aria-hidden': true }
                : {
                    accessibilityRole: 'button' as const,
                    accessibilityLabel: `${label ?? 'value'} ${item.label}`,
                    onPress: () => select(index),
                  })}
              style={[styles.item, { height: itemHeight }, webSnapItem]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.itemText,
                  itemTextStyle,
                  index === selectedIndex && styles.itemTextSelected,
                ]}
              >
                {item.label}
              </Text>
            </Item>
          ))}
        </ScrollView>
      </View>
      {label && labelPosition === 'below' ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: Spacing.xs },
  drum: { width: '100%', overflow: 'hidden' },
  highlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  item: { alignItems: 'center', justifyContent: 'center' },
  itemText: { ...Typography.body, maxWidth: '100%', fontSize: 20, color: Colors.textMuted },
  itemTextSelected: { color: Colors.text, fontWeight: '700' },
  label: Typography.caption,
});
