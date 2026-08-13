"""
services/hazards_db.py
───────────────────────
Реальные операции с PostgreSQL + PostGIS.
Заменяет in-memory хранилище из hazards_sos.py
"""

from typing import List, Optional
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, update

from database.db import HazardDB, UserProfileDB, SOSLogDB
from models.models import (
    HazardReport, HazardOnMap, HazardType,
    SOSRequest, SOSResponse, UserProfile
)


# ─── Опасные зоны ────────────────────────────────────────

async def get_hazards_near_db(
    db: AsyncSession,
    lat: float,
    lon: float,
    radius_m: float = 1000
) -> List[HazardOnMap]:
    """
    Найти опасные зоны рядом с точкой через PostGIS.

    SQL:
        SELECT *, ST_Distance(location, point) as dist
        FROM hazards
        WHERE ST_DWithin(location::geography, ST_MakePoint(lon, lat)::geography, radius_m)
        AND status = 'active'
        ORDER BY dist
    """
    sql = text("""
        SELECT
            id,
            hazard_type,
            severity,
            description,
            confirmed_count,
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lon,
            ST_Distance(
                location::geography,
                ST_MakePoint(:lon, :lat)::geography
            ) as distance_m
        FROM hazards
        WHERE
            ST_DWithin(
                location::geography,
                ST_MakePoint(:lon, :lat)::geography,
                :radius
            )
            AND status = 'active'
        ORDER BY distance_m
    """)

    result = await db.execute(sql, {"lat": lat, "lon": lon, "radius": radius_m})
    rows = result.fetchall()

    hazards = []
    for row in rows:
        color = {1: "yellow", 2: "orange", 3: "red"}.get(row.severity, "yellow")
        hazards.append(HazardOnMap(
            id=row.id,
            lat=row.lat,
            lon=row.lon,
            hazard_type=row.hazard_type,
            severity=row.severity,
            description=row.description,
            confirmed_count=row.confirmed_count,
            color=color
        ))

    return hazards


async def report_hazard_db(db: AsyncSession, report: HazardReport) -> dict:
    """
    Добавить новое препятствие или подтвердить существующее.
    Дедупликация через PostGIS — ищем в радиусе 30м.
    """

    # Ищем дубликат
    sql_dup = text("""
        SELECT id, confirmed_count
        FROM hazards
        WHERE
            hazard_type = :htype
            AND status = 'active'
            AND ST_DWithin(
                location::geography,
                ST_MakePoint(:lon, :lat)::geography,
                30
            )
        LIMIT 1
    """)

    result = await db.execute(sql_dup, {
        "htype": report.hazard_type.value,
        "lat": report.lat,
        "lon": report.lon
    })
    existing = result.fetchone()

    if existing:
        # Увеличиваем счётчик подтверждений
        sql_update = text("""
            UPDATE hazards
            SET confirmed_count = confirmed_count + 1,
                updated_at = NOW()
            WHERE id = :id
        """)
        await db.execute(sql_update, {"id": existing.id})
        return {
            "status": "confirmed",
            "message": "Препятствие уже отмечено. Ваше подтверждение учтено.",
            "hazard_id": existing.id,
            "confirmed_count": existing.confirmed_count + 1
        }

    # Добавляем новое
    # ST_MakePoint(lon, lat) — порядок именно lon, lat!
    sql_insert = text("""
        INSERT INTO hazards
            (hazard_type, severity, description, reported_by,
             photo_url, confirmed_count, status, location)
        VALUES
            (:htype, :severity, :description, :reported_by,
             :photo_url, 1, 'active',
             ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
        RETURNING id
    """)

    result = await db.execute(sql_insert, {
        "htype":       report.hazard_type.value,
        "severity":    report.severity,
        "description": report.description,
        "reported_by": report.reported_by,
        "photo_url":   report.photo_url,
        "lat":         report.lat,
        "lon":         report.lon,
    })
    new_id = result.scalar()

    return {
        "status": "added",
        "message": "Препятствие добавлено. Спасибо! Проходит модерацию.",
        "hazard_id": new_id
    }


