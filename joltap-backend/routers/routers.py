from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional

from models.models import (
    RouteRequest, RouteResponse,
    HazardReport, HazardOnMap,
    SOSRequest, SOSResponse,
    UserProfile
)
from services.routing import build_routes
from services.hazards_sos import (
    get_hazards_near, report_hazard,
    trigger_sos, save_user_profile, get_user_profile
)


# ─── Роутер: Маршруты ────────────────────────────────────

route_router = APIRouter(prefix="/route", tags=["Маршруты"])

@route_router.post("/build", response_model=RouteResponse)
async def build_route(request: RouteRequest):
    """
    Построить маршрут из точки А в точку Б.

    Возвращает 3 варианта: безопасный, доступный, быстрый.
    Каждый вариант содержит:
    - координаты маршрута
    - расстояние и время
    - оценку безопасности
    - список предупреждений
    """
    user_profile = None
    if request.user_id:
        user_profile = get_user_profile(request.user_id)

    try:
        result = build_routes(request, user_profile)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка построения маршрута: {str(e)}")


# ─── Роутер: Карта доступности ───────────────────────────

map_router = APIRouter(prefix="/map", tags=["Карта доступности"])

@map_router.get("/hazards", response_model=List[HazardOnMap])
async def get_map_hazards(
    lat: float = Query(..., description="Широта центра"),
    lon: float = Query(..., description="Долгота центра"),
    radius_km: float = Query(1.0, description="Радиус поиска в км")
):
    """
    Получить все опасные зоны на карте рядом с пользователем.
    Цвета: красный = опасно, оранжевый = осторожно, жёлтый = внимание.
    """
    hazards = get_hazards_near(lat, lon, radius_km)
    return hazards


@map_router.post("/report", summary="Сообщить о препятствии")
async def report_new_hazard(report: HazardReport):
    """
    Краудсорсинг: пользователь сообщает о новом препятствии.
    Данные проходят модерацию перед публикацией на карте.
    """
    result = report_hazard(report)
    return result


# ─── Роутер: SOS ─────────────────────────────────────────

sos_router = APIRouter(prefix="/sos", tags=["SOS"])

@sos_router.post("/activate", response_model=SOSResponse)
async def activate_sos(request: SOSRequest):
    """
    Экстренная кнопка SOS.
    - Отправляет геолокацию близким
    - Вызывает экстренные службы
    - Сохраняет лог с координатами
    """
    if not request.user_id:
        raise HTTPException(status_code=400, detail="user_id обязателен для SOS")

    result = trigger_sos(request)
    return result


# ─── Роутер: Профиль пользователя ────────────────────────

user_router = APIRouter(prefix="/user", tags=["Пользователь"])

@user_router.post("/profile", summary="Сохранить профиль")
async def create_or_update_profile(profile: UserProfile):
    """
    Создать или обновить профиль пользователя.
    Профиль влияет на построение маршрутов (тип коляски, предпочтения).
    """
    result = save_user_profile(profile)
    return result

@user_router.get("/profile/{user_id}", response_model=UserProfile)
async def get_profile(user_id: str):
    """Получить профиль пользователя по ID"""
    profile = get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Профиль не найден")
    return profile
