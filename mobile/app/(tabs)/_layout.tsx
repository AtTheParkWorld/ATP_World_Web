/**
 * Bottom-tab navigator — Home / Sessions / Community / Rewards / Profile.
 *
 * Tab bar: ATP-dark background, green active accent, Barlow Condensed
 * labels. Each tab uses a hand-coded SVG from lib/components/icons
 * (matches the ATP design system v2), with a Reanimated focus
 * transition: when the tab becomes active, the icon springs up to
 * scale 1.15 and tints to ATP green; an "active dot" fades in beneath
 * it. The dot is the small visual anchor that confirms "you are here"
 * without leaning on heavy underlines or background swipes.
 *
 * Auth gate: subscribes to the access token. If it ever becomes null
 * while we're inside the tab navigator (sign-out, refresh-token expiry,
 * server-side revoke) we bounce back to /(auth)/welcome. Keeps the
 * Profile sign-out button and the API-client refresh interceptor
 * consistent — neither has to redirect by hand.
 */
import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { useAuthStore } from '@/lib/stores/auth.store';
import {
  IconHome,
  IconCalendar,
  IconCommunity,
  IconGift,
  IconProfile,
  type IconProps,
} from '@/lib/components/icons';

interface AnimatedTabIconProps {
  Component: React.FC<IconProps>;
  focused:   boolean;
}

function AnimatedTabIcon({ Component, focused }: AnimatedTabIconProps) {
  const scale = useSharedValue(focused ? 1.15 : 1);
  const dot   = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.15 : 1, { mass: 0.6, damping: 14, stiffness: 220 });
    dot.value   = withTiming(focused ? 1 : 0, { duration: 180 });
  }, [focused, scale, dot]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity:   dot.value,
    transform: [{ scale: 0.5 + dot.value * 0.5 }],
  }));

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 32 }}>
      <Animated.View style={iconStyle}>
        <Component
          size={26}
          color={focused ? colors.green : colors.muted}
          strokeWidth={focused ? 2.6 : 2.2}
        />
      </Animated.View>
      <Animated.View
        style={[
          dotStyle,
          {
            width: 4, height: 4, borderRadius: 2, backgroundColor: colors.green, marginTop: 3,
          },
        ]}
      />
    </View>
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
          height: 82,
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
          tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconHome} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconCalendar} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconCommunity} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconGift} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconProfile} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
