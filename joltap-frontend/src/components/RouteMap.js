import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';

// Ключ читается из .env (EXPO_PUBLIC_MAPTILER_KEY), не хардкодится в коде.
// MapTiler: бесплатный тариф без привязки карты, 100k тайлов/мес.
// Получить ключ: https://cloud.maptiler.com/account/keys/ (только email).
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

export default function RouteMap({ startLat, startLon, endLat, endLon, destName, onClose, distanceMeters, durationMinutes }) {
  const [loading, setLoading] = useState(true);

  const midLat = (startLat + endLat) / 2;
  const midLon = (startLon + endLon) / 2;
  const dist = Math.sqrt((endLat - startLat) ** 2 + (endLon - startLon) ** 2);
  const zoom = dist < 0.01 ? 15 : dist < 0.05 ? 13 : dist < 0.1 ? 12 : dist < 0.3 ? 11 : 10;

  // MapTiler даёт заметно более чёткие тайлы (512px, как у "retina"), чем
  // бесплатный CartoDB. Если ключ не задан — тихо откатываемся на CartoDB,
  // чтобы приложение не падало.
  const tileLayer = MAPTILER_KEY
    ? `L.tileLayer('https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}', { maxZoom:20, tileSize:512, zoomOffset:-1, attribution:'© MapTiler © OpenStreetMap' }).addTo(map);`
    : `L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom:20, attribution:'CartoDB' }).addTo(map);`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
* { margin:0; padding:0; }
#map { width:100vw; height:100vh; }
.info { position:fixed; bottom:0; left:0; right:0; background:white; padding:16px; border-radius:20px 20px 0 0; box-shadow:0 -4px 20px rgba(0,0,0,0.15); z-index:1000; }
.info-title { font-size:15px; font-weight:700; margin-bottom:10px; }
.info-row { display:flex; gap:12px; }
.info-item { flex:1; text-align:center; }
.info-num { font-size:22px; font-weight:900; color:#6B6FD4; }
.info-label { font-size:11px; color:#888; }

/* Маркер "я здесь": статичный кружок-фон + отдельно вращающаяся стрелка внутри.
   Так фон/тень не дёргаются при повороте, а стрелка поворачивается плавно (CSS transition). */
.me-wrap { width:36px; height:36px; position:relative; }
.me-circle {
  position:absolute; inset:0; border-radius:50%;
  background:linear-gradient(135deg,#6B6FD4,#8B8FE8);
  border:3px solid white; box-shadow:0 4px 16px rgba(107,111,212,0.5);
}
.me-arrow {
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  transition: transform 0.25s linear;
  will-change: transform;
}
.recenter-btn {
  position:fixed; right:16px; bottom:140px; z-index:1000;
  width:44px; height:44px; border-radius:22px; background:white;
  box-shadow:0 4px 12px rgba(0,0,0,0.25); display:flex; align-items:center; justify-content:center;
  font-size:18px; opacity:0; pointer-events:none; transition: opacity 0.2s;
}
.recenter-btn.show { opacity:1; pointer-events:auto; }
</style>
</head>
<body>
<div id="map"></div>
<button class="recenter-btn" id="recenterBtn">🎯</button>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map').setView([${midLat}, ${midLon}], ${zoom});

${tileLayer}

// Маркер конечной точки
const endMarker = L.marker([${endLat}, ${endLon}], {
  title: '${destName || "Назначение"}'
}).addTo(map).bindPopup('<b>${destName || "Назначение"}</b>').openPopup();

// Маркер моего местоположения (обновляется в реальном времени)
const arrowHtml = '<div class="me-wrap"><div class="me-circle"></div><div class="me-arrow"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="white"/></svg></div></div>';

const arrowIcon = L.divIcon({
  html: arrowHtml,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18], // центр иконки = точка GPS: раньше был якорь снизу, из-за чего
                        // кружок визуально "плавал" мимо круга точности
});

let myMarker = L.marker([${startLat}, ${startLon}], { icon: arrowIcon, zIndexOffset: 1000 })
  .addTo(map)
  .bindPopup('Вы здесь');

let accuracyCircle = L.circle([${startLat}, ${startLon}], {
  radius: 20, color: '#6B6FD4', fillColor: '#6B6FD4', fillOpacity: 0.1, weight: 1
}).addTo(map);

// ---------- Плавное перемещение маркера между точками (без "телепортации") ----------
let moveAnimFrame = null;
function animateMarkerTo(marker, lat, lon, duration) {
  const from = marker.getLatLng();
  const start = performance.now();
  if (moveAnimFrame) cancelAnimationFrame(moveAnimFrame);
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t; // линейно — движение почти непрерывное (GPS и так шлёт точки раз в 1-2с)
    const curLat = from.lat + (lat - from.lat) * ease;
    const curLon = from.lng + (lon - from.lng) * ease;
    marker.setLatLng([curLat, curLon]);
    if (t < 1) {
      moveAnimFrame = requestAnimationFrame(step);
    }
  }
  moveAnimFrame = requestAnimationFrame(step);
}

// ---------- Поворот стрелки: девайс-компас, если есть, иначе — по направлению движения ----------
let headingContinuous = 0; // не обрезаем по модулю 360, чтобы стрелка не "скручивалась" через 359->0
function setHeading(newHeadingDeg) {
  let delta = (newHeadingDeg - (headingContinuous % 360)) % 360;
  if (delta < -180) delta += 360;
  if (delta > 180) delta -= 360;
  headingContinuous += delta;
  const el = myMarker.getElement();
  if (el) {
    const arrowEl = el.querySelector('.me-arrow');
    if (arrowEl) arrowEl.style.transform = 'rotate(' + headingContinuous + 'deg)';
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const Δλ = (lon2 - lon1) * Math.PI/180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y, x) * 180/Math.PI + 360) % 360;
}

function formatDist(m) {
  return m >= 1000 ? (m/1000).toFixed(1) + ' км' : Math.round(m) + ' м';
}
function formatDur(min) {
  return min >= 60 ? Math.floor(min/60) + ' ч ' + Math.round(min%60) + ' мин' : Math.round(min) + ' мин';
}

// Инициализация панели снизу теми же значениями, что показывает React (для консистентности)
document.getElementById('dist').textContent = formatDist(${distanceMeters || 0});
document.getElementById('dur').textContent = formatDur(${durationMinutes || 0});

// Строим маршрут (один раз)
fetch('https://router.project-osrm.org/route/v1/foot/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson')
  .then(r => r.json())
  .then(data => {
    if (data.routes && data.routes[0]) {
      const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      const line = L.polyline(coords, { color:'#6B6FD4', weight:6, opacity:0.9 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding:[60,60] });
    }
  })
  .catch(() => {
    L.polyline([[${startLat},${startLon}],[${endLat},${endLon}]], {
      color:'#6B6FD4', weight:5, dashArray:'8,8'
    }).addTo(map);
  });

// ---------- Слежение за компасом устройства (когда GPS heading недоступен, напр. стоим на месте) ----------
let deviceHeading = null;
window.addEventListener('deviceorientationabsolute', onOrientation, true);
window.addEventListener('deviceorientation', onOrientation, true);
function onOrientation(e) {
  let h = null;
  if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
    h = e.webkitCompassHeading; // iOS Safari
  } else if (e.alpha !== null && e.absolute) {
    h = 360 - e.alpha; // Android (absolute orientation)
  }
  if (h !== null && !isNaN(h)) deviceHeading = h;
}

