// src/screens/ProfileScreen.js
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, TextInput, Alert, Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SOSButton from '../components/SOSButton';
import { saveProfile, getProfile } from '../services/api';
import { colors, radius } from '../theme';

export default function ProfileScreen({ navigation }) {
  const [userId, setUserId]     = useState('user_001');
  const [name, setName]         = useState('Кабдраш Айша');
  const [username, setUsername] = useState('@aisha223');
  const [email, setEmail]       = useState('aisha@gmail.com');
  const [language, setLanguage] = useState('ru');
  const [mobilityType, setMobility] = useState('wheelchair_manual');
  const [avoidCrowds, setAvoidCrowds] = useState(true);
  const [avoidDark, setAvoidDark]     = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  const loadProfile = async () => {
    const id   = await AsyncStorage.getItem('user_id')   || 'user_001';
    const n    = await AsyncStorage.getItem('user_name') || 'Пользователь';
    setUserId(id);
    setName(n);
    try {
      const profile = await getProfile(id);
      setMobility(profile.mobility_type);
      setAvoidCrowds(profile.avoid_crowds);
      setAvoidDark(profile.avoid_poor_lighting);
      setLanguage(profile.language);
    } catch (e) { /* профиль ещё не создан */ }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await saveProfile({
        user_id: userId,
        mobility_type: mobilityType,
        max_distance_km: 2.0,
        preferred_route: 'safe',
        notification_type: 'all',
        avoid_crowds: avoidCrowds,
        avoid_poor_lighting: avoidDark,
        language,
      });
      await AsyncStorage.setItem('user_name', name);
      Alert.alert('✅ Сохранено', 'Профиль обновлён');
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось сохранить профиль');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Выход', 'Вы уверены?', [
      { text: 'Отмена' },
      { text: 'Выйти', style: 'destructive', onPress: async () => {
        await AsyncStorage.clear();
        navigation.replace('Welcome');
      }},
    ]);
  };

  const MOBILITY_OPTIONS = [
    { value: 'wheelchair_manual',   label: '🦽 Ручная коляска' },
    { value: 'wheelchair_electric', label: '⚡ Электрическая коляска' },
    { value: 'elderly',             label: '🧓 Пожилой человек' },
    { value: 'caregiver',           label: '🤝 Сопровождающий' },
  ];

  const LANG_OPTIONS = [
    { value: 'kz', label: 'Қазақ тілі' },
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.purple }} edges={['top']}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <SOSButton userId={userId} />
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={{ fontSize: 50 }}>👤</Text>
            </View>
            <TouchableOpacity style={styles.avatarAdd}>
              <Text style={{ color: colors.purple, fontWeight: '700' }}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.profileName}>{name}</Text>
          <Text style={styles.profileId}>{username}</Text>
        </View>

        <View style={styles.body}>

          {/* ── Личные данные ── */}
          <Text style={styles.sectionTitle}>Личные данные</Text>
          <View style={styles.card}>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Имя</Text>
              <TextInput style={styles.fieldInput} value={name} onChangeText={setName} placeholder="Ваше имя" />
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Никнейм</Text>
              <TextInput style={styles.fieldInput} value={username} onChangeText={setUsername} placeholder="@username" autoCapitalize="none" />
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput style={styles.fieldInput} value={email} onChangeText={setEmail} placeholder="email@mail.com" keyboardType="email-address" autoCapitalize="none" />
            </View>
          </View>

          {/* ── Тип мобильности ── */}
          <Text style={styles.sectionTitle}>Тип мобильности</Text>
          <View style={styles.card}>
            {MOBILITY_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.value} style={styles.optRow} onPress={() => setMobility(opt.value)}>
                <Text style={styles.optLabel}>{opt.label}</Text>
                <View style={[styles.radio, mobilityType === opt.value && styles.radioActive]}>
                  {mobilityType === opt.value && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Язык ── */}
          <Text style={styles.sectionTitle}>Язык</Text>
          <View style={styles.card}>
            {LANG_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.value} style={styles.optRow} onPress={() => setLanguage(opt.value)}>
                <Text style={styles.optLabel}>{opt.label}</Text>
                <View style={[styles.radio, language === opt.value && styles.radioActive]}>
                  {language === opt.value && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Настройки маршрута ── */}
          <Text style={styles.sectionTitle}>Настройки маршрута</Text>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>🚶 Избегать толпы</Text>
              <Switch value={avoidCrowds} onValueChange={setAvoidCrowds} trackColor={{ true: colors.purple }} />
            </View>
            <View style={styles.divider} />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>💡 Избегать тёмных улиц</Text>
              <Switch value={avoidDark} onValueChange={setAvoidDark} trackColor={{ true: colors.purple }} />
            </View>
          </View>

          {/* ── Кнопки ── */}
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
            <Text style={styles.saveBtnText}>{loading ? 'Сохранение...' : '💾 Сохранить профиль'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Выйти из аккаунта</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.purple,
    alignItems: 'center', paddingTop: 10, paddingBottom: 40, paddingHorizontal: 20,
  },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatar: {
    width: 100, height: 100, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarAdd: {
    position: 'absolute', bottom: -6, right: -6,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'white', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  profileName: { color: 'white', fontSize: 22, fontWeight: '700' },
  profileId:   { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 4 },

  body: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, minHeight: 600 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 10, marginTop: 16 },
  card: { backgroundColor: 'white', borderRadius: radius.md, padding: 16, marginBottom: 4 },

  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  fieldLabel: { width: 80, fontSize: 14, color: colors.textGray },
  fieldInput: { flex: 1, fontSize: 15, color: colors.text },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 4 },

  optRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  optLabel: { flex: 1, fontSize: 15, color: colors.text },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: colors.purple },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.purple },

  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  switchLabel: { flex: 1, fontSize: 15, color: colors.text },

  saveBtn: {
    backgroundColor: colors.purple, borderRadius: radius.full,
    padding: 18, alignItems: 'center', marginTop: 24,
  },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },

  logoutBtn: {
    padding: 18, alignItems: 'center', marginTop: 12, marginBottom: 40,
    borderRadius: radius.full, borderWidth: 2, borderColor: '#ddd',
  },
  logoutText: { color: colors.textGray, fontSize: 16 },
});
