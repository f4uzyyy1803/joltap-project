# JolTap Backend

Бэкенд для приложения навигации для людей на колясках.

## Структура проекта

```
joltap/
├── main.py                    ← версия 1 (mock-данные, для теста)
├── main_real.py               ← версия 2 (реальный OSM + PostgreSQL)
│
├── models/
│   └── models.py              ← Pydantic модели (запросы/ответы)
│
├── services/
│   ├── routing.py             ← v1: A* на mock-графе
│   ├── routing_real.py        ← v2: A* на реальном OSM графе
│   ├── graph.py               ← osmnx: загрузка/кэш/обогащение графа
│   ├── hazards_sos.py         ← v1: in-memory хранилище
│   └── hazards_db.py          ← v2: реальный PostgreSQL + PostGIS
│
├── routers/
│   ├── routers.py             ← v1 роутеры (mock)
│   └── routers_real.py        ← v2 роутеры (с Depends(get_db))
│
├── database/
│   └── db.py                  ← SQLAlchemy подключение + таблицы
│
├── migrations/
│   └── 001_init.sql           ← SQL миграция (PostGIS + таблицы)
│
├── cache/                     ← граф Алматы кэшируется сюда
├── test_all.py                ← тесты v1 (без сервера)
└── .env.example               ← шаблон переменных окружения
```

---

## Быстрый старт (v1 — без БД)

```bash
pip install fastapi uvicorn osmnx networkx shapely

# Тест без сервера
python test_all.py

# Запуск сервера
uvicorn main:app --reload --port 8000
```

---

## Production запуск (v2 — PostgreSQL + OSM)

### 1. Установка PostgreSQL + PostGIS

```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib postgis

# macOS
brew install postgresql postgis
```

### 2. Создание базы данных

```sql
CREATE DATABASE joltap_db;
\c joltap_db
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 3. Запуск SQL миграции

```bash
psql -U postgres -d joltap_db -f migrations/001_init.sql
```

### 4. Настройка окружения

```bash
cp .env.example .env
# Отредактируй .env — заполни DATABASE_URL и остальные ключи
```

### 5. Установка зависимостей

```bash
pip install fastapi uvicorn osmnx networkx shapely \
            sqlalchemy[asyncio] asyncpg geoalchemy2 \
            psycopg2-binary python-dotenv twilio
```

### 6. Запуск

```bash
uvicorn main_real:app --reload --port 8000
```

Документация API: http://localhost:8000/docs

---

## API Эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/route/build` | Построить маршрут (3 варианта) |
| GET  | `/map/hazards` | Опасные зоны рядом с точкой |
| POST | `/map/report` | Сообщить о препятствии |
| POST | `/sos/activate` | SOS кнопка |
| POST | `/user/profile` | Сохранить профиль |
| GET  | `/user/profile/{id}` | Получить профиль |

---

## Пример запроса маршрута

```bash
curl -X POST http://localhost:8000/route/build \
  -H "Content-Type: application/json" \
  -d '{
    "start_lat": 43.238949,
    "start_lon": 76.889709,
    "end_lat": 43.244000,
    "end_lon": 76.895000,
    "route_type": "safe",
    "user_id": "user_001"
  }'
```

---

## Следующие шаги

- [ ] Подключить Firebase FCM для push-уведомлений
- [ ] Добавить Twilio для SOS SMS
- [ ] Настроить Celery для фоновой модерации краудсорсинга
- [ ] Добавить Redis кэш для маршрутов
- [ ] Написать Docker Compose для деплоя
