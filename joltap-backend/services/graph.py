"""
services/graph.py
─────────────────
Реальный граф пешеходных дорог через osmnx — не только Алматы,
а любой город Казахстана. Город определяется по координатам
через обратное геокодирование (Nominatim), граф кэшируется
на диск отдельно для каждого города — качается один раз для
каждого нового города, дальше берётся из кэша.
"""

import os
import json
import pickle
import math
import re
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Tuple, Dict


import requests
import osmnx as ox
import networkx as nx

from models.models import RouteType, Season, RouteWarning, HazardType


# ─── Кэш графов (по городу) ───────────────────────────────

CACHE_DIR = Path("cache")
CACHE_HOURS = int(os.getenv("GRAPH_CACHE_HOURS", 24))

_graph_cache: Dict[str, nx.MultiDiGraph] = {}


class UnsupportedLocationError(Exception):
    """Точка вне Казахстана, либо не удалось определить город по координатам,
    либо начало и конец маршрута оказались в разных городах."""
    pass


def _slug(name: str) -> str:
    """'Shymkent, Kazakhstan' → 'shymkent_kazakhstan' — для имени файла кэша."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def get_city_graph(place_query: str) -> nx.MultiDiGraph:
    """
    Загрузить граф пешеходных дорог для города.
    place_query — строка вида "Shymkent, Kazakhstan" (её же ест ox.graph_from_place).

    Первый раз для города — скачивает из OSM (от ~10 сек для небольшого города
    до 1-2 минут для крупного, вроде Алматы или Астаны).
    Дальше — из кэша (в памяти, пока сервер жив; на диске — между перезапусками).
    """
    cache_key = _slug(place_query)

    if cache_key in _graph_cache:
        return _graph_cache[cache_key]

    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{cache_key}_graph.pkl"

    if cache_file.exists():
        cache_age = datetime.now() - datetime.fromtimestamp(cache_file.stat().st_mtime)
        if cache_age < timedelta(hours=CACHE_HOURS):
            print(f"[GRAPH] Загружаем граф «{place_query}» из кэша...")
            with open(cache_file, "rb") as f:
                G = pickle.load(f)
            print(f"[GRAPH] Загружено: {len(G.nodes)} узлов, {len(G.edges)} рёбер")
            _graph_cache[cache_key] = G
            return G

    print(f"[GRAPH] Скачиваем граф «{place_query}» из OpenStreetMap...")
    G = ox.graph_from_place(
        place_query,
        network_type="walk",       # пешеходная сеть (включает тротуары)
        simplify=True,             # упрощаем граф
        retain_all=False,
    )

    G = ox.distance.add_edge_lengths(G)
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)

    with open(cache_file, "wb") as f:
        pickle.dump(G, f)
    print(f"[GRAPH] Граф «{place_query}» сохранён в кэш: {len(G.nodes)} узлов")

    _graph_cache[cache_key] = G
    return G


def get_almaty_graph() -> nx.MultiDiGraph:
    """Обратная совместимость + используется для прогрева графа при старте сервера
    (см. main_real.py) — Алматы остаётся городом по умолчанию для демо."""
    return get_city_graph("Almaty, Kazakhstan")


# ─── Определение города по координатам ────────────────────

_CITY_LOOKUP_CACHE_FILE = CACHE_DIR / "city_lookup_cache.json"
_city_lookup_cache: Optional[Dict[str, str]] = None


def _grid_key(lat: float, lon: float, grid: float = 0.05) -> str:
    """Ключ ячейки ~5х5км — чтобы не дёргать Nominatim на каждый одинаковый район."""
    return f"{round(lat / grid)}_{round(lon / grid)}"


def _load_city_lookup_cache() -> Dict[str, str]:
    global _city_lookup_cache
    if _city_lookup_cache is not None:
        return _city_lookup_cache
    CACHE_DIR.mkdir(exist_ok=True)
    if _CITY_LOOKUP_CACHE_FILE.exists():
        try:
            with open(_CITY_LOOKUP_CACHE_FILE, "r", encoding="utf-8") as f:
                _city_lookup_cache = json.load(f)
                return _city_lookup_cache
        except Exception:
            pass
    _city_lookup_cache = {}
    return _city_lookup_cache


def _save_city_lookup_cache():
    CACHE_DIR.mkdir(exist_ok=True)
    with open(_CITY_LOOKUP_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(_city_lookup_cache, f, ensure_ascii=False, indent=2)


def resolve_city(lat: float, lon: float) -> str:
    """
    По координатам определяет город через обратное геокодирование Nominatim
    и возвращает строку для ox.graph_from_place, например "Shymkent, Kazakhstan".

    Результат кэшируется по сетке ~5х5км (в памяти и на диске), поэтому
    Nominatim дёргается не на каждый запрос маршрута, а примерно по разу
    на новый район — как и graph-кэш, это не должно влиять на скорость
    ответа после первого запроса в этом районе.

    Кидает UnsupportedLocationError, если точка не в Казахстане или город
    определить не удалось — вместо того, чтобы молча посчитать маршрут
    по чужому городу.
    """
    cache = _load_city_lookup_cache()
    key = _grid_key(lat, lon)

    if key in cache:
        place = cache[key]
        if not place:
            raise UnsupportedLocationError(
                f"Координаты ({lat}, {lon}) вне поддерживаемой зоны (не Казахстан либо город не определён)"
            )
        return place

    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "zoom": 10, "addressdetails": 1},
            headers={
                "User-Agent": "JolTap-hackathon-project/1.0 (contact: see README)",
                "Accept-Language": "en",
            },
            timeout=8,
        )
        resp.raise_for_status()
        address = resp.json().get("address", {})
    except Exception as e:
        # Сеть недоступна / Nominatim не ответил — не кэшируем отрицательный
        # результат навсегда, это может быть временный сбой, а не факт о точке.
        raise UnsupportedLocationError(f"Не удалось определить город для ({lat}, {lon}): {e}")

    country_code = (address.get("country_code") or "").lower()
    if country_code != "kz":
        cache[key] = ""
        _save_city_lookup_cache()
        raise UnsupportedLocationError(f"Координаты ({lat}, {lon}) вне Казахстана")

    city_name = (
        address.get("city") or address.get("town") or
        address.get("municipality") or address.get("county")
    )
    if not city_name:
        cache[key] = ""
        _save_city_lookup_cache()
        raise UnsupportedLocationError(f"Не удалось определить населённый пункт для ({lat}, {lon})")

    place_query = f"{city_name}, Kazakhstan"
    cache[key] = place_query
    _save_city_lookup_cache()
    return place_query


# ─── Обогащение графа данными из вашей БД ───────────────

def enrich_graph_with_hazards(G: nx.MultiDiGraph, db_hazards: List[dict]) -> nx.MultiDiGraph:
    """
    Накладываем краудсорсинговые данные на граф.
    Для каждой опасной точки — находим ближайшее ребро и помечаем его.

    db_hazards: список словарей {'lat', 'lon', 'hazard_type', 'severity'}
    """
    if not db_hazards:
        return G

    # Координаты опасных точек
    lons = [h["lon"] for h in db_hazards]
    lats = [h["lat"] for h in db_hazards]

    # Находим ближайшие рёбра для всех точек сразу (быстро)
    nearest_edges = ox.nearest_edges(G, lons, lats)

    for hazard, (u, v, key) in zip(db_hazards, nearest_edges):
        if G.has_edge(u, v, key):
            G[u][v][key]["hazard_type"] = hazard["hazard_type"]
            G[u][v][key]["hazard_severity"] = hazard["severity"]

    return G


# ─── Веса доступности ────────────────────────────────────

# OSM-теги дорог, рядом с которыми обычно больше пешеходов/машин —
# используем как грубую замену полноценных данных о загруженности,
# пока в проекте нет источника реальных данных о толпах (Google Places
# Popular Times, городские датчики и т.п.). Это placeholder-эвристика,
# а не точная модель — стоит заменить на реальные данные, когда они появятся.
_BUSY_HIGHWAY_TAGS = {"primary", "secondary", "tertiary", "living_street", "pedestrian"}


def calculate_weight(
    edge_data: dict,
    route_type: RouteType,
    season: Season,
    avoid_crowds: bool = True,
    avoid_dark: bool = True,
) -> float:
    """
    Вычислить стоимость ребра с учётом доступности.
    Больше вес = хуже для пользователя.
    """
    length = edge_data.get("length", 1.0)
    penalty = 0.0

    safety = {
        RouteType.safe: 2.5,
        RouteType.accessible: 2.0,
        RouteType.fast: 0.2,
    }[route_type]

    # ── Покрытие ──────────────────────────────────────────
    surface = _first(edge_data.get("surface", ""))
    if surface in ("unpaved", "gravel", "dirt", "ground"):
        penalty += 80 * safety
    elif surface in ("cobblestone", "sett"):
        penalty += 50 * safety

    # ── Уклон (из OSM: "incline" в процентах) ────────────
    incline_raw = _first(edge_data.get("incline", "0%"))
    try:
        incline = abs(float(str(incline_raw).replace("%", "")))
    except ValueError:
        incline = 0
    if incline > 10:
        penalty += 80 * safety
    elif incline > 6:
        penalty += 40 * safety

    # ── Лестницы — полный запрет для accessible ───────────
    highway = _first(edge_data.get("highway", ""))
    if highway == "steps":
        if route_type == RouteType.accessible:
            return length + 100_000   # блокируем
        penalty += 200 * safety

    # ── Освещение ─────────────────────────────────────────
    if avoid_dark:
        hour = datetime.now().hour
        is_night = hour < 7 or hour > 20
        if _first(edge_data.get("lit")) in ("no", None) and is_night:
            penalty += 40 * safety

    # ── Толпы (пока эвристика по типу дороги, см. комментарий выше) ──
    if avoid_crowds and highway in _BUSY_HIGHWAY_TAGS:
        penalty += 15 * safety

    # ── Ваши опасные зоны из БД ───────────────────────────
    hazard = edge_data.get("hazard_type")
    severity = edge_data.get("hazard_severity", 1)
    if hazard:
        hazard_weights = {
            "curb": 60, "pothole": 50, "ice": 130,
            "snow": 90, "poor_lighting": 35, "construction": 100,
        }
        base_penalty = hazard_weights.get(hazard, 50)
        penalty += base_penalty * severity * safety

    # ── Сезон ─────────────────────────────────────────────
    if season == Season.winter:
        penalty += 25  # общая зимняя надбавка
        if hazard == "ice":
            penalty += 100 * safety
    elif season in (Season.spring, Season.autumn):
        if hazard == "pothole":
            penalty += 40 * safety

    return length + penalty


def _first(value):
    """OSM-теги после ox.simplify() иногда приходят списком
    (если у объединённых сегментов разные значения тега) — берём первое."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def is_edge_passable(edge_data: dict, route_type: RouteType) -> bool:
    """
    Можно ли реально пройти/проехать по этому ребру для данного типа маршрута —
    в отличие от веса (штраф), это бинарный признак для отображения на карте.
    Эвристика первого приближения: лестница непроходима для доступного маршрута,
    тяжёлая (severity 3) опасность на safe/accessible считается непроходимой.
    Стоит уточнять по мере поступления реальных данных о профилях пользователей.
    """
    highway = _first(edge_data.get("highway", ""))
    if highway == "steps" and route_type == RouteType.accessible:
        return False

    severity = edge_data.get("hazard_severity", 0)
    if severity >= 3 and route_type in (RouteType.accessible, RouteType.safe):
        return False

    return True


