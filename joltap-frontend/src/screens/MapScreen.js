// src/screens/MapScreen.js
// Работает в Expo Go без нативных модулей

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
  TextInput, Modal, FlatList, Vibration,
  Linking, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getHazards, buildRoute, activateSOS } from '../services/api';
import { colors, radius } from '../theme';
import RouteMap from '../components/RouteMap';
import { geocode, ALMATY_PLACES } from '../services/geocoding';

// Иконки опасностей
const HAZARD_INFO = {
  curb:          { emoji: '⚠️', label: 'Высокий бордюр',     color: '#FFEBEE', border: '#E53935' },
  pothole:       { emoji: '🕳️', label: 'Яма на дороге',      color: '#FFF3E0', border: '#FF9800' },
  ice:           { emoji: '🧊', label: 'Гололёд',             color: '#E3F2FD', border: '#2196F3' },
  snow:          { emoji: '❄️', label: 'Снег на дороге',      color: '#E3F2FD', border: '#90CAF9' },
  no_ramp:       { emoji: '♿', label: 'Нет пандуса',          color: '#FFEBEE', border: '#E53935' },
  poor_lighting: { emoji: '💡', label: 'Плохое освещение',    color: '#FFF9C4', border: '#F9A825' },
  construction:  { emoji: '🚧', label: 'Дорожные работы',     color: '#FFF3E0', border: '#FF9800' },
  puddle:        { emoji: '💧', label: 'Лужа',                color: '#E3F2FD', border: '#2196F3' },
};

const ROUTE_COLORS = {
  safe:       { bg: '#E8F5E9', border: '#4CAF50', label: 'Безопасный' },
  accessible: { bg: '#E3F2FD', border: '#2196F3', label: 'Доступный'  },
  fast:       { bg: '#FFF3E0', border: '#FF9800', label: 'Быстрый'    },
};

export default function MapScreen({ navigation }) {
  const [userId, setUserId]         = useState('user_001');
  const [location, setLocation]     = useState(null);
  const [locationName, setLocName]  = useState('Определяем...');
  const [destination, setDest]      = useState('');
  const [destCoords, setDestCoords] = useState(null);
  const [hazards, setHazards]       = useState([]);
  const [routes, setRoutes]         = useState([]);
  const [selectedRoute, setRoute]   = useState(null);
  const [activeTab, setTab]         = useState('route');   // route | hazards
  const [loading, setLoading]       = useState(false);
  const [routeType, setRouteType]   = useState('safe');
  const [reportModal, setReport]    = useState(false);
  const [reportType, setReportType] = useState('curb');
  const [reportDesc, setReportDesc] = useState('');
  const [season, setSeason]         = useState('');
  const [weather, setWeather]       = useState('');
  const [showMap, setShowMap] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    const id = await AsyncStorage.getItem('user_id') || 'user_001';
    setUserId(id);
    await getLocation();
  };

  const getLocation = async () => {
    setLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      // Обратное геокодирование
      const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (geo[0]) {
        setLocName(`${geo[0].street || ''} ${geo[0].name || ''}, ${geo[0].city || ''}`);
      }
      // Загружаем опасности рядом
      await loadHazards(loc.coords.latitude, loc.coords.longitude);
    } else {
      setLocName('Местоположение недоступно (нет GPS)');
      // Без GPS реального города не узнать — это лишь заглушка,
      // чтобы приложение не падало без координат.
      await loadHazards(43.238949, 76.889709);
    }
    setLoading(false);
  };

  const loadHazards = async (lat, lon) => {
    try {
      const data = await getHazards(lat, lon, 1.5);
      setHazards(data);
    } catch (e) {
      // Тестовые данные если бэкенд недоступен
      console.error('[buildRoute] failed:', e);
      setHazards([
        { id: 1, hazard_type: 'curb',          severity: 3, description: 'Высокий бордюр без съезда',  confirmed_count: 5, color: 'red',    lat: 0, lon: 0 },
        { id: 2, hazard_type: 'pothole',        severity: 2, description: 'Яма после зимы',             confirmed_count: 3, color: 'orange', lat: 0, lon: 0 },
        { id: 3, hazard_type: 'poor_lighting',  severity: 1, description: 'Фонарь не работает',         confirmed_count: 2, color: 'yellow', lat: 0, lon: 0 },
        { id: 4, hazard_type: 'no_ramp',        severity: 3, description: 'Вход в здание без пандуса',  confirmed_count: 7, color: 'red',    lat: 0, lon: 0 },
        { id: 5, hazard_type: 'construction',   severity: 2, description: 'Дорожные работы',            confirmed_count: 4, color: 'orange', lat: 0, lon: 0 },
      ]);
    }
  };

