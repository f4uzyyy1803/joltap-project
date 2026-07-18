"""
services/graph.py
─────────────────
Реальный граф дорог Алматы через osmnx.
Граф кэшируется на диск — загружается один раз, потом быстро.
"""

import os
import pickle
import heapq
import math
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Tuple, Dict

import osmnx as ox
import networkx as nx

from models.models import RouteType, Season, RouteWarning, HazardType


# ─── Кэш графа ───────────────────────────────────────────

CACHE_DIR = Path("cache")
CACHE_FILE = CACHE_DIR / "almaty_graph.pkl"
CACHE_HOURS = int(os.getenv("GRAPH_CACHE_HOURS", 24))

_graph_cache: Optional[nx.MultiDiGraph] = None


def get_almaty_graph() -> nx.MultiDiGraph:
    """
    Загрузить граф дорог Алматы.
    Первый раз — скачивает из OSM (~30 сек).
    Следующие разы — загружает из кэша мгновенно.
    """
    global _graph_cache

    # Уже в памяти
    if _graph_cache is not None:
        return _graph_cache

    CACHE_DIR.mkdir(exist_ok=True)

    # Есть свежий кэш на диске
    if CACHE_FILE.exists():
        cache_age = datetime.now() - datetime.fromtimestamp(CACHE_FILE.stat().st_mtime)
        if cache_age < timedelta(hours=CACHE_HOURS):
            print("[GRAPH] Загружаем граф из кэша...")
            with open(CACHE_FILE, "rb") as f:
                _graph_cache = pickle.load(f)
            print(f"[GRAPH] Загружено: {len(_graph_cache.nodes)} узлов, {len(_graph_cache.edges)} рёбер")
            return _graph_cache

    # Скачиваем из OpenStreetMap
    print("[GRAPH] Скачиваем граф Алматы из OpenStreetMap (~30 сек)...")
    G = ox.graph_from_place(
        "Almaty, Kazakhstan",
        network_type="walk",       # пешеходная сеть (включает тротуары)
        simplify=True,             # упрощаем граф
        retain_all=False,
    )

    # Добавляем длины рёбер
    G = ox.add_edge_lengths(G)

    # Добавляем скорости и время (для расчёта времени пути)
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)

    # Сохраняем кэш
    with open(CACHE_FILE, "wb") as f:
        pickle.dump(G, f)
    print(f"[GRAPH] Граф сохранён в кэш: {len(G.nodes)} узлов")

    _graph_cache = G
    return G


def get_graph_for_area(lat: float, lon: float, dist_m: int = 2000) -> nx.MultiDiGraph:
    """
    Получить подграф вокруг точки — быстрее чем весь Алматы.
    dist_m — радиус в метрах (по умолчанию 2 км).

    Используй это если весь граф Алматы слишком большой.
    """
    print(f"[GRAPH] Скачиваем граф {dist_m}м вокруг ({lat}, {lon})...")
    G = ox.graph_from_point(
        (lat, lon),
        dist=dist_m,
        network_type="walk",
        simplify=True
    )
    G = ox.add_edge_lengths(G)
    return G


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
    surface = edge_data.get("surface", "")
    if surface in ("unpaved", "gravel", "dirt", "ground"):
        penalty += 80 * safety
    elif surface in ("cobblestone", "sett"):
        penalty += 50 * safety

    # ── Уклон (из OSM: "incline" в процентах) ────────────
    incline_raw = edge_data.get("incline", "0%")
    try:
        incline = abs(float(str(incline_raw).replace("%", "")))
    except ValueError:
        incline = 0
    if incline > 10:
        penalty += 80 * safety
    elif incline > 6:
        penalty += 40 * safety

    # ── Лестницы — полный запрет для accessible ───────────
    highway = edge_data.get("highway", "")
    if highway == "steps":
        if route_type == RouteType.accessible:
            return length + 100_000   # блокируем
        penalty += 200 * safety

    # ── Освещение ─────────────────────────────────────────
    if avoid_dark:
        hour = datetime.now().hour
        is_night = hour < 7 or hour > 20
        if edge_data.get("lit") in ("no", None) and is_night:
            penalty += 40 * safety

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
        if edge_data.get("hazard_type") == "ice":
            penalty += 100 * safety
    elif season in (Season.spring, Season.autumn):
        if edge_data.get("hazard_type") == "pothole":
            penalty += 40 * safety

    return length + penalty


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
    """

    # Находим ближайшие узлы к точкам A и B
    start_node = ox.nearest_nodes(G, start_lon, start_lat)
    end_node   = ox.nearest_nodes(G, end_lon, end_lat)

    if start_node == end_node:
        return [start_node]

    # Устанавливаем веса на рёбра
    for u, v, key, data in G.edges(keys=True, data=True):
        w = calculate_weight(data, route_type, season, avoid_crowds, avoid_dark)
        G[u][v][key]["custom_weight"] = w

    # A* из networkx с нашими весами
    try:
        path = nx.astar_path(
            G,
            start_node,
            end_node,
            weight="custom_weight",
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


def path_total_distance(G: nx.MultiDiGraph, path: List[int]) -> float:
    """Полное расстояние маршрута в метрах"""
    total = 0.0
    for i in range(len(path) - 1):
        u, v = path[i], path[i+1]
        edges = G[u][v]
        # Берём минимальную длину среди параллельных рёбер
        total += min(d.get("length", 0) for d in edges.values())
    return total


# ─── Предупреждения по реальному маршруту ────────────────

def collect_route_warnings(
    G: nx.MultiDiGraph,
    path: List[int]
) -> List[RouteWarning]:
    """Собрать предупреждения вдоль маршрута"""
    warnings = []
    dist_so_far = 0.0

    for i in range(len(path) - 1):
        u, v = path[i], path[i+1]
        edges = G[u][v]
        # Берём данные первого ребра
        edge_data = list(edges.values())[0]
        seg_len = edge_data.get("length", 0)
        dist_so_far += seg_len

        # Лестница
        if edge_data.get("highway") == "steps":
            warnings.append(RouteWarning(
                distance_meters=round(dist_so_far),
                type=HazardType.curb,
                message_ru=f"Через {round(seg_len)}м лестница",
                message_kz=f"{round(seg_len)}м-ден кейін баспалдақ",
                message_en=f"Steps in {round(seg_len)}m"
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
                type=HazardType(hazard),
                message_ru=ru,
                message_kz=kz,
                message_en=en
            ))

    return warnings
