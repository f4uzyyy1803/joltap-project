
// ─── Подключение к FastAPI бэкенду ───────────────────────
import axios from 'axios';

// Замени на свой IP если тестируешь на телефоне
// Для эмулятора Android: http://10.0.2.2:8000
// Для реального телефона: http://192.168.1.XX:8000 (твой IP в сети)
const BASE_URL = 'http://192.168.31.130:8000';

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

export default api;
