/**
 * Bottom-tab navigator — Home / Sessions / Community / Rewards / Store / Profile.
 *
 * Six tabs. Each uses a hand-coded SVG mark from lib/components/icons
 * with a continuous active-state animation:
 *   - Home       → sparkle stars twinkle
 *   - Sessions   → kettlebell tilts
 *   - Community  → heart beats lub-dub
 *   - Rewards    → gem sparkles
 *   - Store      → bag bounces
 *   - Profile    → arcs ripple
 *
 * The AnimatedTabIcon wrapper adds a spring scale 1.0 → 1.15 on focus
 * plus a 4px green dot that fades in beneath the icon — the icon's
 * own micro-animation runs on top of that.
 *
 * Auth gate: subscribes to the access token. If it ever becomes null
 * (sign-out, refresh-token expiry, server-side revoke) we bounce
 * back to /(auth)/welcome.
 */
import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { useAuthStore } from '@/lib/stores/auth.store';
import {
  IconTabHome,
  IconTabSessions,
  IconTabCommunity,
  IconTabRewards,
  IconTabStore,
  IconTabProfile,
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
          active={focused}
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
          fontSize: 10,
          letterSpacing: 0.25,
        },
        tabBarItemStyle: {
          paddingHorizontal: 0,
        },
      }}
    >
      <Tabs.Screen name="home"      options={{ title: 'Home',      tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconTabHome}      focused={focused} /> }} />
      <Tabs.Screen name="sessions"  options={{ title: 'Sessions',  tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconTabSessions}  focused={focused} /> }} />
      <Tabs.Screen name="community" options={{ title: 'Community', tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconTabCommunity} focused={focused} /> }} />
      <Tabs.Screen name="rewards"   options={{ title: 'Rewards',   tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconTabRewards}   focused={focused} /> }} />
      <Tabs.Screen name="store"     options={{ title: 'Store',     tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconTabStore}     focused={focused} /> }} />
      <Tabs.Screen name="profile"   options={{ title: 'Profile',   tabBarIcon: ({ focused }) => <AnimatedTabIcon Component={IconTabProfile}   focused={focused} /> }} />
    </Tabs>
  );
}
