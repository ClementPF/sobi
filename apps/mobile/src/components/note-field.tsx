import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export const NOTE_MAX = 500;

/**
 * Multi-line note input. With `onSave` it saves on blur when the text changed;
 * with `onChangeText` it is a plain controlled field.
 */
export function NoteField({
  value,
  onChangeText,
  onSave,
  saving = false,
  placeholder = 'Add a note',
}: {
  value: string | null;
  onChangeText?(text: string): void;
  onSave?(note: string | null): void;
  saving?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);

  return (
    <View style={styles.wrap}>
      <TextInput
        accessibilityLabel="Note"
        value={text}
        onChangeText={(next) => {
          setText(next);
          onChangeText?.(next);
        }}
        onBlur={() => {
          const next = text.trim() || null;
          if (onSave && next !== (value ?? null)) onSave(next);
        }}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        maxLength={NOTE_MAX}
        multiline
        style={styles.input}
      />
      {saving && <Text style={Typography.caption}>Saving…</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  input: {
    ...Typography.body,
    minHeight: 64,
    textAlignVertical: 'top',
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
});
