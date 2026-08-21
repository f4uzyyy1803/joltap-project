"""
routers/routers_real.py
────────────────────────
FastAPI роутеры с реальным PostgreSQL.
"""

import os
import traceback
from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from typing import List, Optional

from database.db import get_db
from models.models import (
    RouteRequest, RouteResponse,
    HazardReport, HazardOnMap,
    SOSRequest, SOSResponse,
    UserProfile
)
from services.routing_real import build_routes_real
from services.graph import UnsupportedLocationError
from services.hazards_db import (
    get_hazards_near_db, report_hazard_db,
    save_sos_log, save_profile_db, get_profile_db
)
from services.osm_hazards import get_real_hazards
from services.weather import get_weather


# ─── Маршруты ────────────────────────────────────────────

route_router = APIRouter(prefix="/route", tags=["Маршруты"])

@route_router.post("/build", response_model=RouteResponse)
async def build_route(
    request: RouteRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Построить маршрут с учётом реальных данных OSM и препятствий из БД.
    """
    try:
        return await build_routes_real(request, db)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Ошибка маршрутизации: {e}")


# ─── Карта доступности ───────────────────────────────────

map_router = APIRouter(prefix="/map", tags=["Карта"])

@map_router.get("/hazards", response_model=List[HazardOnMap])
async def get_hazards(
    lat: float = Query(...),
    lon: float = Query(...),
    radius_km: float = Query(1.0),
    db: AsyncSession = Depends(get_db)
):
    """
    Опасные зоны в радиусе radius_km от точки.

    Раньше отдавала только то, что руками засеяно/подтверждено в БД —
    в новом городе (например, у пользователя не в Алматы) там пусто,
    и на карте ничего не показывалось. Теперь дополнительно тянем
    реальные объекты из OpenStreetMap (бордюры, неровное покрытие,
    неосвещённые участки, лестницы, барьеры) вокруг точки — это работает
    для любых координат в мире, а не только там, где кто-то уже что-то
    засеял или отправил репорт.
    """
    db_hazards = await get_hazards_near_db(db, lat, lon, radius_m=radius_km * 1000)

    # get_real_hazards синхронный (requests) — уводим в threadpool, чтобы не
    # блокировать event loop; сигнатура принимает "маршрут" (старт+конец),
    # для точки+радиуса просто передаём одну и ту же точку с паддингом
    # в градусах, переведённым из radius_km (~111 км на градус широты).
    padding_deg = radius_km / 111
    osm_raw = await run_in_threadpool(
        get_real_hazards, lat, lon, lat, lon, padding_deg
    )

    osm_hazards = [
        HazardOnMap(
            id=-(i + 1),  # отрицательные id — чтобы не пересекаться с id из БД
            lat=h["lat"],
            lon=h["lon"],
            hazard_type=h["hazard_type"],
            severity=h["severity"],
            description=h["message_ru"],
            confirmed_count=0,  # не краудсорс, а сырые данные OSM — не подтверждено людьми
            color={1: "yellow", 2: "orange", 3: "red"}.get(h["severity"], "yellow"),
        )
        for i, h in enumerate(osm_raw)
    ]

    return db_hazards + osm_hazards


@map_router.post("/report")
async def report_hazard(
    report: HazardReport,
    db: AsyncSession = Depends(get_db)
):
    """Краудсорсинг: добавить препятствие или подтвердить существующее"""
    return await report_hazard_db(db, report)


# ─── SOS ─────────────────────────────────────────────────

sos_router = APIRouter(prefix="/sos", tags=["SOS"])

@sos_router.post("/activate", response_model=SOSResponse)
async def activate_sos(
    request: SOSRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    SOS: уведомить контакты + вызвать помощь + сохранить геолокацию.
    """
    location_url = f"https://maps.google.com/?q={request.lat},{request.lon}"
    notified = 0

    # Реальная отправка SMS через Twilio
    twilio_sid   = os.getenv("TWILIO_SID")
    twilio_token = os.getenv("TWILIO_TOKEN")
    twilio_phone = os.getenv("TWILIO_PHONE")

    if twilio_sid and twilio_token:
        try:
            from twilio.rest import Client
            client = Client(twilio_sid, twilio_token)
            for contact in request.contacts:
                client.messages.create(
                    to=contact,
                    from_=twilio_phone,
                    body=f"🆘 {request.message}\nМестоположение: {location_url}"
                )
                notified += 1
        except Exception as e:
            print(f"[SOS] Ошибка Twilio: {e}")
    else:
        # Режим разработки — просто логируем
        for contact in request.contacts:
            print(f"[SOS DEV] SMS → {contact}: {location_url}")
            notified += 1

    # Сохраняем лог в БД
    await save_sos_log(db, request, notified)

    return SOSResponse(
        status="activated",
        location_url=location_url,
        notified_contacts=notified,
        emergency_called=True
    )


# ─── Профиль пользователя ────────────────────────────────

user_router = APIRouter(prefix="/user", tags=["Пользователь"])

@user_router.post("/profile")
async def save_profile(
    profile: UserProfile,
    db: AsyncSession = Depends(get_db)
):
    return await save_profile_db(db, profile)


@user_router.get("/profile/{user_id}", response_model=UserProfile)
async def get_profile(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    profile = await get_profile_db(db, user_id)
    if not profile:
        raise HTTPException(404, "Профиль не найден")
    return profile


# ─── Погода ───────────────────────────────────────────────

weather_router = APIRouter(prefix="/weather", tags=["Погода"])

@weather_router.get("", summary="Текущая погода")
async def get_current_weather(
    lat: float = Query(..., description="Широта"),
    lon: float = Query(..., description="Долгота"),
):
    """Ключ OpenWeatherMap хранится только на бэкенде (.env)."""
    try:
        return get_weather(lat, lon)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка получения погоды: {str(e)}")
