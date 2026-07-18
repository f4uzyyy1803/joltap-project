// src/components/SOSButton.js
import React, { useRef, useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, Alert, Vibration } from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { activateSOS } from '../services/api';
import { colors } from '../theme';

export default function SOSButton({ userId = 'user_001', style }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleSOS = async () => {
    // Вибрация
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Vibration.vibrate([0, 300, 100, 300]);

    Alert.alert(
      '🆘 SOS',
      'Вы уверены? Экстренные службы и ваши контакты будут уведомлены.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отправить SOS',
          style: 'destructive',
          onPress: async () => {
            try {
              // Получаем геолокацию
              const { status } = await Location.requestForegroundPermissionsAsync();
              let lat = 43.238949, lon = 76.889709; // дефолт Алматы

              if (status === 'granted') {
                const loc = await Location.getCurrentPositionAsync({});
                lat = loc.coords.latitude;
                lon = loc.coords.longitude;
              }

              // Отправляем SOS на бэкенд
              const result = await activateSOS(
                userId, lat, lon,
                'Нужна помощь!',
                [] // добавь контакты из профиля
              );

              Alert.alert(
                '✅ SOS отправлен',
                `Геолокация: ${lat.toFixed(4)}, ${lon.toFixed(4)}\nКонтакты уведомлены: ${result.notified_contacts}`
              );
            } catch (e) {
              Alert.alert('Ошибка', 'Не удалось отправить SOS. Проверьте подключение.');
            }
          },
        },
      ]
    );
  };

  return (
    <Animated.View style={[styles.wrap, style, { transform: [{ scale: pulse }] }]}>
      <TouchableOpacity style={styles.btn} onPress={handleSOS} activeOpacity={0.8}>
        <Text style={styles.text}>SOS</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 50, right: 16, zIndex: 99 },
  btn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.red,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.red, shadowOpacity: 0.6,
    shadowRadius: 12, elevation: 8,
  },
  text: { color: 'white', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
});
