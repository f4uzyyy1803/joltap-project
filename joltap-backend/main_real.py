"""
main_real.py
─────────────
Production версия с PostgreSQL + реальным OSM графом.
Запуск: uvicorn main_real:app --reload --port 8000
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import create_tables
from routers.routers_real import route_router, map_router, sos_router, user_router, weather_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Запускается при старте и остановке сервера"""
    print("[STARTUP] Создаём таблицы в БД...")
    await create_tables()
    print("[STARTUP] Готово!")
    yield
    print("[SHUTDOWN] Сервер остановлен")


app = FastAPI(
    title="JolTap API (Production)",
    description="""
    Бэкенд JolTap с PostgreSQL + PostGIS + реальными картами OSM.

    ### Подготовка БД:
    ```sql
    CREATE DATABASE joltap_db;
    \\c joltap_db
    CREATE EXTENSION IF NOT EXISTS postgis;
    ```

    ### Запуск:
    ```bash
    cp .env.example .env  # заполни данные
    uvicorn main_real:app --reload --port 8000
    ```
    """,
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(route_router)
app.include_router(map_router)
app.include_router(sos_router)
app.include_router(user_router)
app.include_router(weather_router)


@app.get("/", tags=["Статус"])
async def root():
    return {"app": "JolTap", "version": "2.0.0", "db": "PostgreSQL + PostGIS"}
