-- ═══════════════════════════════════════════════════
-- JolTap — SQL миграция
-- Запускать ОДИН раз после создания базы данных
-- ═══════════════════════════════════════════════════

-- Шаг 1: Включить PostGIS расширение
CREATE EXTENSION IF NOT EXISTS postgis;

-- ═══════════════════════════════════════════════════
-- Таблица: hazards (опасные зоны)
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hazards (
    id              SERIAL PRIMARY KEY,
    hazard_type     VARCHAR(50) NOT NULL,
    severity        INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 3),
    description     TEXT,
    reported_by     VARCHAR(100),
    photo_url       VARCHAR(500),
    confirmed_count INTEGER DEFAULT 1,
    status          VARCHAR(20) DEFAULT 'active',  -- active / pending / removed
    is_seasonal     BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),

    -- PostGIS точка: POINT(lon lat) в системе WGS84
    location        GEOGRAPHY(POINT, 4326) NOT NULL
);

-- Пространственный индекс — ускоряет ST_DWithin запросы
CREATE INDEX IF NOT EXISTS idx_hazards_location
    ON hazards USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_hazards_type
    ON hazards (hazard_type);

CREATE INDEX IF NOT EXISTS idx_hazards_status
    ON hazards (status);


-- ═══════════════════════════════════════════════════
-- Таблица: user_profiles
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_profiles (
    id                   SERIAL PRIMARY KEY,
    user_id              VARCHAR(100) UNIQUE NOT NULL,
    mobility_type        VARCHAR(50) NOT NULL,
    max_distance_km      FLOAT DEFAULT 2.0,
    preferred_route      VARCHAR(20) DEFAULT 'safe',
    notification_type    VARCHAR(20) DEFAULT 'all',
    avoid_crowds         BOOLEAN DEFAULT TRUE,
    avoid_poor_lighting  BOOLEAN DEFAULT TRUE,
    language             VARCHAR(5) DEFAULT 'ru',
    created_at           TIMESTAMP DEFAULT NOW(),
    updated_at           TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_user_id ON user_profiles (user_id);


-- ═══════════════════════════════════════════════════
-- Таблица: sos_logs
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sos_logs (
    id                 SERIAL PRIMARY KEY,
    user_id            VARCHAR(100) NOT NULL,
    message            TEXT,
    contacts_notified  INTEGER DEFAULT 0,
    emergency_called   BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMP DEFAULT NOW(),

    location           GEOGRAPHY(POINT, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_sos_location ON sos_logs USING GIST (location);


-- ═══════════════════════════════════════════════════
-- Тестовые данные — опасные зоны Алматы
-- ═══════════════════════════════════════════════════
INSERT INTO hazards (hazard_type, severity, description, confirmed_count, location) VALUES
    ('curb',          3, 'Высокий бордюр без съезда',        5,  ST_MakePoint(76.889709, 43.238949)),
    ('pothole',       2, 'Яма после зимы',                   3,  ST_MakePoint(76.890200, 43.239500)),
    ('poor_lighting', 1, 'Фонарь не работает',               2,  ST_MakePoint(76.891000, 43.240100)),
    ('no_ramp',       3, 'Вход в здание без пандуса',        7,  ST_MakePoint(76.888500, 43.237800)),
    ('construction',  2, 'Дорожные работы, проход закрыт',   4,  ST_MakePoint(76.892500, 43.241000)),
    ('ice',           3, 'Гололёд у перехода (зима)',        6,  ST_MakePoint(76.890800, 43.239200)),
    ('curb',          2, 'Сломанный пандус',                 3,  ST_MakePoint(76.887300, 43.238100))
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════
-- Полезные запросы для проверки
-- ═══════════════════════════════════════════════════

-- Найти все опасности в 500м от точки:
-- SELECT *, ST_Distance(location, ST_MakePoint(76.889709, 43.238949)::geography) as dist
-- FROM hazards
-- WHERE ST_DWithin(location, ST_MakePoint(76.889709, 43.238949)::geography, 500)
-- ORDER BY dist;

-- Статистика по типам:
-- SELECT hazard_type, COUNT(*), AVG(severity) FROM hazards GROUP BY hazard_type;
