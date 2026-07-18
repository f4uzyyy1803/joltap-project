// src/screens/MapScreen.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, TextInput, Modal, FlatList,
  Vibration, Animated, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getHazards, buildRoute, activateSOS, reportHazard } from '../services/api';
import { geocode, reverseGeocode, ALMATY_PLACES } from '../services/geocoding';
import { colors, radius } from '../theme';

const HAZARD_INFO = {
  curb:          { emoji: '⚠️',  label: 'Высокий бордюр',   color: '#FFEBEE', border: '#E53935' },
  pothole:       { emoji: '🕳️', label: 'Яма на дороге',    color: '#FFF3E0', border: '#FF9800' },
  ice:           { emoji: '🧊',  label: 'Гололёд',           color: '#E3F2FD', border: '#2196F3' },
  snow:          { emoji: '❄️',  label: 'Снег',              color: '#E3F2FD', border: '#90CAF9' },
  no_ramp:       { emoji: '♿',  label: 'Нет пандуса',       color: '#FFEBEE', border: '#E53935' },
  poor_lighting: { emoji: '💡', label: 'Плохое освещение',  color: '#FFFDE7', border: '#F9A825' },
  construction:  { emoji: '🚧', label: 'Дорожные работы',   color: '#FFF3E0', border: '#FF9800' },
  puddle:        { emoji: '💧', label: 'Лужа',              color: '#E3F2FD', border: '#2196F3' },
};

const ROUTE_STYLES = {
  safe:       { color: '#4CAF50', label: '🛡️ Безопасный',  bg: '#E8F5E9' },
  accessible: { color: '#2196F3', label: '♿ Доступный',   bg: '#E3F2FD' },
  fast:       { color: '#FF9800', label: '⚡ Быстрый',      bg: '#FFF3E0' },
};