// ---------- Слежение "камера следует за пользователем", с возможностью отключить свайпом ----------
let followMe = true;
const recenterBtn = document.getElementById('recenterBtn');
map.on('dragstart', () => { followMe = false; recenterBtn.classList.add('show'); });
recenterBtn.addEventListener('click', () => {
  followMe = true;
  recenterBtn.classList.remove('show');
  map.panTo(myMarker.getLatLng(), { animate: true, duration: 0.6 });
});

// Отслеживание движения через GPS
let lastFix = null; // { lat, lon, t }
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      const now = Date.now();

      // Плавно едем в новую точку, а не телепортируемся
      animateMarkerTo(myMarker, lat, lon, 700);
      accuracyCircle.setLatLng([lat, lon]).setRadius(acc);

      // Направление стрелки, по приоритету:
      // 1) GPS heading, если устройство реально движется (иначе он "шумит")
      // 2) азимут между предыдущей и текущей GPS-точкой, если сдвиг заметный (>2м, иначе дрожит от шума GPS)
      // 3) компас устройства, если стоим на месте
      let heading = null;
      if (pos.coords.heading !== null && pos.coords.heading !== undefined && !isNaN(pos.coords.heading) && (pos.coords.speed || 0) > 0.3) {
        heading = pos.coords.heading;
      } else if (lastFix && haversine(lastFix.lat, lastFix.lon, lat, lon) > 2) {
        heading = bearing(lastFix.lat, lastFix.lon, lat, lon);
      } else if (deviceHeading !== null) {
        heading = deviceHeading;
      }
      if (heading !== null) setHeading(heading);

      // Камера следует за пользователем, пока он сам не отодвинет карту
      if (followMe) {
        map.panTo([lat, lon], { animate: true, duration: 0.8 });
      }

      // Оставшееся расстояние/время до цели — обновляем на каждый GPS-фикс,
      // а не только в момент прибытия (раньше цифры внизу вообще не менялись в пути).
      const remaining = haversine(lat, lon, ${endLat}, ${endLon});
      const remainingMin = remaining / 67; // ~67 м/мин пешком

      if (remaining < 30) {
        document.getElementById('dist').textContent = '✅ Вы на месте!';
        document.getElementById('dur').textContent = '🎉';
      } else {
        document.getElementById('dist').textContent = formatDist(remaining);
        document.getElementById('dur').textContent = formatDur(remainingMin);
      }

      lastFix = { lat, lon, t: now };
    },
    (err) => console.log('GPS error:', err),
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 1000 }
  );
}
</script>
<div class="info">
  <div class="info-title">📍 До ${destName || 'пункта назначения'}</div>
  <div class="info-row">
    <div class="info-num" id="dist">${distanceMeters >= 1000 ? (distanceMeters/1000).toFixed(1)+' км' : Math.round(distanceMeters||0)+' м'}</div>
    <div class="info-num" id="dur">${durationMinutes >= 60 ? Math.floor(durationMinutes/60)+' ч '+Math.round(durationMinutes%60)+' мин' : Math.round(durationMinutes||0)+' мин'}</div>
  </div>
</div>
</body>
</html>`;

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>✕ Закрыть</Text>
      </TouchableOpacity>
      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={colors.purple} />
          <Text style={{ marginTop: 12, color: colors.textGray }}>Загружаем карту...</Text>
        </View>
      )}
      <WebView
        source={{ html }}
        style={{ flex: 1 }}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  closeBtn: {
    position: 'absolute', top: 50, left: 16, zIndex: 100,
    backgroundColor: 'white', borderRadius: 50,
    paddingHorizontal: 16, paddingVertical: 10,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  closeBtnText: { fontSize: 14, fontWeight: '700', color: colors.purple },
  loader: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 99, backgroundColor: 'white',
    alignItems: 'center', justifyContent: 'center',
  },
});
