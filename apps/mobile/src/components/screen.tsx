import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Colors, Palette, Spacing } from '@/theme';

/** A shared reading width and optional in-flow action bar, never laid over form content. */
export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const root = useRef<ComponentRef<typeof View>>(null);
  const [top, setTop] = useState(0);
  return (
    <View
      ref={root}
      style={Palette.screen}
      onLayout={() => {
        // Measure the actual header/safe-area offset instead of assuming a fixed navigation height.
        root.current?.measureInWindow((_x, y) => setTop(y));
      }}
    >
      <KeyboardAvoidingView
        style={styles.scroll}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={top}
      >
        <ScrollView
          testID="screen-content"
          style={styles.scroll}
          contentContainerStyle={Palette.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>
        {footer && (
          <View style={styles.footer} testID="screen-footer">
            <View style={styles.footerContent}>{footer}</View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  footer: { backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border },
  footerContent: { ...Palette.content, paddingVertical: Spacing.sm, gap: Spacing.sm },
});
