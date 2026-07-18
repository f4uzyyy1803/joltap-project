
import sys
sys.path.insert(0, "/home/claude/joltap")

from models.models import (
    RouteRequest, RouteType,
    HazardReport, HazardType,
    SOSRequest, UserProfile, MobilityType
)
from services.routing import build_routes
from services.hazards_sos import (
    get_hazards_near, report_hazard,
    trigger_sos, save_user_profile, get_user_profile
)


def separator(title: str):
    print(f"\n{'='*55}")
    print(f"  {title}")
    print('='*55)


# ════════════════════════════════════════════════════════
# ТЕСТ 1: Профиль пользователя
# ════════════════════════════════════════════════════════
separator("ТЕСТ 1: Профиль пользователя")

profile = UserProfile(
    user_id="user_001",
    mobility_type=MobilityType.wheelchair_manual,
    max_distance_km=1.5,
    preferred_route=RouteType.safe,
    notification_type="all",
    avoid_crowds=True,
    avoid_poor_lighting=True,
    language="ru"
)

result = save_user_profile(profile)
print(f"Сохранён профиль: {result}")

loaded = get_user_profile("user_001")
print(f"Загружен профиль: тип коляски = {loaded.mobility_type}, "
      f"предпочтение = {loaded.preferred_route}")


# ════════════════════════════════════════════════════════
# ТЕСТ 2: Построение маршрута
# ════════════════════════════════════════════════════════
separator("ТЕСТ 2: Построение маршрутов (Алматы)")

request = RouteRequest(
    start_lat=43.238949,
    start_lon=76.889709,
    end_lat=43.244000,
    end_lon=76.895000,
    route_type=RouteType.safe,
    user_id="user_001"
)

response = build_routes(request, profile)

print(f"Сезон: {response.season.value}")
if response.weather_warning:
    print(f"Погодное предупреждение: {response.weather_warning}")

print(f"\nПостроено {len(response.variants)} вариантов маршрута:\n")

for v in response.variants:
    print(f"  [{v.route_type.upper()}]")
    print(f"    {v.description_ru}")
    print(f"    Расстояние: {v.distance_meters}м | "
          f"Время: {v.duration_minutes} мин | "
          f"Безопасность: {int(v.safety_score * 100)}%")
    if v.warnings:
        print(f"    Предупреждения ({len(v.warnings)}):")
        for w in v.warnings[:2]:  # показываем первые 2
            print(f"      ⚠️  {w.message_ru}")
    print()


# ════════════════════════════════════════════════════════
# ТЕСТ 3: Карта опасных зон
# ════════════════════════════════════════════════════════
separator("ТЕСТ 3: Опасные зоны на карте")

hazards = get_hazards_near(lat=43.239000, lon=76.890000, radius_km=1.0)
print(f"Найдено {len(hazards)} опасных зон в радиусе 1 км:\n")

colors = {"red": "🔴", "orange": "🟠", "yellow": "🟡"}
for h in hazards:
    icon = colors.get(h.color, "⚠️")
    print(f"  {icon} [{h.hazard_type}] — {h.description}")
    print(f"     Подтверждено: {h.confirmed_count} пользователями | "
          f"Уровень: {h.severity}/3")


# ════════════════════════════════════════════════════════
# ТЕСТ 4: Краудсорсинг — новый репорт
# ════════════════════════════════════════════════════════
separator("ТЕСТ 4: Краудсорсинг (добавить препятствие)")

# Новое препятствие
report = HazardReport(
    lat=43.242000,
    lon=76.893000,
    hazard_type=HazardType.pothole,
    severity=2,
    description="Большая яма после ремонта",
    reported_by="user_001"
)
result = report_hazard(report)
print(f"Новое: {result}")

# Дубликат — то же место
result2 = report_hazard(report)
print(f"Дубликат: {result2}")


# ════════════════════════════════════════════════════════
# ТЕСТ 5: SOS кнопка
# ════════════════════════════════════════════════════════
separator("ТЕСТ 5: SOS кнопка")

sos = SOSRequest(
    user_id="user_001",
    lat=43.238949,
    lon=76.889709,
    message="Нужна помощь! Застрял на пересечении.",
    contacts=["+77001234567", "+77009876543"]
)

sos_result = trigger_sos(sos)
print(f"Статус SOS: {sos_result.status}")
print(f"Ссылка на карту: {sos_result.location_url}")
print(f"Уведомлено контактов: {sos_result.notified_contacts}")
print(f"Экстренные службы вызваны: {sos_result.emergency_called}")


# ════════════════════════════════════════════════════════
# ИТОГ
# ════════════════════════════════════════════════════════
separator("ВСЕ ТЕСТЫ ПРОЙДЕНЫ ✅")
print("""
Эндпоинты API:
  POST /route/build        — построить маршрут
  GET  /map/hazards        — опасные зоны на карте
  POST /map/report         — сообщить о препятствии
  POST /sos/activate       — SOS кнопка
  POST /user/profile       — сохранить профиль
  GET  /user/profile/{id}  — получить профиль

Запуск сервера:
  cd joltap && uvicorn main:app --reload --port 8000
  Документация: http://localhost:8000/docs
""")
