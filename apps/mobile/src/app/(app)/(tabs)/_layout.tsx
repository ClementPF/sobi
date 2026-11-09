import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, type ColorValue } from 'react-native';

import { Colors, Spacing } from '@/theme';

type TabIconName = SymbolViewProps['name'];

function tabIcon(name: TabIconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <SymbolView name={name} tintColor={color} size={size} />;
  }
  return TabIcon;
}

function SettingsButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={8}
      onPress={() => router.push('/settings')}
      style={styles.gear}
    >
      <SymbolView
        name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
        tintColor={Colors.text}
        size={22}
      />
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerRight: () => <SettingsButton />,
        tabBarStyle: { backgroundColor: Colors.tabBar, borderTopColor: Colors.border },
        tabBarActiveTintColor: Colors.tabIconSelected,
        tabBarInactiveTintColor: Colors.tabIconDefault,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          headerTitle: 'Sobi',
          tabBarIcon: tabIcon({ ios: 'house.fill', android: 'home', web: 'home' }),
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Workout',
          tabBarIcon: tabIcon({
            ios: 'dumbbell.fill',
            android: 'fitness_center',
            web: 'fitness_center',
          }),
        }}
      />
      <Tabs.Screen
        name="drinks"
        options={{
          title: 'Drinks',
          tabBarIcon: tabIcon({ ios: 'wineglass.fill', android: 'local_bar', web: 'local_bar' }),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: tabIcon({ ios: 'clock.fill', android: 'history', web: 'history' }),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  gear: { paddingHorizontal: Spacing.md },
});
