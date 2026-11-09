import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { DEV_EMAILS, isDevSessionEnabled } from '@/auth/devSession';
import { useGoogleSignIn } from '@/auth/google';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { versionLabel } from '@/lib/app-info';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import appIcon from '../../../assets/images/icon.png';

const WELCOME_TEXT =
  'Earn your drinks at the gym, spend them at the bar. Sign in to see your balance.';

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      <Button title="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

function DevSignIn() {
  const { loginWithDevUser } = useSession();
  const [email, setEmail] = useState(DEV_EMAILS[0] ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const value = email.trim();
    if (!value) return;
    setError(null);
    setPending(true);
    try {
      await loginWithDevUser(value);
    } catch (err) {
      setError(messageOf(err, 'Dev sign-in failed.'));
      setPending(false);
    }
  }, [loginWithDevUser, email]);

  return (
    <View style={styles.dev} testID="dev-sign-in">
      <Text style={styles.devTitle}>DEV SIGN-IN</Text>
      <TextInput
        accessibilityLabel="Dev email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={styles.input}
        placeholder="any email"
        placeholderTextColor={Colors.textMuted}
        onSubmitEditing={() => void submit()}
      />
      <Button
        title="Dev sign in"
        variant="secondary"
        loading={pending}
        disabled={!email.trim()}
        onPress={() => void submit()}
      />
      {error && <ErrorBanner message={error} onRetry={() => void submit()} />}
    </View>
  );
}

export interface LoginScreenProps {
  devSignInEnabled?: boolean;
}

export function LoginScreen({ devSignInEnabled = isDevSessionEnabled() }: LoginScreenProps) {
  const { loginWithGoogleCode } = useSession();
  const google = useGoogleSignIn(loginWithGoogleCode);

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.container}>
      <View style={styles.brand}>
        <Image source={appIcon} style={styles.logo} accessibilityLabel="Sobi logo" />
        <Text style={styles.title}>SOBI</Text>
        <Text style={styles.welcome}>{WELCOME_TEXT}</Text>
      </View>

      <View style={styles.actions}>
        <Button
          title={google.status === 'pending' ? 'Signing in…' : 'Continue with Google'}
          loading={google.status === 'pending'}
          disabled={!google.ready}
          onPress={() => void google.signIn()}
        />
        {!google.configured && (
          <Text style={Typography.caption}>Google sign-in is not configured for this build.</Text>
        )}
        {google.status === 'error' && google.error && (
          <ErrorBanner message={google.error} onRetry={() => void google.signIn()} />
        )}
      </View>

      {devSignInEnabled && <DevSignIn />}

      <Text style={styles.version}>{versionLabel()}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: Spacing.lg,
    gap: Spacing.lg,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  brand: { alignItems: 'center', gap: Spacing.md },
  logo: { width: 160, height: 160, borderRadius: Radius.lg },
  title: { ...Typography.title, color: Colors.accent, letterSpacing: 4 },
  welcome: { ...Typography.bodySecondary, textAlign: 'center' },
  actions: { gap: Spacing.sm },
  error: { ...Palette.card, borderColor: Colors.error, gap: Spacing.sm },
  errorText: { ...Typography.body, color: Colors.errorText },
  dev: { ...Palette.card, gap: Spacing.sm },
  devTitle: { ...Typography.caption, letterSpacing: 2 },
  input: {
    ...Typography.body,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  version: { ...Typography.caption, textAlign: 'center' },
});
