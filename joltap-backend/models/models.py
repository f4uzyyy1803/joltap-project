from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


# ─── Enums ───────────────────────────────────────────────

class RouteType(str, Enum):
    safe = "safe"
    accessible = "accessible"
    fast = "fast"

class HazardType(str, Enum):
    curb = "curb"            # бордюр
    pothole = "pothole"     # яма
    ice = "ice"              # лёд
    snow = "snow"            # снег
    no_ramp = "no_ramp"      # нет пандуса
    poor_lighting = "poor_lighting"  # плохое освещение
    construction = "construction"    # дорожные работы
    puddle = "puddle"        # лужа

class Season(str, Enum):
    winter = "winter"
    spring = "spring"
    summer = "summer"
    autumn = "autumn"

class MobilityType(str, Enum):
    wheelchair_manual = "wheelchair_manual"
    wheelchair_electric = "wheelchair_electric"
    elderly = "elderly"
    caregiver = "caregiver"


# ─── Запрос маршрута ─────────────────────────────────────

class RouteRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    route_type: RouteType = RouteType.safe
    user_id: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "start_lat": 43.238949,
                "start_lon": 76.889709,
                "end_lat": 43.241000,
                "end_lon": 76.892000,
                "route_type": "safe",
                "user_id": "user_001"
            }
        }


# ─── Ответ маршрута ──────────────────────────────────────

class RouteWarning(BaseModel):
    distance_meters: float
    type: HazardType
    message_ru: str
    message_kz: str
    message_en: str

class RouteVariant(BaseModel):
    route_type: RouteType
    coordinates: List[List[float]]   # [[lat, lon], ...]
    distance_meters: float
    duration_minutes: float
    safety_score: float              # 0.0 - 1.0
    warnings: List[RouteWarning]
    description_ru: str

class RouteResponse(BaseModel):
    variants: List[RouteVariant]
    season: Season
    weather_warning: Optional[str] = None


# ─── Опасные зоны ────────────────────────────────────────

class HazardReport(BaseModel):
    lat: float
    lon: float
    hazard_type: HazardType
    severity: int               # 1-3 (лёгкий, средний, опасный)
    description: Optional[str] = None
    reported_by: Optional[str] = None
    photo_url: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "lat": 43.238949,
                "lon": 76.889709,
                "hazard_type": "curb",
                "severity": 2,
                "description": "Высокий бордюр без съезда",
                "reported_by": "user_001"
            }
        }

class HazardOnMap(BaseModel):
    id: int
    lat: float
    lon: float
    hazard_type: HazardType
    severity: int
    description: Optional[str]
    confirmed_count: int         # сколько пользователей подтвердили
    color: str                   # red / orange / yellow


# ─── SOS ────────────────────────────────────────────────

class SOSRequest(BaseModel):
    user_id: str
    lat: float
    lon: float
    message: Optional[str] = "Нужна помощь!"
    contacts: Optional[List[str]] = []    # телефоны близких

    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_001",
                "lat": 43.238949,
                "lon": 76.889709,
                "message": "Нужна помощь!",
                "contacts": ["+77001234567"]
            }
        }

class SOSResponse(BaseModel):
    status: str
    location_url: str
    notified_contacts: int
    emergency_called: bool


# ─── Профиль пользователя ───────────────────────────────

class UserProfile(BaseModel):
    user_id: str
    mobility_type: MobilityType
    max_distance_km: float = 2.0
    preferred_route: RouteType = RouteType.safe
    notification_type: str = "all"    # voice / vibration / visual / all
    avoid_crowds: bool = True
    avoid_poor_lighting: bool = True
    language: str = "ru"              # ru / kz / en

    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_001",
                "mobility_type": "wheelchair_manual",
                "max_distance_km": 1.5,
                "preferred_route": "safe",
                "notification_type": "all",
                "avoid_crowds": True,
                "avoid_poor_lighting": True,
                "language": "ru"
            }
        }
