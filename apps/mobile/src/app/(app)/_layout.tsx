import { Stack } from 'expo-router';

import { Colors } from '@/theme';

export const unstable_settings = {
  // Deep links and reloads of pushed screens keep the tabs below them.
  anchor: '(tabs)',
};

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
      }}
    >
      {/* Pushed screens label their back button with this title instead of the group name. */}
      <Stack.Screen name="(tabs)" options={{ title: 'Back', headerShown: false }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="workouts/new" options={{ title: 'New workout' }} />
      <Stack.Screen name="workouts/[id]" options={{ title: 'Edit workout' }} />
      <Stack.Screen name="sessions/[id]" options={{ title: 'Session' }} />
    </Stack>
  );
}