async def get_hazards_for_graph(db: AsyncSession) -> List[dict]:
    """
    Загрузить препятствия для обогащения графа (влияют на маршрут для ВСЕХ
    пользователей) — берём только те, что подтверждены минимум двумя
    репортами (confirmed_count >= 2).

    Раньше единственный (даже случайный или недобросовестный) репорт сразу
    получал status='active' и немедленно начинал влиять на маршруты всех
    пользователей, хотя пользователю в ответ показывалось сообщение
    "проходит модерацию" — по факту никакой модерации не было. Полноценная
    модерация (админ-эндпоинт, ИИ-проверка фото и т.п.) в этот файл не
    входит, поэтому как временная защита от спама/накрутки используется
    порог confirmed_count >= 2. На карту "опасности рядом" (get_hazards_near_db)
    это ограничение не распространяется — там видно всё, включая
    неподтверждённые репорты, с их confirmed_count.
    """
    sql = text("""
        SELECT
            hazard_type,
            severity,
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lon
        FROM hazards
        WHERE status = 'active' AND confirmed_count >= 2
    """)
    result = await db.execute(sql)
    return [
        {"hazard_type": r.hazard_type, "severity": r.severity,
         "lat": r.lat, "lon": r.lon}
        for r in result.fetchall()
    ]


# ─── SOS ────────────────────────────────────────────────

async def save_sos_log(db: AsyncSession, request: SOSRequest, notified: int) -> None:
    """Сохранить лог SOS вызова в БД"""
    sql = text("""
        INSERT INTO sos_logs
            (user_id, message, contacts_notified, emergency_called, location)
        VALUES
            (:user_id, :message, :notified, true,
             ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
    """)
    await db.execute(sql, {
        "user_id":  request.user_id,
        "message":  request.message,
        "notified": notified,
        "lat":      request.lat,
        "lon":      request.lon,
    })


# ─── Профиль пользователя ────────────────────────────────

async def save_profile_db(db: AsyncSession, profile: UserProfile) -> dict:
    """Сохранить или обновить профиль"""
    sql = text("""
        INSERT INTO user_profiles
            (user_id, mobility_type, max_distance_km, preferred_route,
             notification_type, avoid_crowds, avoid_poor_lighting, language)
        VALUES
            (:user_id, :mobility_type, :max_distance_km, :preferred_route,
             :notification_type, :avoid_crowds, :avoid_poor_lighting, :language)
        ON CONFLICT (user_id) DO UPDATE SET
            mobility_type       = EXCLUDED.mobility_type,
            max_distance_km     = EXCLUDED.max_distance_km,
            preferred_route     = EXCLUDED.preferred_route,
            notification_type   = EXCLUDED.notification_type,
            avoid_crowds        = EXCLUDED.avoid_crowds,
            avoid_poor_lighting = EXCLUDED.avoid_poor_lighting,
            language            = EXCLUDED.language,
            updated_at          = NOW()
        RETURNING user_id
    """)
    await db.execute(sql, profile.dict())
    return {"status": "saved", "user_id": profile.user_id}


async def get_profile_db(db: AsyncSession, user_id: str) -> Optional[UserProfile]:
    """Получить профиль пользователя"""
    sql = text("""
        SELECT * FROM user_profiles WHERE user_id = :user_id
    """)
    result = await db.execute(sql, {"user_id": user_id})
    row = result.fetchone()

    if not row:
        return None

    return UserProfile(
        user_id=row.user_id,
        mobility_type=row.mobility_type,
        max_distance_km=row.max_distance_km,
        preferred_route=row.preferred_route,
        notification_type=row.notification_type,
        avoid_crowds=row.avoid_crowds,
        avoid_poor_lighting=row.avoid_poor_lighting,
        language=row.language,
    )
