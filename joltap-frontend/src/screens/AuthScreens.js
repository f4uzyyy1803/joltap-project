// src/screens/AuthScreens.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Animated, KeyboardAvoidingView, Platform, ScrollView, Alert
} from 'react-native';
import { colors, radius } from '../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ════════════════════════════════════════════════════
// SPLASH SCREEN
// ════════════════════════════════════════════════════
export function SplashScreen({ navigation }) {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => navigation.replace('Welcome'), 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.splashContainer}>
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <View style={styles.pinIcon} />
        <Text style={styles.logoText}>Jol Tap</Text>
      </Animated.View>
    </View>
  );
}

// ════════════════════════════════════════════════════
// WELCOME SCREEN
// ════════════════════════════════════════════════════
export function WelcomeScreen({ navigation }) {
  return (
    <View style={styles.splashContainer}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={styles.pinIcon} />
        <Text style={styles.logoText}>Jol Tap</Text>
      </View>
      <View style={styles.welcomeBtns}>
        <TouchableOpacity style={styles.btnOutline} onPress={() => navigation.navigate('Register')}>
          <Text style={styles.btnOutlineText}>зарегистрироваться</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnYellow} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.btnYellowText}>войти</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════
// LOGIN SCREEN
// ════════════════════════════════════════════════════
export function LoginScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }
    setLoading(true);
    try {
      // Сохраняем userId для бэкенда
      const userId = username.replace('@', '').toLowerCase();
      await AsyncStorage.setItem('user_id', userId);
      await AsyncStorage.setItem('user_name', username);
      navigation.replace('Main');
    } catch (e) {
      Alert.alert('Ошибка входа', 'Проверьте данные');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={{ flex: 1 }} bounces={false}>
        <View style={styles.authHeader}>
          <View style={[styles.pinIcon, { width: 70, height: 85 }]} />
          <Text style={styles.logoText}>Jol Tap</Text>
          <View style={styles.authWave} />
        </View>
        <View style={styles.authBody}>
          <Text style={styles.authTitle}>С возвращением!</Text>
          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="Имя пользователя"
              placeholderTextColor={colors.textGray}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.inputGroup}>
            <TextInput
              style={[styles.input, { paddingRight: 50 }]}
              placeholder="Пароль"
              placeholderTextColor={colors.textGray}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(!showPass)}>
              <Text style={styles.eyeIcon}>{showPass ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.authRow}>
            <TouchableOpacity style={styles.checkRow} onPress={() => setRemember(!remember)}>
              <View style={[styles.checkbox, remember && styles.checkboxActive]} />
              <Text style={styles.grayText}>Запомнить</Text>
            </TouchableOpacity>
            <TouchableOpacity>
              <Text style={styles.link}>Забыли пароль?</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.btnYellow, { marginTop: 8 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.btnYellowText}>{loading ? 'Входим...' : 'Войти'}</Text>
          </TouchableOpacity>
          <View style={styles.authBottom}>
            <Text style={styles.grayText}>Новый аккаунт? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.link}>Зарегистрироваться</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ════════════════════════════════════════════════════
// REGISTER SCREEN
// ════════════════════════════════════════════════════
export function RegisterScreen({ navigation }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleRegister = () => {
    if (!name || !contact || !password) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }
    navigation.navigate('OTP', { phone: contact });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={{ flex: 1 }} bounces={false}>
        <View style={styles.authHeader}>
          <View style={[styles.pinIcon, { width: 70, height: 85 }]} />
          <Text style={styles.logoText}>Jol Tap</Text>
          <View style={styles.authWave} />
        </View>
        <View style={styles.authBody}>
          <Text style={styles.authTitle}>Добро пожаловать!</Text>
          <View style={styles.inputGroup}>
            <TextInput style={styles.input} placeholder="Имя" placeholderTextColor={colors.textGray} value={name} onChangeText={setName} />
          </View>
          <View style={styles.inputGroup}>
            <TextInput style={styles.input} placeholder="Эл. почта или телефон" placeholderTextColor={colors.textGray} value={contact} onChangeText={setContact} keyboardType="email-address" autoCapitalize="none" />
          </View>
          <View style={styles.inputGroup}>
            <TextInput style={[styles.input, { paddingRight: 50 }]} placeholder="Пароль" placeholderTextColor={colors.textGray} value={password} onChangeText={setPassword} secureTextEntry={!showPass} />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(!showPass)}>
              <Text style={styles.eyeIcon}>{showPass ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.btnYellow, { marginTop: 16 }]} onPress={handleRegister}>
            <Text style={styles.btnYellowText}>Регистрация</Text>
          </TouchableOpacity>
          <View style={styles.authBottom}>
            <Text style={styles.grayText}>Уже есть аккаунт? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.link}>Войти</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ════════════════════════════════════════════════════
