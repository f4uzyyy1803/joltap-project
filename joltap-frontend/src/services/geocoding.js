// src/services/geocoding.js
// Геокодирование через Nominatim (OpenStreetMap) — бесплатно
// Переводит название улицы → координаты и обратно

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

// ─── Адрес → координаты ──────────────────────────────────
// userLocation: { lat, lon } — текущие GPS-координаты, чтобы поиск
// шёл в том городе, где реально находится человек, а не был жёстко
// привязан к одному городу.
export async function geocode(address, userLocation) {
  try {
    const query = encodeURIComponent(address);
    let url = `${NOMINATIM_URL}/search?q=${query}&format=json&limit=5&countrycodes=kz&addressdetails=1`;

    if (userLocation && userLocation.lat && userLocation.lon) {
      // Прямоугольник ~110 км вокруг пользователя (0.5° по широте/долготе) —
      // покрывает город и ближайшую область, но не «утаскивает» результат
      // в другой конец страны. bounded=1 — жёсткое ограничение поиска этим боксом.
      const d = 0.5;
      const left   = userLocation.lon - d;
      const right  = userLocation.lon + d;
      const top    = userLocation.lat + d;
      const bottom = userLocation.lat - d;
      url += `&viewbox=${left},${top},${right},${bottom}&bounded=1`;
    }

    let res = await fetch(url, { headers: { 'User-Agent': 'JolTap/1.0' } });
    let data = await res.json();

    // Если рядом ничего не нашли (например, адрес в другом городе,
    // куда человек только собирается) — пробуем ещё раз без жёсткой
    // привязки к боксу, но уже в пределах Казахстана.
    if ((!data || data.length === 0) && userLocation) {
      const fallbackUrl = `${NOMINATIM_URL}/search?q=${query}&format=json&limit=5&countrycodes=kz&addressdetails=1`;
      res = await fetch(fallbackUrl, { headers: { 'User-Agent': 'JolTap/1.0' } });
      data = await res.json();
    }

    if (!data || data.length === 0) return null;

    return data.map(item => ({
      lat:     parseFloat(item.lat),
      lon:     parseFloat(item.lon),
      name:    item.display_name,
      short:   item.display_name.split(',').slice(0, 2).join(','),
      city:    item.address?.city || item.address?.town || item.address?.county || '',
    }));
  } catch (e) {
    console.error('Geocode error:', e);
    return null;
  }
}

// ─── Координаты → адрес ──────────────────────────────────
export async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `${NOMINATIM_URL}/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'User-Agent': 'JolTap/1.0' } }
    );
    const data = await res.json();
    if (!data) return 'Неизвестное место';

    const addr = data.address;
    const parts = [
      addr.road || addr.pedestrian || addr.footway,
      addr.house_number,
      addr.suburb || addr.neighbourhood,
    ].filter(Boolean);

    return parts.join(', ') || data.display_name.split(',')[0];
  } catch (e) {
    return 'Текущее место';
  }
}

// ─── Популярные места Алматы (быстрый поиск) ─────────────
export const ALMATY_PLACES = [
  { name: 'Медеу',                  lat: 43.1575, lon: 77.0586, emoji: '⛷️' },
  { name: 'Парк 28 панфиловцев',    lat: 43.2569, lon: 76.9290, emoji: '🌳' },
  { name: 'Зелёный базар',          lat: 43.2596, lon: 76.9515, emoji: '🥦' },
  { name: 'ЦУМ Алматы',             lat: 43.2548, lon: 76.9337, emoji: '🛍️' },
  { name: 'Алматы Арена',           lat: 43.2116, lon: 76.8978, emoji: '🏟️' },
  { name: 'Аэропорт Алматы',        lat: 43.3521, lon: 77.0404, emoji: '✈️' },
  { name: 'Достык Плаза',           lat: 43.2249, lon: 76.9571, emoji: '🏬' },
  { name: 'МУИТ / КИМЭП',           lat: 43.2063, lon: 76.8698, emoji: '🎓' },
  { name: 'Горбольница №1',         lat: 43.2689, lon: 76.9087, emoji: '🏥' },
  { name: 'Центральная мечеть',     lat: 43.2544, lon: 76.9270, emoji: '🕌' },
  { name: 'Mega Alma-Ata',          lat: 43.2031, lon: 76.8562, emoji: '🛒' },
  { name: 'Esentai Mall',           lat: 43.2167, lon: 76.9302, emoji: '🛍️' },
  { name: 'Ботанический сад',       lat: 43.2031, lon: 76.9598, emoji: '🌺' },
  { name: 'Вокзал Алматы-1',        lat: 43.2524, lon: 76.9401, emoji: '🚉' },
  { name: 'Барахолка',              lat: 43.2789, lon: 76.8234, emoji: '🏪' },
];