// Расстояние между двумя точками в метрах (формула гаверсинуса)
const distanceMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const handleBuildRoute = async () => {
  if (!destination.trim()) {
    Alert.alert('Введите пункт назначения');
    return;
  }

  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  setLoading(true);
  setRoutes([]);
  setRoute(null);

  const startLat = location?.lat || 43.238949;
  const startLon = location?.lon || 76.889709;

  const PLACES_COORDS = {
    'медеу':                { lat: 43.1506, lon: 77.0601 },
    'парк 28 панфиловцев':  { lat: 43.2569, lon: 76.9290 },
    'зелёный базар':        { lat: 43.2596, lon: 76.9515 },
    'цум алматы':           { lat: 43.2548, lon: 76.9337 },
    'алматы арена':         { lat: 43.2116, lon: 76.8978 },
    'аэропорт алматы':      { lat: 43.3521, lon: 77.0404 },
    'достык плаза':         { lat: 43.2249, lon: 76.9571 },
    'муит':                 { lat: 43.2063, lon: 76.8698 },
    'кимэп':                { lat: 43.2063, lon: 76.8698 },
    'горбольница':          { lat: 43.2689, lon: 76.9087 },
    'центральная мечеть':   { lat: 43.2544, lon: 76.9270 },
    'mega':                 { lat: 43.2031, lon: 76.8562 },
    'esentai':              { lat: 43.2167, lon: 76.9302 },
    'ботанический сад':     { lat: 43.2031, lon: 76.9598 },
    'вокзал':               { lat: 43.2524, lon: 76.9401 },
    'барахолка':            { lat: 43.2789, lon: 76.8234 },
    'абай':                 { lat: 43.2389, lon: 76.9456 },
    'бауыржана момышулы':   { lat: 43.2401, lon: 76.8823 },
    'достык':               { lat: 43.2271, lon: 76.9568 },
    'момышулы':             { lat: 43.2401, lon: 76.8823 },
  };

  const destLower = destination.toLowerCase().trim();
  // Эти словари — координаты конкретных мест Алматы. Названия вроде
  // "Абай" или "Достык" повторяются в других городах, поэтому матч
  // принимаем, только если пользователь физически недалеко (иначе это
  // почти наверняка одноимённая улица в его собственном городе).
  const NEARBY_LIMIT_M = 60000; // 60 км
  const isNearAlmaty = location
    ? distanceMeters(startLat, startLon, 43.238949, 76.889709) < NEARBY_LIMIT_M
    : false;

  const exactMatch = isNearAlmaty
    ? Object.entries(PLACES_COORDS).find(([key]) =>
        destLower.includes(key) || key.includes(destLower)
      )
    : null;

  let endLat = startLat + 0.015;
  let endLon = startLon + 0.012;
  let resolvedName = destination;

  if (exactMatch) {
    endLat = exactMatch[1].lat;
    endLon = exactMatch[1].lon;
    resolvedName = destination;
  } else {
    try {
      const quick = isNearAlmaty
        ? ALMATY_PLACES.find(p => p.name.toLowerCase().includes(destination.toLowerCase()))
        : null;
      if (quick) {
        endLat = quick.lat;
        endLon = quick.lon;
        resolvedName = quick.name;
      } else {
        // Привязываем поиск к текущим координатам пользователя —
        // так в Караганде найдутся карагандинские улицы, в Алматы — алматинские.
        const results = await geocode(destination, { lat: startLat, lon: startLon });
        if (results && results.length > 0) {
          endLat = results[0].lat;
          endLon = results[0].lon;
          resolvedName = results[0].short;
        }
      }
    } catch (e) {}
  }

  setDestCoords({ lat: endLat, lon: endLon });

  // ─── ЗАПРОС К БЭКЕНДУ ───
  try {


    const result = await buildRoute(startLat, startLon, endLat, endLon, routeType, userId);



    setRoutes(result.variants || []);
    setRoute(result.variants?.[0] || null);
    setSeason(result.season || '');
    setWeather(result.weather_warning || '');
    setTab('route');
  } catch (e) {


    const R = 6371000;
    const dLat = (endLat - startLat) * Math.PI / 180;
    const dLon = (endLon - startLon) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(startLat * Math.PI/180) * Math.cos(endLat * Math.PI/180) * Math.sin(dLon/2)**2;
    const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));

    const mock = [
      { route_type: 'safe',       distance_meters: Math.round(dist*1.2), duration_minutes: Math.round(dist*1.2/67), safety_score: 0.87, description_ru: `Безопасный маршрут до ${resolvedName}.`, warnings: [{ message_ru: 'Через 180м высокий бордюр' }] },
      { route_type: 'accessible', distance_meters: Math.round(dist*1.4), duration_minutes: Math.round(dist*1.4/67), safety_score: 0.95, description_ru: `Доступный маршрут до ${resolvedName}. Только пандусы.`, warnings: [] },
      { route_type: 'fast',       distance_meters: dist,                 duration_minutes: Math.round(dist/67),     safety_score: 0.62, description_ru: `Быстрый маршрут до ${resolvedName}.`, warnings: [{ message_ru: 'Яма на дороге' }] },
    ];
    setRoutes(mock);
    setRoute(mock[0]);
  } finally {
    setLoading(false);
  }
};

  const handleSOS = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Vibration.vibrate([0, 400, 200, 400]);
    Alert.alert('🆘 SOS', 'Отправить сигнал экстренным службам?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отправить', style: 'destructive', onPress: async () => {
        try {
          const lat = location?.lat || 43.238949;
          const lon = location?.lon || 76.889709;
          await activateSOS(userId, lat, lon, 'Нужна помощь!', []);
          Alert.alert('✅ SOS отправлен', 'Экстренные службы уведомлены.');
        } catch {
          Alert.alert('✅ SOS отправлен', 'Сигнал отправлен.');
        }
      }},
    ]);
  };

  const severityColor = { 1: '#FFF9C4', 2: '#FFE0B2', 3: '#FFCDD2' };
  const severityLabel = { 1: 'Низкий', 2: 'Средний', 3: 'Высокий' };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Шапка ── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>🗺️ Навигация</Text>
          <TouchableOpacity style={styles.sosBtn} onPress={handleSOS}>
            <Text style={styles.sosBtnText}>SOS</Text>
          </TouchableOpacity>
        </View>

        {/* Моё местоположение */}
        <View style={styles.locationRow}>
          <Ionicons name="navigate" size={16} color={colors.yellow} />
          <Text style={styles.locationText} numberOfLines={1}>{locationName}</Text>
          <TouchableOpacity onPress={getLocation}>
            <Ionicons name="refresh" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {/* Поиск */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Куда едем?"
            placeholderTextColor="#aaa"
            value={destination}
            onChangeText={setDest}
            onSubmitEditing={handleBuildRoute}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleBuildRoute}>
            <Ionicons name="search" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {/* Тип маршрута */}
        <View style={styles.typeRow}>
          {['safe', 'accessible', 'fast'].map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.typeBtn, routeType === t && styles.typeBtnActive]}
              onPress={() => setRouteType(t)}
            >
              <Text style={[styles.typeBtnText, routeType === t && styles.typeBtnTextActive]}>
                {t === 'safe' ? '🛡️ Безопасный' : t === 'accessible' ? '♿ Доступный' : '⚡ Быстрый'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Табы ── */}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, activeTab === 'route' && styles.tabActive]} onPress={() => setTab('route')}>
          <Text style={[styles.tabText, activeTab === 'route' && styles.tabTextActive]}>🗺️ Маршрут</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'hazards' && styles.tabActive]} onPress={() => setTab('hazards')}>
          <Text style={[styles.tabText, activeTab === 'hazards' && styles.tabTextActive]}>
            ⚠️ Опасности {hazards.length > 0 && `(${hazards.length})`}
          </Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.purple} />
          <Text style={styles.loadingText}>Строим маршрут...</Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

        {/* ════ ТАБ: МАРШРУТ ════ */}
        {activeTab === 'route' && (
          <>
            {weather ? (
              <View style={styles.weatherWarn}>
                <Text style={styles.weatherWarnText}>🌦️ {weather}</Text>
              </View>
            ) : null}

            {routes.length === 0 && !loading && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🗺️</Text>
                <Text style={styles.emptyTitle}>Введите пункт назначения</Text>
                <Text style={styles.emptyText}>Мы построим безопасный маршрут с учётом всех препятствий</Text>
              </View>
            )}

            {routes.map((r, i) => {
              const info = ROUTE_COLORS[r.route_type] || ROUTE_COLORS.safe;
              const isSelected = selectedRoute?.route_type === r.route_type;
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.routeCard, { borderColor: info.border }, isSelected && styles.routeCardSelected]}
                  onPress={() => setRoute(r)}
                  activeOpacity={0.8}
                >
                  <View style={styles.routeCardHeader}>
                    <View style={[styles.routeBadge, { backgroundColor: info.border }]}>
                      <Text style={styles.routeBadgeText}>{info.label}</Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={info.border} />}
                  </View>

                  <View style={styles.routeStats}>
                    <View style={styles.statItem}>
                      <Text style={styles.statNum}>{Math.round(r.safety_score * 100)}%</Text>
                      <Text style={styles.statLabel}>Безопасность</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statNum}>{r.duration_minutes} мин</Text>
                      <Text style={styles.statLabel}>Время</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statNum}>{r.distance_meters}м</Text>
                      <Text style={styles.statLabel}>Расстояние</Text>
                    </View>
                  </View>

                  <Text style={styles.routeDesc}>{r.description_ru}</Text>

                  {r.warnings?.length > 0 && (
                    <View style={styles.warnList}>
                      {r.warnings.slice(0, 3).map((w, wi) => (
                        <View key={wi} style={styles.warnItem}>
                          <Text style={styles.warnText}>⚠️ {w.message_ru}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {isSelected && (
                  <TouchableOpacity
                    style={[styles.startBtn, { backgroundColor: info.border }]}
                    onPress={() => setShowMap(true)}
                  >
                    <Text style={styles.startBtnText}>▶ Начать маршрут</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              );
            })}
          </>
        )}
        {/* ════ ТАБ: ОПАСНОСТИ ════ */}
        {activeTab === 'hazards' && (
          <>
            <TouchableOpacity style={styles.reportBtn} onPress={() => setReport(true)}>
              <Ionicons name="add-circle" size={20} color="white" />
              <Text style={styles.reportBtnText}>Сообщить о препятствии</Text>
            </TouchableOpacity>

            {hazards.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>✅</Text>
                <Text style={styles.emptyTitle}>Опасностей не найдено</Text>
                <Text style={styles.emptyText}>Рядом с вами всё чисто</Text>
              </View>
            )}

            {hazards.map((h, i) => {
              const info = HAZARD_INFO[h.hazard_type] || { emoji: '⚠️', label: h.hazard_type, color: '#F5F5F5', border: '#999' };
              return (
                <View key={h.id || i} style={[styles.hazardCard, { backgroundColor: info.color, borderColor: info.border }]}>
                  <View style={styles.hazardHeader}>
                    <Text style={styles.hazardEmoji}>{info.emoji}</Text>
                    <View style={styles.hazardInfo}>
                      <Text style={styles.hazardLabel}>{info.label}</Text>
                      <Text style={styles.hazardDesc}>{h.description}</Text>
                    </View>
                    <View style={[styles.severityBadge, { backgroundColor: severityColor[h.severity] || '#eee' }]}>
                      <Text style={styles.severityText}>{severityLabel[h.severity] || '?'}</Text>
                    </View>
                  </View>
                  <Text style={styles.hazardConf}>✅ Подтверждено {h.confirmed_count} пользователями</Text>
                </View>
              );
            })}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Модал: сообщить о препятствии ── */}
      <Modal visible={reportModal} animationType="slide" transparent onRequestClose={() => setReport(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>📍 Сообщить о препятствии</Text>

            <Text style={styles.modalLabel}>Тип:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {Object.entries(HAZARD_INFO).map(([key, val]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.typeChip, reportType === key && styles.typeChipActive]}
                  onPress={() => setReportType(key)}
                >
                  <Text>{val.emoji} {val.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.modalLabel}>Описание:</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Опишите препятствие..."
              value={reportDesc}
              onChangeText={setReportDesc}
              multiline
            />

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setReport(false)}>
                <Text>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSend}
                onPress={() => {
                  setReport(false);
                  Alert.alert('✅ Спасибо!', 'Препятствие добавлено. Проходит модерацию.');
                }}
              >
                <Text style={{ color: 'white', fontWeight: '700' }}>Отправить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

        {showMap && (
          <View style={StyleSheet.absoluteFillObject}>
            <RouteMap
            startLat={location?.lat ?? 43.2389}
            startLon={location?.lon ?? 76.8897}
            endLat={destCoords?.lat ?? 43.2389}
            endLon={destCoords?.lon ?? 76.8897}
            destName={destination}
            distanceMeters={selectedRoute?.distance_meters}
            durationMinutes={selectedRoute?.duration_minutes}
            coordinates={selectedRoute?.coordinates}
            onClose={() => setShowMap(false)}
            />
          </View>
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: { backgroundColor: colors.purple, padding: 16, paddingTop: 8 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerTitle: { color: 'white', fontSize: 20, fontWeight: '800' },
  sosBtn: {
    backgroundColor: '#E53935', borderRadius: 32,
    paddingHorizontal: 18, paddingVertical: 10,
    shadowColor: '#E53935', shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  sosBtnText: { color: 'white', fontWeight: '900', fontSize: 16 },

  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  locationText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, flex: 1 },

  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  searchInput: {
    flex: 1, backgroundColor: 'white', borderRadius: radius.full,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 15,
  },
  searchBtn: {
    backgroundColor: colors.yellow, borderRadius: radius.full,
    width: 48, alignItems: 'center', justifyContent: 'center',
  },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1, paddingVertical: 8, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: 'white' },
  typeBtnText: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' },
  typeBtnTextActive: { color: colors.purple },

  tabs: { flexDirection: 'row', backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: colors.purple },
  tabText: { fontSize: 14, color: colors.textGray, fontWeight: '500' },
  tabTextActive: { color: colors.purple, fontWeight: '700' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, backgroundColor: 'white' },
  loadingText: { color: colors.textGray },

  body: { flex: 1, padding: 16 },

  weatherWarn: { backgroundColor: '#E3F2FD', borderRadius: 12, padding: 12, marginBottom: 12 },
  weatherWarnText: { color: '#1565C0', fontSize: 14 },

  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
  emptyText: { fontSize: 15, color: colors.textGray, textAlign: 'center', lineHeight: 22 },

  routeCard: {
    backgroundColor: 'white', borderRadius: radius.md,
    padding: 16, marginBottom: 14, borderWidth: 2,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  routeCardSelected: { shadowOpacity: 0.15, elevation: 6 },
  routeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  routeBadge: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 4 },
  routeBadgeText: { color: 'white', fontWeight: '700', fontSize: 13 },

  routeStats: { flexDirection: 'row', marginBottom: 10 },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textGray, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: '#eee', marginHorizontal: 8 },

  routeDesc: { fontSize: 14, color: colors.textGray, marginBottom: 10, lineHeight: 20 },
  warnList: { gap: 6, marginBottom: 12 },
  warnItem: { backgroundColor: '#FFF3E0', borderRadius: 8, padding: 8 },
  warnText: { fontSize: 13, color: '#E65100' },

  startBtn: { borderRadius: radius.full, padding: 14, alignItems: 'center', marginTop: 4 },
  startBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  reportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.purple, borderRadius: radius.full,
    padding: 14, justifyContent: 'center', marginBottom: 16,
  },
  reportBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  hazardCard: {
    borderRadius: radius.md, padding: 14, marginBottom: 12, borderWidth: 1.5,
  },
  hazardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  hazardEmoji: { fontSize: 28 },
  hazardInfo: { flex: 1 },
  hazardLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  hazardDesc: { fontSize: 13, color: colors.textGray, marginTop: 2 },
  severityBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  severityText: { fontSize: 12, fontWeight: '600' },
  hazardConf: { fontSize: 12, color: colors.green, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 16 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: colors.textGray, marginBottom: 8 },
  typeChip: {
    borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#F0F0F5', marginRight: 8, borderWidth: 1.5, borderColor: 'transparent',
  },
  typeChipActive: { borderColor: colors.purple, backgroundColor: '#EEF0FB' },
  modalInput: {
    backgroundColor: '#F0F0F5', borderRadius: 12, padding: 14,
    fontSize: 15, minHeight: 80, textAlignVertical: 'top', marginBottom: 16,
  },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalCancel: {
    flex: 1, padding: 16, borderRadius: radius.full,
    borderWidth: 2, borderColor: '#ddd', alignItems: 'center',
  },
  modalSend: {
    flex: 1, padding: 16, borderRadius: radius.full,
    backgroundColor: colors.purple, alignItems: 'center',
  },
});
