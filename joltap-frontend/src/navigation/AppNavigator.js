// src/navigation/AppNavigator.js
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { SplashScreen, WelcomeScreen, LoginScreen, RegisterScreen, OTPScreen } from '../screens/AuthScreens';
import HomeScreen    from '../screens/HomeScreen';
import MapScreen     from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { colors } from '../theme';

// ─── Вкладки (нижнее меню) ───────────────────────────────
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.purple,
        tabBarInactiveTintColor: '#aaa',
        tabBarStyle: {
          borderTopWidth: 1, borderTopColor: '#eee',
          paddingBottom: 8, paddingTop: 4, height: 64,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Home:    focused ? 'home'         : 'home-outline',
            Map:     focused ? 'map'          : 'map-outline',
            Profile: focused ? 'person'       : 'person-outline',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
        tabBarLabel: ({ color }) => {
          const labels = { Home: 'Главная', Map: 'Карта', Profile: 'Профиль' };
          return null; // без подписей, только иконки
        },
      })}
    >
      <Tab.Screen name="Home"    component={HomeScreen} />
      <Tab.Screen name="Map"     component={MapScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// ─── Стек навигации ──────────────────────────────────────
const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* Auth */}
        <Stack.Screen name="Splash"   component={SplashScreen} />
        <Stack.Screen name="Welcome"  component={WelcomeScreen} />
        <Stack.Screen name="Login"    component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="OTP"      component={OTPScreen} />

        {/* Main app */}
        <Stack.Screen name="Main" component={MainTabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
