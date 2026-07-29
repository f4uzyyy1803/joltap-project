
// ─── Подключение к FastAPI бэкенду ───────────────────────
import axios from 'axios';
import Constants from 'expo-constants';

// Адрес бэкенда определяется автоматически — свой IP вписывать не нужно.
//
// 1) Если задан EXPO_PUBLIC_API_URL (.env) — используем его.
//    Нужно для деплоенного бэкенда (не localhost) или продакшена.
// 2) Иначе — берём IP, по которому телефон уже подключился к Metro
//    (тому же компьютеру, где запущен `expo start`). Это работает,
//    потому что бэкенд обычно поднят на той же машине.
// 3) Если ничего не нашлось (например, веб-версия) — localhost.
const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoClient?.hostUri;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:8000`;
  }

  return 'http://localhost:8000';
};

const BASE_URL = getBaseUrl();

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Маршруты ─────────────────────────────────────────────
export const buildRoute = async (startLat, startLon, endLat, endLon, routeType = 'safe', userId = null) => {
  const res = await api.post('/route/build', {
    start_lat: startLat,
    start_lon: startLon,
    end_lat: endLat,
    end_lon: endLon,
    route_type: routeType,
    user_id: userId,
  });
  return res.data;
};

// ─── Опасные зоны ────────────────────────────────────────
export const getHazards = async (lat, lon, radiusKm = 1.0) => {
  const res = await api.get('/map/hazards', {
    params: { lat, lon, radius_km: radiusKm },
  });
  return res.data;
};

export const reportHazard = async (lat, lon, hazardType, severity, description, userId) => {
  const res = await api.post('/map/report', {
    lat, lon,
    hazard_type: hazardType,
    severity,
    description,
    reported_by: userId,
  });
  return res.data;
};

// ─── SOS ─────────────────────────────────────────────────
export const activateSOS = async (userId, lat, lon, message, contacts = []) => {
  const res = await api.post('/sos/activate', {
    user_id: userId,
    lat, lon,
    message,
    contacts,
  });
  return res.data;
};

// ─── Профиль ─────────────────────────────────────────────
export const saveProfile = async (profile) => {
  const res = await api.post('/user/profile', profile);
  return res.data;
};

export const getProfile = async (userId) => {
  const res = await api.get(`/user/profile/${userId}`);
  return res.data;
};

// ─── Погода ──────────────────────────────────────────────
// Ключ OpenWeatherMap хранится только на бэкенде — здесь мы
// обращаемся к своему же /weather, а не напрямую к OpenWeatherMap.
export const getWeather = async (lat, lon) => {
  const res = await api.get('/weather', { params: { lat, lon } });
  return res.data;
};

export default api;
