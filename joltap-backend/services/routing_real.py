"""
services/routing_real.py
─────────────────────────
Реальный роутинг через osmnx + PostgreSQL данные.
Заменяет routing.py с mock-данными.
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from models.models import (
    RouteRequest, RouteResponse, RouteVariant,
    RouteType, Season, UserProfile
)
from services.graph import (
    get_city_graph, resolve_city, UnsupportedLocationError,
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


def _build_variant_sync(
    G,
    request: RouteRequest,
    rtype: RouteType,
    season: Season,
    avoid_crowds: bool,
    avoid_dark: bool,
) -> Optional[RouteVariant]:
    """
    Вся тяжёлая CPU-работа для одного варианта маршрута (A* + сбор
    координат/дистанции/предупреждений) — синхронная функция, вызывается
    через run_in_threadpool, чтобы не блокировать event loop FastAPI на
    время поиска пути по графу города.
    """
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
        return None

    coordinates = path_to_coordinates(G, path)
    distance    = path_total_distance(G, path, rtype, season, avoid_crowds, avoid_dark)
    duration    = distance / 67  # ~4 км/ч для коляски
    warnings    = collect_route_warnings(G, path, rtype, season, avoid_crowds, avoid_dark)
    safety      = max(0.0, 1.0 - len(warnings) * 0.15)

    descriptions = {
        RouteType.safe:       f"Безопасный маршрут. {round(distance)}м, {round(duration)} мин.",
        RouteType.accessible: f"Доступный маршрут. {round(distance)}м, {round(duration)} мин. Только пандусы.",
        RouteType.fast:       f"Быстрый маршрут. {round(distance)}м, {round(duration)} мин.",
    }

    return RouteVariant(
        route_type=rtype,
        coordinates=coordinates,
        distance_meters=round(distance),
        duration_minutes=round(duration, 1),
        safety_score=round(safety, 2),
        warnings=warnings,
        description_ru=descriptions[rtype]
    )


async def build_routes_real(
    request: RouteRequest,
    db: AsyncSession
) -> RouteResponse:
    """
    Строим реальные маршруты:
    1. Загружаем граф города (или из кэша)
    2. Получаем опасные зоны из PostgreSQL
    3. Обогащаем граф данными опасностей
    4. A* для каждого типа маршрута
    5. Собираем предупреждения

    Все блокирующие операции (сеть до Nominatim, работа с графом OSM,
    A*) выполняются через run_in_threadpool — раньше они вызывались
    напрямую в этой async-функции и блокировали event loop FastAPI
    целиком (для всех пользователей одновременно) на время геокодинга
    и поиска пути.
    """
    season = get_current_season()

    # Профиль пользователя
    user_profile: Optional[UserProfile] = None
    if request.user_id:
        user_profile = await get_profile_db(db, request.user_id)

    avoid_crowds = user_profile.avoid_crowds if user_profile else True
    avoid_dark   = user_profile.avoid_poor_lighting if user_profile else True

    # Определяем город по координатам (а не жёстко "Алматы") — работает для
    # любого города Казахстана, который знает OpenStreetMap. Если А и Б в
    # разных городах — считаем это неподдерживаемым маршрутом и говорим
    # об этом прямо, а не подсовываем маршрут по случайному графу.
    start_place = await run_in_threadpool(resolve_city, request.start_lat, request.start_lon)
    end_place = await run_in_threadpool(resolve_city, request.end_lat, request.end_lon)

    if start_place != end_place:
        raise UnsupportedLocationError(
            f"Маршрут между городами не поддерживается: "
            f"точка А — {start_place}, точка Б — {end_place}"
        )

    # Граф дорог этого города: кэшируется в памяти и на диске per-город —
    # качается один раз для каждого нового города (см. get_city_graph),
    # а не заново на каждый запрос, как было раньше с get_graph_for_area().
    G = await run_in_threadpool(get_city_graph, start_place)

    # Загружаем опасности из БД и обогащаем граф.
    # get_hazards_for_graph уже фильтрует только подтверждённые опасности
    # (см. services/hazards_db.py) — единичный неподтверждённый репорт
    # не влияет на маршруты всех пользователей.
    db_hazards = await get_hazards_for_graph(db)
    if db_hazards:
        G = await run_in_threadpool(enrich_graph_with_hazards, G, db_hazards)

    # Строим 3 варианта маршрута. Каждый — в отдельном вызове threadpool,
    # чтобы длинный A* по большому графу не блокировал event loop.
    variants: List[RouteVariant] = []
    for rtype in (RouteType.safe, RouteType.accessible, RouteType.fast):
        variant = await run_in_threadpool(
            _build_variant_sync, G, request, rtype, season, avoid_crowds, avoid_dark
        )
        if variant is not None:
            variants.append(variant)

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
