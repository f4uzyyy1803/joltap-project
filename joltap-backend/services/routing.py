
import heapq
import math
import random
from datetime import datetime
from typing import List, Dict, Optional, Tuple

from models.models import (
    RouteType, HazardType, Season, RouteVariant,
    RouteWarning, RouteResponse, RouteRequest, UserProfile
)
from services.osm_hazards import get_real_hazards, hazards_to_warnings, calc_safety_score


# ─── Геометрия ────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2) -> float:

    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ─── Mock-граф (только для визуализации линии на карте) ───

def build_mock_graph(start_lat, start_lon, end_lat, end_lon):
    nodes = {}
    edges = {}
    edge_list = []

    steps = 8
    for i in range(steps + 1):
        t = i / steps
        lat = start_lat + (end_lat - start_lat) * t
        lon = start_lon + (end_lon - start_lon) * t
        nodes[i] = {"lat": lat, "lon": lon}

    for i in range(steps):
        edge_list.append((i, i + 1))

    for u, v in edge_list:
        n1, n2 = nodes[u], nodes[v]
        dist = haversine(n1["lat"], n1["lon"], n2["lat"], n2["lon"])
        edges[(u, v)] = {"length": dist}

    return nodes, edges, edge_list


def a_star(nodes, edges, edge_list, start, end, route_type, season, user_profile=None):
    """Простой A* по линейному mock-графу — нужен только для координат линии"""
    adjacency = {i: [] for i in nodes}
    for u, v in edge_list:
        adjacency[u].append(v)
        adjacency[v].append(u)

    queue = [(0, start, [start])]
    visited = set()

    while queue:
        cost, node, path = heapq.heappop(queue)
        if node in visited:
            continue
        visited.add(node)
        if node == end:
            return path
        for neighbor in adjacency[node]:
            if neighbor in visited:
                continue
            edge_key = (node, neighbor) if (node, neighbor) in edges else (neighbor, node)
            if edge_key not in edges:
                continue
            w = edges[edge_key]["length"]
            heapq.heappush(queue, (cost + w, neighbor, path + [neighbor]))

    return None


# ─── Сезон ──────────────────────────────────────────────────

def get_current_season() -> Season:
    month = datetime.now().month
    if month in [12, 1, 2]:
        return Season.winter
    elif month in [3, 4, 5]:
        return Season.spring
    elif month in [6, 7, 8]:
        return Season.summer
    else:
        return Season.autumn


# ─── Главная функция: строим 3 маршрута ────────────────────

def build_routes(
    request: RouteRequest,
    user_profile: Optional[UserProfile] = None
) -> RouteResponse:

    season = get_current_season()

    base_distance = haversine(
        request.start_lat, request.start_lon,
        request.end_lat, request.end_lon
    )

    nodes, edges, edge_list = build_mock_graph(
        request.start_lat, request.start_lon,
        request.end_lat, request.end_lon
    )

    # ─── Получаем РЕАЛЬНЫЕ данные из OpenStreetMap ──────
    real_hazards = get_real_hazards(
        request.start_lat, request.start_lon,
        request.end_lat, request.end_lon
    )
    print(f"[OSM] Найдено {len(real_hazards)} реальных объектов рядом с маршрутом")

    # ─── Параметры для каждого типа маршрута ────────────
    route_configs = {
        RouteType.fast: {
            "distance_mult": 1.05,
            "base_safety": 0.75,
            "desc": "Быстрый маршрут — самый короткий путь, но возможны препятствия.",
            "filter": lambda h: True,
            "max_warnings": 5,
        },
        RouteType.safe: {
            "distance_mult": 1.20,
            "base_safety": 0.90,
            "desc": "Безопасный маршрут — обходит большинство опасных участков.",
            "filter": lambda h: h["severity"] >= 2,
            "max_warnings": 2,
        },
        RouteType.accessible: {
            "distance_mult": 1.35,
            "base_safety": 0.97,
            "desc": "Доступный маршрут — только пандусы и съезды, без лестниц и бордюров.",
            "filter": lambda h: h["hazard_type"] != HazardType.curb,
            "max_warnings": 1,
        },
    }

    # Резервные предупреждения если OSM не вернул данных
    fallback_pool = [
        (HazardType.pothole, "Яма на дороге — снизьте скорость", "Жолда шұңқыр бар", "Pothole ahead"),
        (HazardType.poor_lighting, "Плохое освещение на участке", "Жарық нашар", "Poor lighting"),
        (HazardType.curb, "Высокий бордюр без съезда", "Жоғары бордюр", "High curb"),
    ]
    if season == Season.winter:
        fallback_pool.append(
            (HazardType.ice, "Осторожно! Гололёд на участке", "Абайлаңыз! Жол мұзды", "Icy surface ahead")
        )

    variants = []
    start_node = 0
    end_node = max(nodes.keys())

    for rtype, cfg in route_configs.items():
        distance = base_distance * cfg["distance_mult"]
        duration = distance / 67  # ~4 км/ч для коляски

        if real_hazards:
            filtered = [h for h in real_hazards if cfg["filter"](h)]
            warnings = hazards_to_warnings(
                filtered, request.start_lat, request.start_lon,
                max_count=cfg["max_warnings"]
            )
            safety_score = calc_safety_score(filtered, cfg["base_safety"])
        else:
            count = cfg["max_warnings"]
            step = distance / (count + 1) if count > 0 else 0
            warnings = []
            for i in range(min(count, len(fallback_pool))):
                htype, ru, kz, en = fallback_pool[i]
                # Для accessible не показываем бордюры даже из резерва
                if rtype == RouteType.accessible and htype == HazardType.curb:
                    continue
                warnings.append(RouteWarning(
                    distance_meters=round(step * (i + 1)),
                    type=htype, message_ru=ru, message_kz=kz, message_en=en,
                ))
            safety_score = cfg["base_safety"]

        path = a_star(nodes, edges, edge_list, start_node, end_node, rtype, season, user_profile)
        if path:
            coordinates = [[nodes[n]["lat"], nodes[n]["lon"]] for n in path]
        else:
            coordinates = [
                [request.start_lat, request.start_lon],
                [request.end_lat, request.end_lon],
            ]

        description = f"{cfg['desc']} Время — {round(duration)} мин."

        variants.append(RouteVariant(
            route_type=rtype,
            coordinates=coordinates,
            distance_meters=round(distance),
            duration_minutes=round(duration, 1),
            safety_score=safety_score,
            warnings=warnings,
            description_ru=description,
        ))

    weather_warning = None
    if season == Season.winter:
        weather_warning = "Зима: тротуары могут быть скользкими. Рекомендуем безопасный маршрут."
    elif season == Season.spring:
        weather_warning = "Весна: возможны ямы и лужи после зимы."

    return RouteResponse(variants=variants, season=season, weather_warning=weather_warning)