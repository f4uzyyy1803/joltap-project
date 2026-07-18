"""
database/db.py
──────────────
Подключение к PostgreSQL + PostGIS.
Таблицы:
  - hazards       — опасные зоны (краудсорсинг)
  - user_profiles — профили пользователей
  - sos_logs      — логи SOS вызовов
  - graph_cache   — кэш графа дорог Алматы
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import (
    Column, Integer, Float, String, Text,
    DateTime, Boolean, func
)
from geoalchemy2 import Geometry
from dotenv import load_dotenv

load_dotenv()

# ─── Подключение ─────────────────────────────────────────

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:password@localhost:5432/joltap_db"
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,          # True — показывает SQL запросы в консоли
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)


# ─── Базовый класс моделей ────────────────────────────────

class Base(DeclarativeBase):
    pass


# ─── Таблица: Опасные зоны ───────────────────────────────

class HazardDB(Base):
    __tablename__ = "hazards"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    hazard_type     = Column(String(50), nullable=False)
    severity        = Column(Integer, default=1)           # 1-3
    description     = Column(Text, nullable=True)
    reported_by     = Column(String(100), nullable=True)
    photo_url       = Column(String(500), nullable=True)
    confirmed_count = Column(Integer, default=1)
    status          = Column(String(20), default="active") # active / pending / removed
    is_seasonal     = Column(Boolean, default=False)       # зимний гололёд и т.д.
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # PostGIS геометрия — точка (lon, lat)
    # Хранится как POINT в системе WGS84 (SRID=4326)
    location = Column(
        Geometry(geometry_type="POINT", srid=4326),
        nullable=False
    )


# ─── Таблица: Профили пользователей ─────────────────────

class UserProfileDB(Base):
    __tablename__ = "user_profiles"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    user_id              = Column(String(100), unique=True, nullable=False, index=True)
    mobility_type        = Column(String(50), nullable=False)
    max_distance_km      = Column(Float, default=2.0)
    preferred_route      = Column(String(20), default="safe")
    notification_type    = Column(String(20), default="all")
    avoid_crowds         = Column(Boolean, default=True)
    avoid_poor_lighting  = Column(Boolean, default=True)
    language             = Column(String(5), default="ru")
    created_at           = Column(DateTime, server_default=func.now())
    updated_at           = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─── Таблица: Логи SOS ───────────────────────────────────

class SOSLogDB(Base):
    __tablename__ = "sos_logs"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    user_id            = Column(String(100), nullable=False, index=True)
    message            = Column(Text, nullable=True)
    contacts_notified  = Column(Integer, default=0)
    emergency_called   = Column(Boolean, default=True)
    created_at         = Column(DateTime, server_default=func.now())

    # PostGIS точка где была нажата SOS
    location = Column(
        Geometry(geometry_type="POINT", srid=4326),
        nullable=False
    )


# ─── Dependency для FastAPI ───────────────────────────────

async def get_db():
    """
    FastAPI dependency — открывает сессию на время запроса.

    Использование в роутере:
        from database.db import get_db
        from sqlalchemy.ext.asyncio import AsyncSession

        @router.post("/something")
        async def handler(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ─── Создание таблиц (используется при первом запуске) ───

async def create_tables():
    """
    Создать все таблицы в БД.
    Вызывается один раз при старте приложения.

    В production используй Alembic миграции (см. migrations/).
    """
    async with engine.begin() as conn:
        # Сначала убедись что PostGIS включён:
        # CREATE EXTENSION IF NOT EXISTS postgis;
        await conn.run_sync(Base.metadata.create_all)
    print("[DB] Таблицы созданы")
