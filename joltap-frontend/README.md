# JolTap — Мобильное приложение

React Native + Expo приложение, подключённое к FastAPI бэкенду.

## Структура

```
JolTapApp/
├── App.js                          ← точка входа
├── app.json                        ← конфиг Expo
├── package.json                    ← зависимости
└── src/
    ├── navigation/AppNavigator.js  ← навигация
    ├── screens/
    │   ├── AuthScreens.js          ← Сплэш, Вход, Регистрация, OTP
    │   ├── HomeScreen.js           ← Главный экран
    │   ├── MapScreen.js            ← Карта с маршрутами
    │   └── ProfileScreen.js        ← Профиль пользователя
    ├── components/
    │   └── SOSButton.js            ← SOS кнопка (везде)
    ├── services/
    │   └── api.js                  ← Запросы к FastAPI
    └── theme.js                    ← Цвета и стили
```

## Быстрый старт

### 1. Установи Node.js
Скачай с https://nodejs.org (версия 18+)

### 2. Установи Expo CLI
```bash
npm install -g expo-cli
```

### 3. Установи зависимости
```bash
cd JolTapApp
npm install
```

### 4. Запусти бэкенд
```bash
cd joltap-backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# --host 0.0.0.0 важно! Иначе телефон не подключится
```

Адрес бэкенда (`BASE_URL` в `src/services/api.js`) вписывать вручную **не нужно** —
приложение само определяет IP компьютера через Expo (см. `EXPO_PUBLIC_API_URL`
в `.env.example`, если бэкенд всё же на другой машине).

### 5. Запусти приложение
```bash
cd JolTapApp
npx expo start
```

Откроется QR-код. Скачай на телефон приложение **Expo Go**:
- iOS: App Store → "Expo Go"
- Android: Google Play → "Expo Go"

Наведи камеру на QR-код → приложение запустится на телефоне!

## Функциональность

| Экран | Что работает |
|---|---|
| Сплэш | Анимация, автопереход |
| Вход / Регистрация | Формы, сохранение в AsyncStorage |
| OTP | Ввод кода подтверждения |
| Главный | Погода, статьи, Premium |
| Карта | Реальная карта, маркеры опасностей из бэкенда |
| Маршрут | Строится через FastAPI, отображается на карте |
| SOS | Геолокация + запрос к бэкенду |
| Профиль | Сохранение в FastAPI, настройки маршрута |

## Для публикации в App Store / Google Play
```bash
npx expo build:ios
npx expo build:android
```
Или используй EAS Build (новый способ):
```bash
npm install -g eas-cli
eas build
```