def _parallel_edge_weight(edge_dict: dict, route_type, season, avoid_crowds, avoid_dark) -> float:
    """Вес ребра между u и v для MultiDiGraph: edge_dict — это {key: edge_data, ...},
    берём минимальный вес среди параллельных рёбер (так же, как это неявно
    делает networkx при weight=строка)."""
    return min(
        calculate_weight(d, route_type, season, avoid_crowds, avoid_dark)
        for d in edge_dict.values()
    )


def _best_parallel_edge(edge_dict: dict, route_type, season, avoid_crowds, avoid_dark) -> dict:
    """То самое ребро (edge_data), которое дало минимальный вес — используем его
    и для веса, и для расчёта дистанции/предупреждений, чтобы не рассинхронизироваться."""
    return min(
        edge_dict.values(),
        key=lambda d: calculate_weight(d, route_type, season, avoid_crowds, avoid_dark)
    )


# ─── A* на реальном графе ────────────────────────────────

def find_route(
    G: nx.MultiDiGraph,
    start_lat: float, start_lon: float,
    end_lat: float, end_lon: float,
    route_type: RouteType,
    season: Season,
    avoid_crowds: bool = True,
    avoid_dark: bool = True,
) -> Optional[List[int]]:
    """
    Найти маршрут в реальном графе OSM с помощью A*.
    Возвращает список node_id или None если маршрут не найден.

    Вес считается "на лету" через callable, а не проставляется заранее
    на все рёбра графа — это (а) не мутирует общий закэшированный граф
    (иначе параллельные запросы с разными route_type/сезоном будут затирать
    веса друг друга), и (б) не требует полного прохода по всем рёбрам города
    перед каждым поиском — A* считает вес только для тех рёбер, что реально
    рассматривает.
    """

    # Находим ближайшие узлы к точкам A и B
    start_node = ox.nearest_nodes(G, start_lon, start_lat)
    end_node   = ox.nearest_nodes(G, end_lon, end_lat)

    if start_node == end_node:
        return [start_node]

    def weight(u, v, edge_dict):
        return _parallel_edge_weight(edge_dict, route_type, season, avoid_crowds, avoid_dark)

    try:
        path = nx.astar_path(
            G,
            start_node,
            end_node,
            weight=weight,
            heuristic=lambda u, v: haversine(
                G.nodes[u]["y"], G.nodes[u]["x"],
                G.nodes[v]["y"], G.nodes[v]["x"]
            )
        )
        return path
    except nx.NetworkXNoPath:
        return None


def haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


# ─── Извлечь координаты маршрута ─────────────────────────

def path_to_coordinates(G: nx.MultiDiGraph, path: List[int]) -> List[List[float]]:
    """Преобразовать list[node_id] → list[[lat, lon]]"""
    return [[G.nodes[n]["y"], G.nodes[n]["x"]] for n in path]


def path_total_distance(
    G: nx.MultiDiGraph,
    path: List[int],
    route_type: RouteType,
    season: Season,
    avoid_crowds: bool = True,
    avoid_dark: bool = True,
) -> float:
    """
    Полное расстояние маршрута в метрах.

    Берём то же самое параллельное ребро (по минимальному calculate_weight),
    которое реально "выбрал" A* при поиске пути — раньше здесь бралась
    минимальная длина среди параллельных рёбер, что могло не совпадать
    с рёбрами, по которым считались предупреждения.
    """
    total = 0.0
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        edge_data = _best_parallel_edge(G[u][v], route_type, season, avoid_crowds, avoid_dark)
        total += edge_data.get("length", 0)
    return total


# ─── Предупреждения по реальному маршруту ────────────────

def collect_route_warnings(
    G: nx.MultiDiGraph,
    path: List[int],
    route_type: RouteType,
    season: Season,
    avoid_crowds: bool = True,
    avoid_dark: bool = True,
) -> List[RouteWarning]:
    """
    Собрать предупреждения вдоль маршрута — с координатами (для маркеров
    на карте) и флагом passable (реально ли это ребро проходимо для
    выбранного типа маршрута, а не просто "штрафуется").

    Использует то же ребро (_best_parallel_edge), что и path_total_distance,
    чтобы дистанция и список препятствий не расходились.
    """
    warnings = []
    dist_so_far = 0.0

    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        edge_data = _best_parallel_edge(G[u][v], route_type, season, avoid_crowds, avoid_dark)
        seg_len = edge_data.get("length", 0)
        dist_so_far += seg_len

        # Координаты для маркера — конец сегмента (узел v)
        marker_lat = G.nodes[v]["y"]
        marker_lon = G.nodes[v]["x"]
        passable = is_edge_passable(edge_data, route_type)

        # Лестница
        if _first(edge_data.get("highway")) == "steps":
            warnings.append(RouteWarning(
                distance_meters=round(dist_so_far),
                lat=marker_lat,
                lon=marker_lon,
                passable=passable,
                type=HazardType.curb,
                message_ru=f"Через {round(seg_len)}м лестница" + ("" if passable else " — непроходимо для коляски"),
                message_kz=f"{round(seg_len)}м-ден кейін баспалдақ",
                message_en=f"Steps in {round(seg_len)}m" + ("" if passable else " — not wheelchair accessible")
            ))

        hazard = edge_data.get("hazard_type")
        if hazard:
            messages = {
                "curb":          ("Высокий бордюр", "Жоғары бордюр", "High curb"),
                "pothole":       ("Яма на дороге", "Жолда шұңқыр", "Pothole ahead"),
                "ice":           ("Осторожно! Гололёд", "Абайлаңыз! Мұз", "Icy surface"),
                "snow":          ("Снег на дороге", "Жолда қар бар", "Snow on road"),
                "construction":  ("Дорожные работы", "Жол жөндеу жұмыстары", "Construction"),
                "poor_lighting": ("Плохое освещение", "Жарық нашар", "Poor lighting"),
            }
            ru, kz, en = messages.get(hazard, ("Препятствие", "Кедергі", "Obstacle"))
            warnings.append(RouteWarning(
                distance_meters=round(dist_so_far),
                lat=marker_lat,
                lon=marker_lon,
                passable=passable,
                type=HazardType(hazard),
                message_ru=ru,
                message_kz=kz,
                message_en=en
            ))

    return warnings