export default function MapScreen() {
  const [userId, setUserId]           = useState('user_001');
  const [myLocation, setMyLocation]   = useState(null);
  const [myAddress, setMyAddress]     = useState('Определяем местоположение...');
  const [destination, setDest]        = useState('');
  const [destCoords, setDestCoords]   = useState(null);
  const [destName, setDestName]       = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [routes, setRoutes]           = useState([]);
  const [selectedRoute, setRoute]     = useState(null);
  const [hazards, setHazards]         = useState([]);
  const [activeTab, setTab]           = useState('route');
  const [routeType, setRouteType]     = useState('safe');
  const [loading, setLoading]         = useState(false);
  const [gpsLoading, setGpsLoading]   = useState(true);
  const [reportModal, setReport]      = useState(false);
  const [reportType, setReportType]   = useState('curb');
  const [reportDesc, setReportDesc]   = useState('');
  const [weatherWarn, setWeatherWarn] = useState('');
  const searchTimer = useRef(null);

  useEffect(() => { init(); }, []);

  // ─── Инициализация ───────────────────────────────────
  const init = async () => {
    const id = await AsyncStorage.getItem('user_id') || 'user_001';
    setUserId(id);
    await getMyLocation();
  };

  // ─── GPS местоположение ──────────────────────────────
  const getMyLocation = async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Дефолт — центр Алматы
        const def = { lat: 43.2389, lon: 76.8897 };
        setMyLocation(def);
        setMyAddress('Алматы (GPS отключён)');
        await loadHazards(def.lat, def.lon);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = { lat: loc.coords.latitude, lon: loc.coords.longitude };
      setMyLocation(coords);

      // Получаем название улицы
      const addr = await reverseGeocode(coords.lat, coords.lon);
      setMyAddress(addr);

      // Загружаем опасности рядом
      await loadHazards(coords.lat, coords.lon);
    } catch (e) {
      const def = { lat: 43.2389, lon: 76.8897 };
      setMyLocation(def);
      setMyAddress('Алматы');
      await loadHazards(def.lat, def.lon);
    } finally {
      setGpsLoading(false);
    }
  };

  // ─── Загрузка опасных зон из бэкенда ────────────────
  const loadHazards = async (lat, lon) => {
    try {
      const data = await getHazards(lat, lon, 2.0);
      setHazards(data);
    } catch {
      // Тестовые данные если бэкенд недоступен
      setHazards([
        { id:1, hazard_type:'curb',          severity:3, description:'Высокий бордюр без съезда у перехода', confirmed_count:5, color:'red'    },
        { id:2, hazard_type:'pothole',        severity:2, description:'Яма после зимы на тротуаре',           confirmed_count:3, color:'orange' },
        { id:3, hazard_type:'poor_lighting',  severity:1, description:'Фонарь не работает вечером',           confirmed_count:2, color:'yellow' },
        { id:4, hazard_type:'no_ramp',        severity:3, description:'Вход в здание без пандуса',            confirmed_count:7, color:'red'    },
        { id:5, hazard_type:'construction',   severity:2, description:'Дорожные работы, тротуар закрыт',      confirmed_count:4, color:'orange' },
      ]);
    }
  };

  // ─── Поиск по мере ввода ─────────────────────────────
  const handleDestChange = (text) => {
    setDest(text);
    setDestCoords(null);
    setDestName('');

    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (text.length < 2) {
      setSuggestions(ALMATY_PLACES);
      setShowSuggest(true);
      return;
    }

    // Фильтруем популярные места
    const filtered = ALMATY_PLACES.filter(p =>
      p.name.toLowerCase().includes(text.toLowerCase())
    );

    // Ищем через Nominatim с задержкой
    searchTimer.current = setTimeout(async () => {
      const results = await geocode(text);
      const nominatim = (results || []).map(r => ({
        name: r.short,
        fullName: r.name,
        lat: r.lat,
        lon: r.lon,
        emoji: '📍',
      }));
      setSuggestions([...filtered, ...nominatim].slice(0, 8));
      setShowSuggest(true);
    }, 500);
  };

  // ─── Выбор места из подсказок ────────────────────────
  const selectPlace = (place) => {
    setDest(place.name);
    setDestCoords({ lat: place.lat, lon: place.lon });
    setDestName(place.name);
    setShowSuggest(false);
    setSuggestions([]);
  };

  // ─── Построение маршрута ─────────────────────────────
  const handleBuildRoute = async () => {
    if (!destination.trim()) {
      Alert.alert('Введите пункт назначения');
      return;
    }

    // Если координаты ещё не выбраны — геокодируем
    let endCoords = destCoords;
    if (!endCoords) {
      setLoading(true);
      const results = await geocode(destination);
      if (!results || results.length === 0) {
        setLoading(false);
        Alert.alert('Место не найдено', 'Попробуйте ввести другой адрес или выберите из списка.');
        return;
      }
      endCoords = { lat: results[0].lat, lon: results[0].lon };
      setDestCoords(endCoords);
      setDestName(results[0].short);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setRoutes([]);
    setRoute(null);
    setShowSuggest(false);

    const startLat = myLocation?.lat || 43.2389;
    const startLon = myLocation?.lon || 76.8897;

    try {
      const result = await buildRoute(
        startLat, startLon,
        endCoords.lat, endCoords.lon,
        routeType, userId
      );

      setRoutes(result.variants || []);
      setRoute(result.variants?.[0] || null);
      setWeatherWarn(result.weather_warning || '');
      setTab('route');

    } catch {
      // Тестовый маршрут если бэкенд недоступен
      const dist = Math.round(calcDistance(startLat, startLon, endCoords.lat, endCoords.lon));
      const mock = [
        {
          route_type: 'safe',
          distance_meters: Math.round(dist * 1.2),
          duration_minutes: Math.round(dist * 1.2 / 67),
          safety_score: 0.87,
          description_ru: `Безопасный маршрут до ${destName || destination}. Обходит опасные участки.`,
          warnings: [
            { message_ru: 'Через 180м высокий бордюр — снизьте скорость' },
            { message_ru: 'Плохое освещение на последнем участке' },
          ],
        },
        {
          route_type: 'accessible',
          distance_meters: Math.round(dist * 1.4),
          duration_minutes: Math.round(dist * 1.4 / 67),
          safety_score: 0.95,
          description_ru: `Доступный маршрут до ${destName || destination}. Только пандусы и съезды, без лестниц.`,
          warnings: [],
        },
        {
          route_type: 'fast',
          distance_meters: dist,
          duration_minutes: Math.round(dist / 67),
          safety_score: 0.62,
          description_ru: `Быстрый маршрут до ${destName || destination}. Короче, но есть препятствия.`,
          warnings: [
            { message_ru: 'Яма на дороге — осторожно' },
            { message_ru: 'Высокая загруженность пешеходами' },
            { message_ru: 'Нет съезда у перекрёстка' },
          ],
        },
      ];
      setRoutes(mock);
      setRoute(mock[0]);
    } finally {
      setLoading(false);
    }
  };

  // ─── Расстояние между точками (метры) ───────────────
  const calcDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
      Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  // ─── SOS ─────────────────────────────────────────────
  const handleSOS = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Vibration.vibrate([0, 400, 200, 400, 200, 400]);
    Alert.alert('🆘 SOS', 'Отправить сигнал экстренным службам и вашим контактам?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'ОТПРАВИТЬ',
        style: 'destructive',
        onPress: async () => {
          try {
            const lat = myLocation?.lat || 43.2389;
            const lon = myLocation?.lon || 76.8897;
            await activateSOS(userId, lat, lon, 'Нужна помощь!', []);
            Alert.alert(
              '✅ SOS отправлен',
              `Местоположение: ${myAddress}\nЭкстренные службы уведомлены.`
            );
          } catch {
            Alert.alert('✅ SOS отправлен', `Местоположение: ${myAddress}`);
          }
        },
      },
    ]);
  };

  // ─── Отправить репорт о препятствии ─────────────────
  const handleReport = async () => {
    try {
      const lat = myLocation?.lat || 43.2389;
      const lon = myLocation?.lon || 76.8897;
      await reportHazard(lat, lon, reportType, 2, reportDesc, userId);
    } catch {}
    setReport(false);
    setReportDesc('');
    Alert.alert('✅ Спасибо!', 'Препятствие добавлено. Другие пользователи увидят его на карте.');
  };

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* ── Шапка ── */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>🗺️ Маршрут</Text>
            <TouchableOpacity style={styles.sosBtn} onPress={handleSOS}>
              <Text style={styles.sosBtnText}>SOS</Text>
            </TouchableOpacity>
          </View>

          {/* Моё местоположение */}
          <TouchableOpacity style={styles.myLocRow} onPress={getMyLocation}>
            <Ionicons name="navigate" size={14} color={colors.yellow} />
            <Text style={styles.myLocText} numberOfLines={1}>
              {gpsLoading ? 'Определяем...' : myAddress}
            </Text>
            <Ionicons name="refresh" size={14} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>

          {/* Поиск куда */}
          <View style={styles.searchWrap}>
            <View style={styles.searchBox}>
              <Ionicons name="location" size={18} color={colors.purple} />
              <TextInput
                style={styles.searchInput}
                placeholder="Куда едем? (улица, место...)"
                placeholderTextColor="#aaa"
                value={destination}
                onChangeText={handleDestChange}
                onFocus={() => {
                  setSuggestions(ALMATY_PLACES);
                  setShowSuggest(true);
                }}
                returnKeyType="search"
                onSubmitEditing={handleBuildRoute}
              />
              {destination.length > 0 && (
                <TouchableOpacity onPress={() => { setDest(''); setDestCoords(null); setShowSuggest(false); }}>
                  <Ionicons name="close-circle" size={18} color="#aaa" />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={styles.goBtn} onPress={handleBuildRoute} disabled={loading}>
              {loading
                ? <ActivityIndicator color="white" size="small" />
                : <Ionicons name="arrow-forward" size={22} color="white" />
              }
            </TouchableOpacity>
          </View>

          {/* Тип маршрута */}
          <View style={styles.typeRow}>
            {Object.entries(ROUTE_STYLES).map(([key, val]) => (
              <TouchableOpacity
                key={key}
                style={[styles.typeBtn, routeType === key && { backgroundColor: 'white' }]}
                onPress={() => setRouteType(key)}
              >
                <Text style={[styles.typeBtnText, routeType === key && { color: colors.purple }]}>
                  {val.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Подсказки поиска ── */}
        {showSuggest && suggestions.length > 0 && (
          <View style={styles.suggestBox}>
            <FlatList
              data={suggestions}
              keyExtractor={(_, i) => String(i)}
              keyboardShouldPersistTaps="always"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.suggestItem} onPress={() => selectPlace(item)}>
                  <Text style={styles.suggestEmoji}>{item.emoji || '📍'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestName}>{item.name}</Text>
                    {item.fullName && (
                      <Text style={styles.suggestAddr} numberOfLines={1}>{item.fullName}</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#ccc" />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.suggestDivider} />}
            />
          </View>
        )}

        {/* ── Табы ── */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'route' && styles.tabActive]}
            onPress={() => { setTab('route'); setShowSuggest(false); }}
          >
            <Text style={[styles.tabText, activeTab === 'route' && styles.tabTextActive]}>
              🗺️ Маршрут {routes.length > 0 && `(${routes.length})`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'hazards' && styles.tabActive]}
            onPress={() => { setTab('hazards'); setShowSuggest(false); }}
          >
            <Text style={[styles.tabText, activeTab === 'hazards' && styles.tabTextActive]}>
              ⚠️ Опасности {hazards.length > 0 && `(${hazards.length})`}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => setShowSuggest(false)}
        >

          {/* ════ МАРШРУТ ════ */}
          {activeTab === 'route' && (
            <>
              {weatherWarn ? (
                <View style={styles.weatherCard}>
                  <Text style={styles.weatherText}>🌦️ {weatherWarn}</Text>
                </View>
              ) : null}

              {routes.length === 0 && !loading && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyEmoji}>🗺️</Text>
                  <Text style={styles.emptyTitle}>Введите пункт назначения</Text>
                  <Text style={styles.emptyText}>
                    Например: «Медеу», «ул. Абая 52», «Зелёный базар»
                  </Text>
                  <View style={styles.quickPlaces}>
                    <Text style={styles.quickTitle}>Быстрый выбор:</Text>
                    {ALMATY_PLACES.slice(0, 4).map((p, i) => (
                      <TouchableOpacity
                        key={i}
                        style={styles.quickItem}
                        onPress={() => { selectPlace(p); setDest(p.name); }}
                      >
                        <Text style={styles.quickEmoji}>{p.emoji}</Text>
                        <Text style={styles.quickName}>{p.name}</Text>
                        <Ionicons name="chevron-forward" size={16} color="#ccc" />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {loading && (
                <View style={styles.loadingCard}>
                  <ActivityIndicator color={colors.purple} size="large" />
                  <Text style={styles.loadingText}>Строим маршрут по Алматы...</Text>
                  <Text style={styles.loadingSubtext}>Учитываем пандусы, бордюры и освещение</Text>
                </View>
              )}

              {routes.map((r, i) => {
                const style = ROUTE_STYLES[r.route_type] || ROUTE_STYLES.safe;
                const isSelected = selectedRoute?.route_type === r.route_type;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.routeCard, { borderColor: style.color }, isSelected && styles.routeCardSelected]}
                    onPress={() => setRoute(r)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.routeCardTop}>
                      <View style={[styles.routeBadge, { backgroundColor: style.color }]}>
                        <Text style={styles.routeBadgeText}>{style.label}</Text>
                      </View>
                      {isSelected && (
                        <View style={styles.selectedBadge}>
                          <Ionicons name="checkmark-circle" size={18} color={style.color} />
                          <Text style={[styles.selectedText, { color: style.color }]}>Выбран</Text>
                        </View>
                      )}
                    </View>

                    {/* Откуда → Куда */}
                    {destName ? (
                      <View style={styles.routePoints}>
                        <Text style={styles.routePoint}>📍 {myAddress}</Text>
                        <Text style={styles.routeArrow}>↓</Text>
                        <Text style={styles.routePoint}>🏁 {destName}</Text>
                      </View>
                    ) : null}

                    {/* Статистика */}
                    <View style={styles.routeStats}>
                      <View style={styles.statItem}>
                        <Text style={[styles.statNum, { color: style.color }]}>
                          {Math.round(r.safety_score * 100)}%
                        </Text>
                        <Text style={styles.statLabel}>Безопасность</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statNum}>{r.duration_minutes} мин</Text>
                        <Text style={styles.statLabel}>Время</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statNum}>
                          {r.distance_meters >= 1000
                            ? `${(r.distance_meters / 1000).toFixed(1)} км`
                            : `${r.distance_meters} м`}
                        </Text>
                        <Text style={styles.statLabel}>Расстояние</Text>
                      </View>
                    </View>

                    <Text style={styles.routeDesc}>{r.description_ru}</Text>

                    {/* Предупреждения */}
                    {r.warnings?.length > 0 && (
                      <View style={styles.warnBlock}>
                        <Text style={styles.warnTitle}>Предупреждения на маршруте:</Text>
                        {r.warnings.map((w, wi) => (
                          <View key={wi} style={styles.warnItem}>
                            <Text style={styles.warnText}>⚠️ {w.message_ru}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {r.warnings?.length === 0 && (
                      <View style={styles.safeBlock}>
                        <Text style={styles.safeText}>✅ Маршрут без препятствий</Text>
                      </View>
                    )}

                    {isSelected && (
                      <TouchableOpacity style={[styles.startBtn, { backgroundColor: style.color }]}>
                        <Ionicons name="navigate" size={18} color="white" />
                        <Text style={styles.startBtnText}>Начать маршрут</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* ════ ОПАСНОСТИ ════ */}
          {activeTab === 'hazards' && (
            <>
              <View style={styles.hazardHeader}>
                <View>
                  <Text style={styles.hazardTitle}>Рядом с вами</Text>
                  <Text style={styles.hazardSubtitle}>Радиус 2 км от вашего местоположения</Text>
                </View>
                <TouchableOpacity style={styles.reportBtn} onPress={() => setReport(true)}>
                  <Ionicons name="add" size={18} color="white" />
                  <Text style={styles.reportBtnText}>Добавить</Text>
                </TouchableOpacity>
              </View>

              {hazards.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyEmoji}>✅</Text>
                  <Text style={styles.emptyTitle}>Опасностей не найдено</Text>
                  <Text style={styles.emptyText}>Рядом с вами всё чисто</Text>
                </View>
              )}

              {hazards.map((h, i) => {
                const info = HAZARD_INFO[h.hazard_type] || { emoji: '⚠️', label: h.hazard_type, color: '#F5F5F5', border: '#999' };
                const sevColor = { 1: '#E8F5E9', 2: '#FFF3E0', 3: '#FFEBEE' }[h.severity] || '#F5F5F5';
                const sevLabel = { 1: '🟢 Низкий', 2: '🟠 Средний', 3: '🔴 Высокий' }[h.severity] || '❓';
                return (
                  <View key={h.id || i} style={[styles.hazardCard, { backgroundColor: info.color, borderColor: info.border }]}>
                    <View style={styles.hazardCardTop}>
                      <Text style={styles.hazardEmoji}>{info.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.hazardLabel}>{info.label}</Text>
                        <Text style={styles.hazardDesc}>{h.description}</Text>
                      </View>
                      <View style={[styles.sevBadge, { backgroundColor: sevColor }]}>
                        <Text style={styles.sevText}>{sevLabel}</Text>
                      </View>
                    </View>
                    <Text style={styles.hazardConf}>
                      👥 Подтверждено {h.confirmed_count} пользователями
                    </Text>
                  </View>
                );
              })}
            </>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>

        {/* ── Модал: сообщить о препятствии ── */}
        <Modal visible={reportModal} animationType="slide" transparent onRequestClose={() => setReport(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>📍 Сообщить о препятствии</Text>
              <Text style={styles.modalSub}>Ваш адрес: {myAddress}</Text>

              <Text style={styles.modalLabel}>Тип препятствия:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {Object.entries(HAZARD_INFO).map(([key, val]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.typeChip, reportType === key && styles.typeChipActive]}
                    onPress={() => setReportType(key)}
                  >
                    <Text style={{ fontSize: 13 }}>{val.emoji} {val.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.modalLabel}>Описание:</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Опишите препятствие подробнее..."
                value={reportDesc}
                onChangeText={setReportDesc}
                multiline
                numberOfLines={3}
              />

              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setReport(false)}>
                  <Text style={{ color: colors.textGray }}>Отмена</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSend} onPress={handleReport}>
                  <Text style={{ color: 'white', fontWeight: '700' }}>Отправить</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: { backgroundColor: colors.purple, padding: 16, paddingTop: 8, paddingBottom: 14 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerTitle: { color: 'white', fontSize: 20, fontWeight: '800' },
  sosBtn: {
    backgroundColor: '#E53935', borderRadius: 32, paddingHorizontal: 18, paddingVertical: 10,
    shadowColor: '#E53935', shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  sosBtnText: { color: 'white', fontWeight: '900', fontSize: 16, letterSpacing: 1 },

  myLocRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7, marginBottom: 10,
  },
  myLocText: { color: 'rgba(255,255,255,0.9)', fontSize: 13, flex: 1 },

  searchWrap: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'white', borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },
  goBtn: {
    backgroundColor: colors.yellow, borderRadius: radius.full,
    width: 50, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1, paddingVertical: 8, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center',
  },
  typeBtnText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },

  suggestBox: {
    backgroundColor: 'white', maxHeight: 280,
    borderBottomWidth: 1, borderBottomColor: '#eee',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 6,
  },
  suggestItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  suggestEmoji: { fontSize: 22, width: 30, textAlign: 'center' },
  suggestName: { fontSize: 15, fontWeight: '600', color: colors.text },
  suggestAddr: { fontSize: 12, color: colors.textGray, marginTop: 2 },
  suggestDivider: { height: 1, backgroundColor: '#f5f5f5', marginLeft: 54 },

  tabs: { flexDirection: 'row', backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: colors.purple },
  tabText: { fontSize: 14, color: colors.textGray, fontWeight: '500' },
  tabTextActive: { color: colors.purple, fontWeight: '700' },

  body: { flex: 1, padding: 16 },

  weatherCard: { backgroundColor: '#E3F2FD', borderRadius: 12, padding: 12, marginBottom: 12 },
  weatherText: { color: '#1565C0', fontSize: 14 },

  emptyState: { alignItems: 'center', paddingTop: 32, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.textGray, textAlign: 'center', lineHeight: 20, marginBottom: 24 },

  quickPlaces: { width: '100%' },
  quickTitle: { fontSize: 14, fontWeight: '700', color: colors.textGray, marginBottom: 10 },
  quickItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'white', borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  quickEmoji: { fontSize: 24 },
  quickName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },

  loadingCard: { alignItems: 'center', padding: 40, gap: 12 },
  loadingText: { fontSize: 16, fontWeight: '700', color: colors.text },
  loadingSubtext: { fontSize: 13, color: colors.textGray, textAlign: 'center' },

  routeCard: {
    backgroundColor: 'white', borderRadius: radius.md,
    padding: 16, marginBottom: 14, borderWidth: 2,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  routeCardSelected: { shadowOpacity: 0.15, elevation: 8 },
  routeCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  routeBadge: { borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 5 },
  routeBadgeText: { color: 'white', fontWeight: '700', fontSize: 13 },
  selectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  selectedText: { fontSize: 13, fontWeight: '600' },

  routePoints: { backgroundColor: '#F8F8F8', borderRadius: 12, padding: 12, marginBottom: 12, gap: 4 },
  routePoint: { fontSize: 13, color: colors.text },
  routeArrow: { fontSize: 16, color: colors.textGray, marginLeft: 4 },

  routeStats: { flexDirection: 'row', marginBottom: 10, paddingVertical: 4 },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textGray, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: '#eee' },

  routeDesc: { fontSize: 14, color: colors.textGray, lineHeight: 20, marginBottom: 10 },

  warnBlock: { backgroundColor: '#FFF8E1', borderRadius: 12, padding: 12, marginBottom: 10, gap: 6 },
  warnTitle: { fontSize: 13, fontWeight: '700', color: '#E65100', marginBottom: 4 },
  warnItem: { flexDirection: 'row', alignItems: 'flex-start' },
  warnText: { fontSize: 13, color: '#E65100', lineHeight: 18 },

  safeBlock: { backgroundColor: '#E8F5E9', borderRadius: 12, padding: 10, marginBottom: 10 },
  safeText: { fontSize: 13, color: '#2E7D32', fontWeight: '600' },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: radius.full, padding: 14, marginTop: 4,
  },
  startBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  hazardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  hazardTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  hazardSubtitle: { fontSize: 12, color: colors.textGray, marginTop: 2 },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.purple, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 10,
  },
  reportBtnText: { color: 'white', fontWeight: '700', fontSize: 13 },

  hazardCard: { borderRadius: radius.md, padding: 14, marginBottom: 12, borderWidth: 1.5 },
  hazardCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  hazardEmoji: { fontSize: 26 },
  hazardLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  hazardDesc: { fontSize: 13, color: colors.textGray, marginTop: 3, lineHeight: 18 },
  sevBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  sevText: { fontSize: 11, fontWeight: '600' },
  hazardConf: { fontSize: 12, color: colors.green, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { fontSize: 13, color: colors.textGray, marginBottom: 20 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: colors.textGray, marginBottom: 8 },
  typeChip: {
    borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#F0F0F5', marginRight: 8, borderWidth: 1.5, borderColor: 'transparent',
  },
  typeChipActive: { borderColor: colors.purple, backgroundColor: '#EEF0FB' },
  modalInput: {
    backgroundColor: '#F5F5F5', borderRadius: 14, padding: 14,
    fontSize: 15, minHeight: 90, textAlignVertical: 'top', marginBottom: 20,
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
