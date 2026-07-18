import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';

export default function RouteMap({ startLat, startLon, endLat, endLon, destName, onClose, distanceMeters, durationMinutes }) {
  const [loading, setLoading] = useState(true);

  const midLat = (startLat + endLat) / 2;
  const midLon = (startLon + endLon) / 2;
  const dist = Math.sqrt((endLat - startLat) ** 2 + (endLon - startLon) ** 2);
  const zoom = dist < 0.01 ? 15 : dist < 0.05 ? 13 : dist < 0.1 ? 12 : dist < 0.3 ? 11 : 10;

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
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map').setView([${midLat}, ${midLon}], ${zoom});

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom:20, attribution:'CartoDB' }).addTo(map);

// Маркер конечной точки
const endMarker = L.marker([${endLat}, ${endLon}], {
  title: '${destName || "Назначение"}'
}).addTo(map).bindPopup('<b>${destName || "Назначение"}</b>').openPopup();

// Маркер моего местоположения (обновляется в реальном времени)
const arrowHtml = '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6B6FD4,#8B8FE8);border:3px solid white;box-shadow:0 4px 16px rgba(107,111,212,0.5);display:flex;align-items:center;justify-content:center;"><div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:18px solid white;margin-bottom:4px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2));"></div></div>';

const arrowIcon = L.divIcon({
  html: arrowHtml,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

let myMarker = L.marker([${startLat}, ${startLon}], { icon: arrowIcon })
  .addTo(map)
  .bindPopup('Вы здесь');

let accuracyCircle = L.circle([${startLat}, ${startLon}], {
  radius: 20, color: '#6B6FD4', fillColor: '#6B6FD4', fillOpacity: 0.1, weight: 1
}).addTo(map);

// Строим маршрут
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

// Отслеживание движения через GPS
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy;

      // Обновляем маркер
      myMarker.setLatLng([lat, lon]);
        if (pos.coords.heading !== null && pos.coords.heading !== undefined) {
          const heading = pos.coords.heading;
          const el = myMarker.getElement();
          if (el) {
    el.querySelector('div').style.transform = 'rotate(' + (heading - 45) + 'deg)';
  }
}
      accuracyCircle.setLatLng([lat, lon]).setRadius(acc);

      // Следим за движением
      map.panTo([lat, lon], { animate: true, duration: 1 });

      // Считаем оставшееся расстояние до цели
      const R = 6371000;
      const dLat = (${endLat} - lat) * Math.PI / 180;
      const dLon = (${endLon} - lon) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180)*Math.cos(${endLat}*Math.PI/180)*Math.sin(dLon/2)**2;
      const remaining = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      const t = Math.round(remaining / 67);

      // Если дошли до цели (менее 30м)
     // Если дошли до цели (менее 30м)
      if (remaining < 30) {
        document.getElementById('dist').textContent = '✅ Вы на месте!';
        document.getElementById('dur').textContent = '🎉';
      }
    },
    (err) => console.log('GPS error:', err),
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 2000 }
  );
}


const startIcon = L.circleMarker([${startLat}, ${startLon}], { radius:8, color:'#6B6FD4', fillColor:'#6B6FD4', fillOpacity:1 }).addTo(map).bindPopup('Я здесь');
const endIcon = L.marker([${endLat}, ${endLon}]).addTo(map).bindPopup('${destName || "Назначение"}').openPopup();

fetch('https://router.project-osrm.org/route/v1/foot/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson')
  .then(r => r.json())
  .then(data => {
    if (data.routes && data.routes[0]) {
      const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      const line = L.polyline(coords, { color:'#6B6FD4', weight:5 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding:[40,40] });
      const d = data.routes[0].distance;
      const t = Math.round(d / 67);
    }
  })
  .catch(() => {
    L.polyline([[${startLat},${startLon}],[${endLat},${endLon}]], { color:'#6B6FD4', weight:5, dashArray:'8,8' }).addTo(map);
  });
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