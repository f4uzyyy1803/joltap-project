from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.routers import route_router, map_router, sos_router, user_router, weather_router

app = FastAPI(
    title="JolTap API",
    description="""
    ## Бэкенд для приложения JolTap
    
    Навигация для людей на инвалидных колясках и маломобильных граждан.
    
    ### Возможности:
    - 🗺️ **Маршруты** — безопасный, доступный, быстрый
    - ⚠️ **Карта опасностей** — бордюры, ямы, гололёд
    - 📢 **Краудсорсинг** — пользователи добавляют препятствия  
    - 🆘 **SOS** — экстренная кнопка с геолокацией
    - 👤 **Профиль** — персонализация маршрутов
    """,
    version="1.0.0",
)

# CORS для мобильного приложения
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключаем роутеры
app.include_router(route_router)
app.include_router(map_router)
app.include_router(sos_router)
app.include_router(user_router)
app.include_router(weather_router)


@app.get("/", tags=["Статус"])
async def root():
    return {
        "app": "JolTap",
        "status": "running",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health", tags=["Статус"])
async def health():
    return {"status": "ok"}
