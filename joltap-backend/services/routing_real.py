"""
services/routing_real.py
─────────────────────────
Реальный роутинг через osmnx + PostgreSQL данные.
Заменяет routing.py с mock-данными.
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy.ext.asyncio import AsyncSession

from models.models import (
    RouteRequest, RouteResponse, RouteVariant,
    RouteType, Season, UserProfile
)
from services.graph import (
    get_almaty_graph, get_graph_for_area,
    enrich_graph_with_hazards, find_route,
    path_to_coordinates, path_total_distance,
    collect_route_warnings
)
from services.hazards_db import get_hazards_for_graph, get_profile_db


def get_current_season() -> Season:
    m = datetime.now().month
    if m in [12, 1, 2]: return Season.winter
    if m in [3, 4, 5]:  return Season.spring
    if m in [6, 7, 8]:  return Season.summer
    return Season.autumn


async def build_routes_real(
    request: RouteRequest,
    db: AsyncSession
) -> RouteResponse:
    """
    Строим реальные маршруты:
    1. Загружаем граф Алматы (или из кэша)
    2. Получаем опасные зоны из PostgreSQL
    3. Обогащаем граф данными опасностей
    4. A* для каждого типа маршрута
    5. Собираем предупреждения
    """
    season = get_current_season()

    # Профиль пользователя
    user_profile: Optional[UserProfile] = None
    if request.user_id:
        user_profile = await get_profile_db(db, request.user_id)

    avoid_crowds = user_profile.avoid_crowds if user_profile else True
    avoid_dark   = user_profile.avoid_poor_lighting if user_profile else True

    # Граф — берём область вокруг маршрута (быстрее чем весь Алматы)
    mid_lat = (request.start_lat + request.end_lat) / 2
    mid_lon = (request.start_lon + request.end_lon) / 2

    import math
    dist_between = math.sqrt(
        ((request.end_lat - request.start_lat) * 111000) ** 2 +
        ((request.end_lon - request.start_lon) * 111000) ** 2
    )
    # Берём граф с запасом 500м от маршрута
    graph_radius = int(dist_between / 2 + 500)

    G = get_graph_for_area(mid_lat, mid_lon, dist_m=max(graph_radius, 800))

    # Загружаем опасности из БД и обогащаем граф
    db_hazards = await get_hazards_for_graph(db)
    if db_hazards:
        G = enrich_graph_with_hazards(G, db_hazards)

    # Строим 3 варианта маршрута
    variants = []
    route_configs = [
        RouteType.safe,
        RouteType.accessible,
        RouteType.fast,
    ]

    for rtype in route_configs:
        path = find_route(
            G,
            request.start_lat, request.start_lon,
            request.end_lat, request.end_lon,
            route_type=rtype,
            season=season,
            avoid_crowds=avoid_crowds,
            avoid_dark=avoid_dark,
        )

        if not path:
            continue

        coordinates = path_to_coordinates(G, path)
        distance    = path_total_distance(G, path)
        duration    = distance / 67  # ~4 км/ч для коляски
        warnings    = collect_route_warnings(G, path)
        safety      = max(0.0, 1.0 - len(warnings) * 0.15)

        descriptions = {
            RouteType.safe:       f"Безопасный маршрут. {round(distance)}м, {round(duration)} мин.",
            RouteType.accessible: f"Доступный маршрут. {round(distance)}м, {round(duration)} мин. Только пандусы.",
            RouteType.fast:       f"Быстрый маршрут. {round(distance)}м, {round(duration)} мин.",
        }

        variants.append(RouteVariant(
            route_type=rtype,
            coordinates=coordinates,
            distance_meters=round(distance),
            duration_minutes=round(duration, 1),
            safety_score=round(safety, 2),
            warnings=warnings,
            description_ru=descriptions[rtype]
        ))

    # Сезонное предупреждение
    weather_warning = {
        Season.winter: "Зима: тротуары могут быть скользкими. Рекомендуем безопасный маршрут.",
        Season.spring: "Весна: возможны ямы и лужи после зимы.",
    }.get(season)

    return RouteResponse(
        variants=variants,
        season=season,
        weather_warning=weather_warning
    )
