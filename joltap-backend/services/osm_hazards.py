
import math
import time
import requests
from typing import List, Dict, Optional
from models.models import RouteWarning, HazardType

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSRM_URL = "https://router.project-osrm.org/route/v1/foot"

# Простой in-memory кэш Overpass-запросов по округлённому bbox.
# Overpass — публичный сервис с ограничением по частоте запросов, и без
# кэша он дёргался на каждый запрос маршрута, что было и медленно (до
# 15 сек таймаута), и рискованно (могут забанить по IP при нагрузке).
_hazards_cache: Dict[str, dict] = {}
_HAZARDS_CACHE_TTL_SECONDS = 600  # 10 минут — препятствия не появляются ежеминутно


def _bbox_cache_key(min_lat, min_lon, max_lat, max_lon) -> str:
    # округляем до ~100м, чтобы близкие маршруты попадали в один и тот же кэш
    r = lambda x: round(x, 3)
    return f"{r(min_lat)}:{r(min_lon)}:{r(max_lat)}:{r(max_lon)}"


def get_osrm_route_distance(start_lat, start_lon, end_lat, end_lon, timeout=6):
    try:
        url = f"{OSRM_URL}/{start_lon},{start_lat};{end_lon},{end_lat}?overview=false"
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        if data.get("routes"):
            return data["routes"][0]["distance"]
    except Exception as e:
        print(f"[OSRM] Недоступен: {e}")
    return None

def haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def get_real_hazards(start_lat, start_lon, end_lat, end_lon, padding=0.004) -> List[Dict]:
    """
    Запрашивает у OpenStreetMap реальные:
    - бордюры без понижения (kerb=raised)
    - неровное покрытие (surface=unpaved/gravel/...)
    - неосвещённые участки (lit=no)
    - лестницы (highway=steps)
    - барьеры (barrier=bollard/gate/...)
    в прямоугольной области вокруг маршрута.
    """
    min_lat = min(start_lat, end_lat) - padding
    max_lat = max(start_lat, end_lat) + padding
    min_lon = min(start_lon, end_lon) - padding
    max_lon = max(start_lon, end_lon) + padding
    bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"

    cache_key = _bbox_cache_key(min_lat, min_lon, max_lat, max_lon)
    cached = _hazards_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < _HAZARDS_CACHE_TTL_SECONDS:
        return cached["data"]

    query = f"""
    [out:json][timeout:12];
    (
      node["kerb"]({bbox});
      way["highway"]["surface"]({bbox});
      way["highway"]["lit"="no"]({bbox});
      way["highway"="steps"]({bbox});
      node["barrier"]({bbox});
    );
    out geom;
    """

    try:
        resp = requests.post(
            OVERPASS_URL,
            data={"data": query},
            headers={
                "User-Agent": "JolTap-hackathon-project/1.0 (contact: see README)",
                "Accept": "application/json",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"[OSM] Overpass недоступен: {e}")
        return []

    hazards = []

    for el in data.get("elements", []):
        tags = el.get("tags", {})

        # Координаты элемента
        if el.get("type") == "node":
            lat, lon = el.get("lat"), el.get("lon")
        elif el.get("geometry"):
            geom = el["geometry"]
            mid = geom[len(geom) // 2]
            lat, lon = mid.get("lat"), mid.get("lon")
        else:
            continue

        if lat is None or lon is None:
            continue

        # ── Бордюр без понижения ──
        kerb = tags.get("kerb")
        if kerb in ("raised", "high"):
            hazards.append({
                "lat": lat, "lon": lon,
                "hazard_type": HazardType.curb, "severity": 3,
                "passable": False,  # непроходимо для коляски без объезда
                "message_ru": "Высокий бордюр без понижения",
                "message_kz": "Жоғары бордюр, түсу жоқ",
                "message_en": "High curb, no dip",
            })

        # ── Неровное покрытие ──
        surface = tags.get("surface")
        if surface in ("unpaved", "gravel", "ground", "dirt", "cobblestone", "sett", "compacted"):
            hazards.append({
                "lat": lat, "lon": lon,
                "hazard_type": HazardType.pothole, "severity": 2,
                "passable": True,  # проходимо, но с осторожностью/медленнее
                "message_ru": f"Неровное покрытие тротуара ({surface})",
                "message_kz": "Жол беті тегіс емес",
                "message_en": f"Rough surface ({surface})",
            })

        # ── Плохое освещение ──
        if tags.get("lit") == "no":
            hazards.append({
                "lat": lat, "lon": lon,
                "hazard_type": HazardType.poor_lighting, "severity": 1,
                "passable": True,
                "message_ru": "Участок без освещения",
                "message_kz": "Жарықсыз учаске",
                "message_en": "Unlit section",
            })

        # ── Лестницы ──
        if tags.get("highway") == "steps":
            hazards.append({
                "lat": lat, "lon": lon,
                "hazard_type": HazardType.curb, "severity": 3,
                "passable": False,  # лестница без пандуса — непроходимо для коляски
                "message_ru": "Лестница без пандуса",
                "message_kz": "Баспалдақ, пандус жоқ",
                "message_en": "Steps, no ramp",
            })

        # ── Барьеры на пути ──
        barrier = tags.get("barrier")
        if barrier in ("bollard", "gate", "fence", "wall", "block"):
            hazards.append({
                "lat": lat, "lon": lon,
                "hazard_type": HazardType.construction, "severity": 2,
                "passable": barrier not in ("wall", "block"),  # эти два реально перекрывают путь
                "message_ru": "Препятствие на тротуаре",
                "message_kz": "Жолда кедергі бар",
                "message_en": f"Obstacle on path ({barrier})",
            })

    _hazards_cache[cache_key] = {"data": hazards, "ts": time.time()}
    return hazards


def hazards_to_warnings(
    hazards: List[Dict], start_lat, start_lon, max_count: Optional[int] = None
) -> List[RouteWarning]:
    """
    Преобразует найденные хазарды в предупреждения с координатами (для
    маркеров на карте) и флагом passable, отсортированные по расстоянию
    от старта.

    max_count=None (по умолчанию) — вернуть все найденные препятствия,
    чтобы на карте было видно полную картину; передайте число, если
    нужно ограничить (например, для короткого текстового списка).
    """
    for h in hazards:
        h["_dist"] = haversine(start_lat, start_lon, h["lat"], h["lon"])

    hazards_sorted = sorted(hazards, key=lambda x: x["_dist"])
    if max_count is not None:
        hazards_sorted = hazards_sorted[:max_count]

    warnings = []
    for h in hazards_sorted:
        warnings.append(RouteWarning(
            distance_meters=round(h["_dist"]),
            lat=h["lat"],
            lon=h["lon"],
            passable=h.get("passable", True),
            type=h["hazard_type"],
            message_ru=h["message_ru"],
            message_kz=h["message_kz"],
            message_en=h["message_en"],
        ))
    return warnings


def calc_safety_score(hazards: List[Dict], base_score: float) -> float:
    """Понижает базовую оценку безопасности в зависимости от найденных опасностей"""
    if not hazards:
        return min(1.0, base_score + 0.05)

    total_severity = sum(h["severity"] for h in hazards[:8])
    penalty = total_severity * 0.025
    return round(max(0.30, base_score - penalty), 2)