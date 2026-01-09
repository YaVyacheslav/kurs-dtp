# Курсовой проект: ДТП Москва — типовые сценарии (K-means) + карта

Сервис для **выявления и визуализации типовых сценариев ДТП в Москве** на основе открытых данных и кластеризации (K-means).
Кластеры строятся по условиям ДТП (время, освещённость, погода, покрытие, тип, тяжесть и др.), а **координаты используются только для отображения на карте**.

## Архитектура
- **backend/** — FastAPI (REST API), JWT-аутентификация, RBAC (user/admin), эндпоинты карты, кластеров и статистики.
- **db/** — SQL-скрипт для MySQL/MariaDB (таблицы users/refresh_tokens/clusters + рекомендации по индексации).
- **frontend/** — React + Vite + Leaflet (карта, фильтры, живой поиск) + Chart.js (гистограмма по часу).
- **ml/** — скрипты импорта GeoJSON и обучения K-means с записью cluster_id в БД.

## Источник данных
Открытые данные: проект **«Карта ДТП»** (файл «Москва», период 2015–06.2025). Первоисточник — сайт ГИБДД (данные опубликованы с изменениями).  
Ссылка на источник должна быть указана **в интерфейсе и в записке**.

## Подготовка MySQL (у тебя БД уже есть: `kurs_bd`)
У тебя уже создана таблица `dtp_events`. Для работы сервиса нужно добавить:
1) `cluster_id` в `dtp_events`  
2) таблицы `users`, `refresh_tokens`, `clusters`

Открой phpMyAdmin → выбери БД `kurs_bd` → вкладка SQL → выполни файл:
- `db/init_mysql.sql`

**Важно:** строки с `ALTER TABLE ... cluster_id` в файле закомментированы — раскомментируй и выполни 1 раз.

## Настройка переменных окружения
Скопируй `.env.example` → `.env` и поменяй пароль/пользователя:

```env
DATABASE_URL=mysql+pymysql://root:password@127.0.0.1:3306/kurs_bd?charset=utf8mb4
JWT_SECRET=change_me_please
```

Если запускаешь **backend в Docker**, а MySQL стоит на хосте:
- Windows/Mac: используй `host.docker.internal` вместо `127.0.0.1`
- Linux: проще запустить backend локально (без Docker)

## Запуск backend (без Docker, самый простой вариант)
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt

# .env должен быть в папке backend/ (или передай переменные окружения)
export DATABASE_URL="mysql+pymysql://root:password@127.0.0.1:3306/kurs_bd?charset=utf8mb4"
export JWT_SECRET="change_me_please"

uvicorn app.main:app --reload --port 8000
```

Проверка: http://localhost:8000/health

## Запуск frontend
```bash
cd frontend
npm i
npm run dev
```

Открой: http://localhost:5173

## Создание администратора
```bash
cd backend
python -m app.cli.create_admin --email admin@example.com --password Admin123!
```

## Обучение K-means (запись cluster_id в MySQL)
Перед запуском убедись, что `dtp_events.cluster_id` добавлен.

```bash
cd backend
python -m app.ml.train_kmeans --k 8
# или автоподбор по silhouette:
python -m app.ml.train_kmeans --auto_k
```

## Импорт GeoJSON (если понадобится перезалить данные)
```bash
cd backend
python -m app.ml.import_geojson --path /path/to/moskva.geojson
```

## Эндпоинты (которые использует фронтенд)
- `GET /api/accidents/points?bbox=minLon,minLat,maxLon,maxLat&cluster_id=...`
- `GET /api/clusters`
- `GET /api/stats/histogram/hour?cluster_id=...`
- `GET /api/search/suggest?q=...`
- `POST /api/auth/register|login|refresh|logout`
- `GET /api/auth/me`

