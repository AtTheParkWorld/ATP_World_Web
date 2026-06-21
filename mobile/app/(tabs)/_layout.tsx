/**
 * Bottom-tab navigator — Home / Sessions / Community / Rewards / Profile.
 *
 * Tab bar: ATP-dark background, green active accent, Barlow Condensed
 * labels for ATP feel. Icons load from a single inline set so we don't
 * pull a heavy icon library; can swap to @expo/vector-icons later.
 *
 * Auth gate: subscribes to the access token. If it ever becomes null
 * while we're inside the tab navigator (sign-out, refresh-token expiry,
 * server-side revoke) we bounce back to /(auth)/welcome. Keeps the
 * Profile button and the API-client refresh interceptor consistent —
 * neither has to redirect by hand.
 */
import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { Text } from 'react-native';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { useAuthStore } from '@/lib/stores/auth.store';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>
  );
}

export default function TabsLayout() {
  const accessToken = useAuthStore((s) => s.accessToken);
  useEffect(() => {
    if (!accessToken) router.replace('/(auth)/welcome');
  }, [accessToken]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: colors.dark,
          borderTopColor: 'rgba(255,255,255,0.06)',
          height: 78,
          paddingBottom: 18,
          paddingTop: 10,
        },
        tabBarActiveTintColor:   colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontFamily: fontFamily.bodyBold,
          fontSize: 11,
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon glyph="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ focused }) => <TabIcon glyph="📅" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ focused }) => <TabIcon glyph="🤝" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ focused }) => <TabIcon glyph="🎁" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon glyph="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
