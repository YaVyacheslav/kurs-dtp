import mysql.connector
import pandas as pd
import json
import numpy as np
import math
import argparse

from kmodes.kmodes import KModes
from sklearn.cluster import DBSCAN
from scipy.spatial import ConvexHull

# === КОНФИГУРАЦИЯ БД ===
DB_CONFIG = {
    'user': 'root',
    'password': '',
    'host': '127.0.0.1',
    'database': 'kurs_bd',
    'port': 3306
}

# НАСТРОЙКИ
YEARS_BACK_DEFAULT = 2
DBSCAN_EPS_M_BASE_DEFAULT = 900
DBSCAN_MIN_SAMPLES_BASE_DEFAULT = 3
ADAPTIVE_DBSCAN_DEFAULT = True
N_REF_DEFAULT = 700
EPS_MIN_DEFAULT, EPS_MAX_DEFAULT = 100, 1600
MIN_SAMPLES_MIN_DEFAULT, MIN_SAMPLES_MAX_DEFAULT = 3, 50
ALPHA_EPS_DEFAULT = 0.4
BETA_MIN_DEFAULT = 0.5
CREATE_NOISE_CLUSTER_DEFAULT = True
MAX_EVENTS_MAP_PER_CLUSTER = 500000


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG, use_pure=True)


def clean_light(val):
    if val is None: return "Не установлено"
    val = str(val).lower().strip()
    if 'светлое' in val: return 'День'
    if 'включено' in val and 'не включено' not in val: return 'Ночь (свет)'
    if 'отсутствует' in val or 'не включено' in val: return 'Ночь (темно)'
    if 'сумерки' in val: return 'Сумерки'
    return 'Не установлено'


def extract_primary_tag(json_str):
    try:
        tags = json.loads(json_str)
        if isinstance(tags, list) and len(tags) > 0: return tags[0]
    except:
        pass
    return "Неизвестно"


def latlon_to_local_meters(latlon: np.ndarray) -> np.ndarray:
    lat = latlon[:, 0].astype(float)
    lon = latlon[:, 1].astype(float)
    lat0 = float(np.mean(lat))
    lon0 = float(np.mean(lon))
    lat0_rad = math.radians(lat0)
    m_per_deg_lat = 110540.0
    m_per_deg_lon = 111320.0 * math.cos(lat0_rad)
    x = (lon - lon0) * m_per_deg_lon
    y = (lat - lat0) * m_per_deg_lat
    return np.column_stack([x, y])


def clamp(x, a, b):
    return max(a, min(b, x))


def adaptive_dbscan_params(n_points, eps_base, min_base, n_ref, eps_min, eps_max, min_min, min_max, alpha_eps,
                           beta_min):
    n = max(1, int(n_points))
    n_ref = max(1, int(n_ref))
    factor_eps = (n_ref / n) ** float(alpha_eps)
    if n > n_ref:
        factor_min = (n / n_ref) ** float(beta_min)
    else:
        factor_min = (n / n_ref) ** float(beta_min)
    eps = float(eps_base) * factor_eps
    min_samples = int(round(float(min_base) * factor_min))
    eps = clamp(eps, float(eps_min), float(eps_max))
    min_samples = int(clamp(min_samples, int(min_min), int(min_max)))
    min_samples = min(min_samples, n)
    min_samples = max(2, min_samples)
    return eps, min_samples


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--years", type=int, default=YEARS_BACK_DEFAULT)
    p.add_argument("--adaptive", type=int, default=1 if ADAPTIVE_DBSCAN_DEFAULT else 0)
    p.add_argument("--eps", type=float, default=DBSCAN_EPS_M_BASE_DEFAULT)
    p.add_argument("--min_samples", type=int, default=DBSCAN_MIN_SAMPLES_BASE_DEFAULT)
    p.add_argument("--n_ref", type=int, default=N_REF_DEFAULT)
    p.add_argument("--eps_min", type=float, default=EPS_MIN_DEFAULT)
    p.add_argument("--eps_max", type=float, default=EPS_MAX_DEFAULT)
    p.add_argument("--min_min", type=int, default=MIN_SAMPLES_MIN_DEFAULT)
    p.add_argument("--min_max", type=int, default=MIN_SAMPLES_MAX_DEFAULT)
    p.add_argument("--alpha_eps", type=float, default=ALPHA_EPS_DEFAULT)
    p.add_argument("--beta_min", type=float, default=BETA_MIN_DEFAULT)
    p.add_argument("--noise_cluster", type=int, default=1 if CREATE_NOISE_CLUSTER_DEFAULT else 0)
    return p.parse_args()