// OTP SCREEN
// ════════════════════════════════════════════════════
export function OTPScreen({ navigation, route }) {
  const phone = route?.params?.phone || '+707 677 5656';
  const [code, setCode] = useState(['', '', '', '']);
  const inputs = useRef([]);

  const handleChange = (text, index) => {
    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);
    if (text && index < 3) inputs.current[index + 1]?.focus();
  };

  const handleConfirm = async () => {
    const fullCode = code.join('');
    if (fullCode.length < 4) { Alert.alert('Введите 4-значный код'); return; }
    await AsyncStorage.setItem('user_id', 'user_001');
    await AsyncStorage.setItem('user_name', 'Новый пользователь');
    navigation.replace('Main');
  };

  return (
    <ScrollView style={{ flex: 1 }} bounces={false}>
      <View style={styles.authHeader}>
        <View style={[styles.pinIcon, { width: 70, height: 85 }]} />
        <Text style={styles.logoText}>Jol Tap</Text>
        <View style={styles.authWave} />
      </View>
      <View style={styles.authBody}>
        <Text style={styles.authTitle}>Регистрация</Text>
        <Text style={styles.otpSub}>Введите код, отправленный на номер{'\n'}
          <Text style={styles.link}>{phone}</Text>
        </Text>
        <View style={styles.otpRow}>
          {code.map((digit, i) => (
            <TextInput
              key={i}
              ref={r => inputs.current[i] = r}
              style={[styles.otpBox, digit && styles.otpBoxFilled]}
              value={digit}
              onChangeText={t => handleChange(t.slice(-1), i)}
              keyboardType="number-pad"
              maxLength={1}
              textAlign="center"
            />
          ))}
        </View>
        <Text style={styles.grayText}>
          Код не пришел! <Text style={styles.link}>Отправить ещё раз</Text>
        </Text>
        <TouchableOpacity style={[styles.btnYellow, { marginTop: 24 }]} onPress={handleConfirm}>
          <Text style={styles.btnYellowText}>Подтвердить</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Стили ───────────────────────────────────────────────
const styles = StyleSheet.create({
  splashContainer: { flex: 1, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' },
  pinIcon: {
    width: 100, height: 110,
    backgroundColor: colors.yellow,
    borderRadius: 50, borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
    alignSelf: 'center', marginBottom: 16,
  },
  logoText: { fontWeight: '900', fontSize: 52, color: colors.yellow, textAlign: 'center' },
  welcomeBtns: { width: '100%', paddingHorizontal: 40, paddingBottom: 60, gap: 14 },
  btnOutline: {
    padding: 18, backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radius.full, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  btnOutlineText: { fontSize: 17, color: colors.purple, fontWeight: '500' },
  btnYellow: {
    padding: 18, backgroundColor: colors.yellow,
    borderRadius: radius.full, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  btnYellowText: { fontSize: 17, color: colors.text, fontWeight: '700' },

  authHeader: {
    backgroundColor: colors.purple, paddingTop: 60, paddingBottom: 50,
    alignItems: 'center',
  },
  authWave: {
    position: 'absolute', bottom: -1, left: 0, right: 0, height: 50,
    backgroundColor: 'white', borderTopLeftRadius: 100, borderTopRightRadius: 100,
  },
  authBody: { backgroundColor: 'white', padding: 36, flex: 1 },
  authTitle: { fontSize: 26, fontWeight: '700', textAlign: 'center', color: colors.text, marginBottom: 28 },
  inputGroup: { marginBottom: 16, position: 'relative' },
  input: {
    backgroundColor: '#F0F0F5', borderRadius: radius.full,
    paddingHorizontal: 20, paddingVertical: 18,
    fontSize: 16, color: colors.text,
  },
  eyeBtn: { position: 'absolute', right: 16, top: 18 },
  eyeIcon: { fontSize: 20 },
  authRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8, marginBottom: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccc' },
  checkboxActive: { backgroundColor: colors.purple, borderColor: colors.purple },
  grayText: { color: colors.textGray, fontSize: 14 },
  link: { color: colors.purple, fontSize: 14, fontWeight: '600' },
  authBottom: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },

  otpSub: { textAlign: 'center', color: colors.textGray, fontSize: 15, lineHeight: 22, marginBottom: 32 },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 24 },
  otpBox: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#F0F0F5', borderWidth: 2, borderColor: '#ddd',
    fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center',
  },
  otpBoxFilled: { backgroundColor: 'white', borderColor: colors.purple },
});
