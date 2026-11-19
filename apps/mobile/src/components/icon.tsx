import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Colors, Radius } from '@/theme';

const NAMES = {
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  duplicate: { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  chevronDown: { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
} satisfies Record<string, SymbolViewProps['name']>;

export type IconName = keyof typeof NAMES;

export function Icon({
  name,
  color = Colors.accent,
  size = 20,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return (
    <SymbolView
      name={NAMES[name]}
      tintColor={color}
      size={size}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Familiar row actions stay compact visually, with a full-sized touch target and spoken label. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  loading = false,
  color = Colors.accent,
}: {
  icon: IconName;
  label: string;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  color?: string;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Icon name={icon} color={color} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  pressed: { backgroundColor: Colors.surfaceRaised },
  inactive: { opacity: 0.5 },
});
