// src/screens/HomeScreen.js
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import SOSButton from '../components/SOSButton';
import { getWeather } from '../services/api';
import { colors, radius } from '../theme';

const ARTICLES = [
  { id: 1, emoji: '👩‍⚕️', title: 'Как оставаться здоровым', color: '#FFD4B8', titleColor: '#E06020' },
  { id: 2, emoji: '💼', title: 'Как найти работу',           color: '#C8D4FF', titleColor: '#4450AA' },
  { id: 3, emoji: '🤖', title: 'Полезные технологии',        color: '#FFB8C8', titleColor: '#CC2244' },
];

export default function HomeScreen({ navigation }) {
  const [userName, setUserName] = useState('');
  const [userId, setUserId]   = useState('');
  const [weather, setWeather] = useState({ temp: '—', city: 'Алматы', feels: '—', desc: 'загрузка...', emoji: '⛅', ice_risk: false });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadUser();
    loadWeather();
  }, []);

  const loadUser = async () => {
    const name = await AsyncStorage.getItem('user_name') || 'Пользователь';
    const id   = await AsyncStorage.getItem('user_id')   || 'user_001';
    setUserName(name);
    setUserId(id);
  };

  const loadWeather = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let lat = 43.238949, lon = 76.889709; // Алматы по умолчанию, если нет доступа к геолокации
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      }
      const data = await getWeather(lat, lon);
      setWeather({
        temp: `${data.temp > 0 ? '+' : ''}${data.temp}°`,
        city: data.city || 'Алматы',
        feels: `${data.feels_like > 0 ? '+' : ''}${data.feels_like}°`,
        desc: data.description,
        emoji: data.emoji,
        ice_risk: data.ice_risk,
      });
    } catch (e) {
      console.log('Weather error:', e.message);
      // Оставляем плейсхолдер, если бэкенд/ключ ещё не настроены
      setWeather({ temp: '—', city: 'Алматы', feels: '—', desc: 'нет данных', emoji: '⛅', ice_risk: false });
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUser();
    await loadWeather();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="white" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.logo}>Jol Tap</Text>
          <SOSButton userId={userId} />

          {/* Search */}
          <TouchableOpacity style={styles.searchBar} onPress={() => navigation.navigate('Map')} activeOpacity={0.8}>
            <Ionicons name="search" size={20} color={colors.textGray} />
            <Text style={styles.searchPlaceholder}>Поиск</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {/* ── Weather Card ── */}
          <View style={styles.weatherCard}>
            <View>
              <Text style={styles.weatherCity}>{weather.city}</Text>
              <Text style={styles.weatherTemp}>{weather.temp}</Text>
              <Text style={styles.weatherFeel}>ощущается как {weather.feels}</Text>
              <Text style={styles.weatherDesc}>{weather.desc}</Text>
              {weather.ice_risk && (
                <View style={styles.iceWarning}>
                  <Text style={styles.iceWarningText}>⚠️ Возможен гололёд</Text>
                </View>
              )}
            </View>
            <Text style={styles.weatherEmoji}>{weather.emoji}</Text>
          </View>

          {/* ── Premium Card ── */}
          <View style={styles.premiumCard}>
            <Text style={styles.premiumTitle}>Premium</Text>
            {['Персонализация', 'Безопасные маршруты', 'Карта опасных участков', 'Кнопка SOS', 'Информационный раздел'].map((f, i) => (
              <Text key={i} style={styles.premiumItem}>• {f}</Text>
            ))}
            <TouchableOpacity style={styles.premiumBtn}>
              <Text style={styles.premiumBtnText}>см. подробнее ›</Text>
            </TouchableOpacity>
          </View>

          {/* ── Articles ── */}
          <Text style={styles.sectionTitle}>Советы и статьи на сегодня</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.articlesRow}>
            {ARTICLES.map(a => (
              <TouchableOpacity
                key={a.id}
                style={[styles.articleCard, { backgroundColor: a.color }]}
                onPress={() => navigation.navigate('Article', { article: a })}
              >
                <Text style={styles.articleEmoji}>{a.emoji}</Text>
                <Text style={[styles.articleTitle, { color: a.titleColor }]}>{a.title}</Text>
                <TouchableOpacity style={styles.readBtn}>
                  <Text style={styles.readBtnText}>▶ Читать</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.purple },
  scroll:    { flex: 1 },
  header: { backgroundColor: colors.purple, padding: 20, paddingTop: 10, paddingBottom: 30 },
  logo: { fontSize: 28, fontWeight: '900', color: colors.yellow, marginBottom: 16 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'white', borderRadius: radius.full,
    paddingHorizontal: 20, paddingVertical: 14,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
  },
  searchPlaceholder: { color: colors.textGray, fontSize: 16, flex: 1 },

  body: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, minHeight: 600 },

  weatherCard: {
    backgroundColor: colors.purple, borderRadius: radius.md,
    padding: 20, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  weatherCity: { color: 'white', fontSize: 20, fontWeight: '700' },
  weatherTemp: { color: 'white', fontSize: 48, fontWeight: '900', lineHeight: 52 },
  weatherFeel: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  weatherDesc: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  weatherEmoji: { fontSize: 64 },
  iceWarning: {
    marginTop: 8, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
  },
  iceWarningText: { color: 'white', fontSize: 12, fontWeight: '700' },

  premiumCard: { backgroundColor: colors.purpleLight, borderRadius: radius.md, padding: 20, marginBottom: 24 },
  premiumTitle: { fontSize: 24, fontWeight: '900', color: colors.yellow, marginBottom: 12 },
  premiumItem: { color: 'white', fontSize: 14, paddingVertical: 2 },
  premiumBtn: {
    backgroundColor: colors.yellow, borderRadius: radius.full,
    paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-end', marginTop: 12,
  },
  premiumBtnText: { fontSize: 13, fontWeight: '700', color: colors.text },

  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 14, color: colors.text },
  articlesRow:  { marginBottom: 20 },
  articleCard: {
    width: 140, borderRadius: 16, padding: 14, marginRight: 14,
    alignItems: 'center', gap: 8,
  },
  articleEmoji: { fontSize: 40 },
  articleTitle: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  readBtn: { backgroundColor: colors.purple, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 6 },
  readBtnText: { color: 'white', fontSize: 12, fontWeight: '600' },
});
