/**
 * Bottom-tab navigator — Home / Sessions / Community / Rewards / Profile.
 *
 * Tab bar: ATP-dark background, green active accent, Barlow Condensed
 * labels. Each tab uses a ChatGPT-designed PNG mark (white silhouette
 * on transparent) tinted at runtime — muted grey when inactive, ATP
 * green when active. Reanimated focus transition: scale 1.0 → 1.15
 * spring, plus a 4px active-dot that fades in beneath the icon.
 *
 * Auth gate: subscribes to the access token. If it ever becomes null
 * while we're inside the tab navigator (sign-out, refresh-token expiry,
 * server-side revoke) we bounce back to /(auth)/welcome.
 */
import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { View, Image, type ImageSourcePropType } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { useAuthStore } from '@/lib/stores/auth.store';

const TAB_ICONS: Record<string, ImageSourcePropType> = {
  home:      require('@/assets/images/icon-tab-home.png'),
  sessions:  require('@/assets/images/icon-tab-sessions.png'),
  community: require('@/assets/images/icon-tab-community.png'),
  rewards:   require('@/assets/images/icon-tab-rewards.png'),
  profile:   require('@/assets/images/icon-tab-profile.png'),
};

interface AnimatedTabIconProps {
  source:  ImageSourcePropType;
  focused: boolean;
}

function AnimatedTabIcon({ source, focused }: AnimatedTabIconProps) {
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
        <Image
          source={source}
          style={{
            width: 26,
            height: 26,
            tintColor: focused ? colors.green : colors.muted,
          }}
          resizeMode="contain"
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
          tabBarIcon: ({ focused }) => <AnimatedTabIcon source={TAB_ICONS.home} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon source={TAB_ICONS.sessions} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon source={TAB_ICONS.community} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon source={TAB_ICONS.rewards} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <AnimatedTabIcon source={TAB_ICONS.profile} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
