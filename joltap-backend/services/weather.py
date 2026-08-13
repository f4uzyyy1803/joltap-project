"""
services/weather.py
────────────────────
Погода через OpenWeatherMap.

ВАЖНО: OPENWEATHER_API_KEY читается только здесь, на бэкенде,
из переменных окружения (.env). Ключ никогда не уходит в мобильное
приложение — фронтенд обращается к нашему собственному /weather,
а не напрямую к OpenWeatherMap.
"""

import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"

# Простой in-memory кэш, чтобы не дёргать API на каждый чих
# (бесплатный тариф OpenWeatherMap ограничен по запросам в минуту)
_cache = {}
_CACHE_TTL_SECONDS = 600  # 10 минут


def _cache_key(lat: float, lon: float) -> str:
    # округляем, чтобы близкие точки попадали в один и тот же кэш
    return f"{round(lat, 2)}:{round(lon, 2)}"


def get_weather(lat: float, lon: float) -> dict:
    """
    Возвращает погоду для координат + флаг риска гололёда
    (актуально для приложения, ориентированного на доступность среды).
    """
    if not OPENWEATHER_API_KEY:
        raise RuntimeError(
            "OPENWEATHER_API_KEY не задан. Скопируй .env.example в .env "
            "и вставь свой ключ с https://openweathermap.org/api"
        )

    key = _cache_key(lat, lon)
    cached = _cache.get(key)
    if cached and (time.time() - cached["ts"]) < _CACHE_TTL_SECONDS:
        return cached["data"]

    response = requests.get(
        OPENWEATHER_URL,
        params={
            "lat": lat,
            "lon": lon,
            "appid": OPENWEATHER_API_KEY,
            "units": "metric",
            "lang": "ru",
        },
        timeout=8,
    )
    response.raise_for_status()
    raw = response.json()

    temp = raw["main"]["temp"]
    feels_like = raw["main"]["feels_like"]
    weather_main = raw["weather"][0]["main"]  # Rain, Snow, Clear, Clouds...
    description = raw["weather"][0]["description"]
    icon_code = raw["weather"][0]["icon"]
    humidity = raw["main"]["humidity"]
    # В штиль OpenWeatherMap иногда не присылает блок "wind" вообще —
    # раньше это падало с KeyError
    wind_speed = raw.get("wind", {}).get("speed", 0)
    city = raw.get("name", "")

    # Эвристика риска гололёда: температура около нуля + осадки
    ice_risk = -3 <= temp <= 3 and weather_main in ("Rain", "Snow", "Drizzle")

    data = {
        "city": city,
        "temp": round(temp),
        "feels_like": round(feels_like),
        "description": description,
        "icon_code": icon_code,
        "emoji": _icon_to_emoji(icon_code),
        "humidity": humidity,
        "wind_speed": wind_speed,
        "ice_risk": ice_risk,
    }

    _cache[key] = {"data": data, "ts": time.time()}
    return data


def _icon_to_emoji(icon_code: str) -> str:
    mapping = {
        "01": "☀️", "02": "🌤️", "03": "☁️", "04": "☁️",
        "09": "🌧️", "10": "🌦️", "11": "⛈️", "13": "❄️", "50": "🌫️",
    }
    return mapping.get(icon_code[:2], "⛅")
