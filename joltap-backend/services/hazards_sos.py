import random
from datetime import datetime
from typing import List, Optional
from models.models import (
    HazardReport, HazardOnMap, HazardType,
    SOSRequest, SOSResponse,
    UserProfile
)


# ─── In-memory хранилище (в реальности — PostgreSQL + PostGIS) ───

HAZARDS_DB: List[dict] = [
    # Тестовые данные — опасные точки Алматы
    {"id": 1, "lat": 43.238949, "lon": 76.889709, "hazard_type": "curb",
     "severity": 3, "description": "Высокий бордюр без съезда", "confirmed_count": 5},
    {"id": 2, "lat": 43.239500, "lon": 76.890200, "hazard_type": "pothole",
     "severity": 2, "description": "Яма после зимы", "confirmed_count": 3},
    {"id": 3, "lat": 43.240100, "lon": 76.891000, "hazard_type": "poor_lighting",
     "severity": 1, "description": "Фонарь не работает", "confirmed_count": 2},
    {"id": 4, "lat": 43.237800, "lon": 76.888500, "hazard_type": "no_ramp",
     "severity": 3, "description": "Вход в здание без пандуса", "confirmed_count": 7},
    {"id": 5, "lat": 43.241000, "lon": 76.892500, "hazard_type": "construction",
     "severity": 2, "description": "Дорожные работы, проход закрыт", "confirmed_count": 4},
]

USERS_DB: dict = {}
next_hazard_id = 6


# ─── Сервис опасных зон ──────────────────────────────────

def get_color_by_severity(severity: int) -> str:
    return {1: "yellow", 2: "orange", 3: "red"}.get(severity, "yellow")


def get_hazards_near(lat: float, lon: float, radius_km: float = 1.0) -> List[HazardOnMap]:
    """
    Возвращает все опасные зоны в радиусе radius_km от точки.
    В реальности:
        SELECT * FROM hazards
        WHERE ST_DWithin(location, ST_MakePoint(%s, %s)::geography, %s)
    """
    import math
    result = []

    for h in HAZARDS_DB:
        # Простое расстояние (в реальности — PostGIS ST_DWithin)
        dlat = (h["lat"] - lat) * 111000
        dlon = (h["lon"] - lon) * 111000 * math.cos(math.radians(lat))
        dist_m = math.sqrt(dlat**2 + dlon**2)

        if dist_m <= radius_km * 1000:
            result.append(HazardOnMap(
                id=h["id"],
                lat=h["lat"],
                lon=h["lon"],
                hazard_type=h["hazard_type"],
                severity=h["severity"],
                description=h.get("description"),
                confirmed_count=h["confirmed_count"],
                color=get_color_by_severity(h["severity"])
            ))

    return result


def report_hazard(report: HazardReport) -> dict:
    """
    Пользователь сообщает о препятствии — краудсорсинг.
    В реальности: INSERT INTO hazards ... с модерацией через ИИ.
    """
    global next_hazard_id

    # Проверяем: нет ли уже похожего рядом (дедупликация)
    existing = _find_duplicate(report.lat, report.lon, report.hazard_type)
    if existing:
        # Просто увеличиваем счётчик подтверждений
        existing["confirmed_count"] += 1
        return {
            "status": "confirmed",
            "message": "Препятствие уже отмечено. Ваше подтверждение учтено.",
            "hazard_id": existing["id"],
            "confirmed_count": existing["confirmed_count"]
        }

    # Добавляем новое
    new_hazard = {
        "id": next_hazard_id,
        "lat": report.lat,
        "lon": report.lon,
        "hazard_type": report.hazard_type,
        "severity": report.severity,
        "description": report.description,
        "reported_by": report.reported_by,
        "confirmed_count": 1,
        "created_at": datetime.now().isoformat(),
        "status": "pending_moderation"  # ИИ проверяет фото
    }
    HAZARDS_DB.append(new_hazard)
    next_hazard_id += 1

    return {
        "status": "added",
        "message": "Препятствие добавлено. Спасибо! Проходит модерацию.",
        "hazard_id": new_hazard["id"]
    }


def _find_duplicate(lat: float, lon: float, hazard_type: str, threshold_m: float = 30) -> Optional[dict]:
    """Ищем дубликат в радиусе 30 метров"""
    import math
    for h in HAZARDS_DB:
        if h["hazard_type"] != hazard_type:
            continue
        dlat = (h["lat"] - lat) * 111000
        dlon = (h["lon"] - lon) * 111000 * math.cos(math.radians(lat))
        if math.sqrt(dlat**2 + dlon**2) < threshold_m:
            return h
    return None


# ─── SOS сервис ──────────────────────────────────────────

def trigger_sos(request: SOSRequest) -> SOSResponse:
    """
    SOS кнопка:
    1. Сохраняем геолокацию
    2. Отправляем уведомление близким (в реальности — Twilio SMS)
    3. Вызываем экстренные службы (в реальности — интеграция с 112)
    """

    # Google Maps ссылка на геолокацию
    location_url = f"https://maps.google.com/?q={request.lat},{request.lon}"

    # Симуляция отправки SMS близким
    notified = 0
    for contact in request.contacts:
        # В реальности: twilio_client.messages.create(to=contact, body=...)
        print(f"[SOS] SMS отправлен на {contact}: {request.message} | {location_url}")
        notified += 1

    # Симуляция вызова экстренных служб
    print(f"[SOS] Экстренный вызов: пользователь {request.user_id} на {request.lat}, {request.lon}")

    # Логируем в БД
    sos_log = {
        "user_id": request.user_id,
        "lat": request.lat,
        "lon": request.lon,
        "timestamp": datetime.now().isoformat(),
        "contacts_notified": notified
    }
    print(f"[SOS LOG] {sos_log}")

    return SOSResponse(
        status="activated",
        location_url=location_url,
        notified_contacts=notified,
        emergency_called=True
    )


# ─── Профиль пользователя ────────────────────────────────

def save_user_profile(profile: UserProfile) -> dict:
    USERS_DB[profile.user_id] = profile.dict()
    return {"status": "saved", "user_id": profile.user_id}


def get_user_profile(user_id: str) -> Optional[UserProfile]:
    data = USERS_DB.get(user_id)
    if data:
        return UserProfile(**data)
    return None