def main():
    args = parse_args()
    years_back = max(1, int(args.years))
    adaptive = bool(int(args.adaptive))
    eps_base = float(args.eps)
    min_base = max(2, int(args.min_samples))
    n_ref = max(1, int(args.n_ref))
    eps_min = float(args.eps_min)
    eps_max = float(args.eps_max)
    min_min = max(2, int(args.min_min))
    min_max = max(min_min, int(args.min_max))
    alpha_eps = float(args.alpha_eps)
    beta_min = float(args.beta_min)
    create_noise_cluster = bool(int(args.noise_cluster))

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        print("Подключение к БД успешно.")
    except Exception as e:
        print(f"Ошибка подключения к БД: {e}")
        return

    print("1. Очистка старых результатов (сброс cluster_id)...")
    cursor.execute("SET FOREIGN_KEY_CHECKS = 0")

    cursor.execute("UPDATE dtp_events SET cluster_id = NULL")

    cursor.execute("TRUNCATE TABLE ml_clusters")
    cursor.execute("TRUNCATE TABLE ml_scenarios")
    cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
    conn.commit()

    print(f"2. Загрузка ДТП за последние {years_back} лет...")
    query = f"""
        SELECT id,
               weather,
               road_conditions,
               light,
               ST_Y(location) as lat,
               ST_X(location) as lon
        FROM dtp_events
        WHERE weather IS NOT NULL
          AND road_conditions IS NOT NULL
          AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL {years_back} YEAR)
          AND ST_X(location) BETWEEN 36 AND 39
          AND ST_Y(location) BETWEEN 54 AND 57
    """
    df = pd.read_sql(query, conn)
    print(f"   Загружено {len(df)} корректных записей.")

    if len(df) < 50:
        print("Мало данных.")
        conn.close()
        return

    df['w_clean'] = df['weather'].apply(extract_primary_tag)
    df['r_clean'] = df['road_conditions'].apply(extract_primary_tag)
    df['l_clean'] = df['light'].apply(clean_light)
    cat_data = df[['w_clean', 'r_clean', 'l_clean']]

    print("3. Подбор сценариев...")
    costs = []
    K_RANGE = range(7, 30)
    trained_models = {}

    for k in K_RANGE:
        print(f"   > k={k}...", end="\r")
        km = KModes(n_clusters=k, init='Huang', n_init=3, verbose=0)
        km.fit(cat_data)
        costs.append(km.cost_)
        trained_models[k] = km

    x = np.array(list(K_RANGE))
    y = np.array(costs)
    x_norm = (x - x.min()) / (x.max() - x.min())
    y_norm = (y - y.min()) / (y.max() - y.min())
    vec_line = np.array([1, y_norm[-1] - y_norm[0]])
    vec_line = vec_line / np.linalg.norm(vec_line)
    vec_points = np.stack((x_norm, y_norm - y_norm[0]), axis=1)
    dists = np.linalg.norm(vec_points - vec_points @ vec_line[:, None] * vec_line, axis=1)

    best_k = K_RANGE[np.argmax(dists)]
    print(f"\n   >>> Оптимально: {best_k} сценариев")

    km = trained_models[best_k]
    df['scen_id'] = km.labels_

    scen_map = {}
    for i in range(best_k):
        c = km.cluster_centroids_[i]
        title = f"{c[0]} + {c[1]} + {c[2]}"
        f_json = json.dumps({"weather": c[0], "road": c[1], "light": c[2]}, ensure_ascii=False)
        cursor.execute("INSERT INTO ml_scenarios (title, factors_json) VALUES (%s, %s)", (title, f_json))
        scen_map[i] = cursor.lastrowid
    conn.commit()

    print("4. Гео-кластеризация DBSCAN...")

    for tmp_id, db_scenario_id in scen_map.items():
        sub = df[df['scen_id'] == tmp_id].copy()
        n_points = len(sub)
        if n_points < 3: continue

        if adaptive:
            eps_m, min_samples = adaptive_dbscan_params(n_points, eps_base, min_base, n_ref, eps_min, eps_max, min_min,
                                                        min_max, alpha_eps, beta_min)
        else:
            eps_m = float(eps_base)
            min_samples = max(2, int(min_base))
            min_samples = min(min_samples, n_points)

        if n_points < min_samples: continue

        print(f"   scen_tmp={tmp_id} points={n_points} -> eps={eps_m:.1f}m, min_samples={min_samples}")

        latlon = sub[['lat', 'lon']].values.astype(float)
        xy = latlon_to_local_meters(latlon)

        dbscan = DBSCAN(eps=eps_m, min_samples=min_samples)
        labels = dbscan.fit_predict(xy)

        event_ids = sub['id'].to_numpy()
        unique_labels = sorted(set(labels.tolist()))
        unique_labels = [l for l in unique_labels if l >= 0] + ([-1] if (-1 in unique_labels) else [])

        for lab in unique_labels:
            mask = (labels == lab)
            pts = latlon[mask]
            eids = event_ids[mask].tolist()

            if len(eids) == 0: continue

            is_noise = (lab == -1)

            if is_noise:
                if not create_noise_cluster: continue
                center_mass = np.mean(pts, axis=0)
                polygon_json = json.dumps(None)
                cursor.execute("""
                               INSERT INTO ml_clusters (scenario_id, center_lat, center_lon, points_count, polygon_json)
                               VALUES (%s, %s, %s, %s, %s)
                               """, (db_scenario_id, float(center_mass[0]), float(center_mass[1]), int(len(pts)),
                                     polygon_json))
                cid = cursor.lastrowid

                if len(eids) > MAX_EVENTS_MAP_PER_CLUSTER:
                    eids = eids[:MAX_EVENTS_MAP_PER_CLUSTER]

                update_data = [(int(cid), int(e)) for e in eids]

                cursor.executemany(
                    "UPDATE dtp_events SET cluster_id = %s WHERE id = %s",
                    update_data
                )
                continue

            if len(pts) < 3: continue

            try:
                hull = ConvexHull(pts)
                h_pts = pts[hull.vertices]
                h_pts = np.vstack([h_pts, h_pts[0]])
                center_mass = np.mean(pts, axis=0)
                cursor.execute("""
                               INSERT INTO ml_clusters (scenario_id, center_lat, center_lon, points_count, polygon_json)
                               VALUES (%s, %s, %s, %s, %s)
                               """, (db_scenario_id, float(center_mass[0]), float(center_mass[1]), int(len(pts)),
                                     json.dumps(h_pts.tolist())))
                cid = cursor.lastrowid

                if len(eids) > MAX_EVENTS_MAP_PER_CLUSTER:
                    eids = eids[:MAX_EVENTS_MAP_PER_CLUSTER]

                # --- ИЗМЕНЕНИЕ 2: UPDATE вместо INSERT ---
                update_data = [(int(cid), int(e)) for e in eids]

                cursor.executemany(
                    "UPDATE dtp_events SET cluster_id = %s WHERE id = %s",
                    update_data
                )
            except:
                continue

    conn.commit()
    conn.close()
    print("--- ГОТОВО ---")


if __name__ == "__main__":
    main()