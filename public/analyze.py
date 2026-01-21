import mysql.connector
import pandas as pd
import json
import numpy as np
import math
import argparse
import sys
from kmodes.kmodes import KModes
from sklearn.cluster import DBSCAN
from scipy.spatial import ConvexHull

DB_CONFIG = {
    'user': 'root',
    'password': '',
    'host': '127.0.0.1',
    'database': 'kurs_bd',
    'port': 3306
}

DEFAULTS = {
    'years': 2,
    'eps': 900.0,
    'min_samples': 3,
    'adaptive': 1,
    'n_ref': 700,
    'eps_min': 100.0,
    'eps_max': 1600.0,
    'min_min': 3,
    'min_max': 50,
    'alpha_eps': 0.4,
    'beta_min': 0.5,
    'noise': 1,
    'max_map_events': 500000
}


def get_connection():
    return mysql.connector.connect(**DB_CONFIG, use_pure=True)


def normalize_light(val):
    if val is None:
        return "Не установлено"
    v = str(val).lower().strip()
    if 'светлое' in v: return 'День'
    if 'включено' in v and 'не включено' not in v: return 'Ночь (свет)'
    if 'отсутствует' in v or 'не включено' in v: return 'Ночь (темно)'
    if 'сумерки' in v: return 'Сумерки'
    return 'Не установлено'


def extract_tag(json_str):
    try:
        t = json.loads(json_str)
        if isinstance(t, list) and t:
            return t[0]
    except:
        pass
    return "Неизвестно"


def get_scenario_title(weather, road, light):
    w, r, l = str(weather).strip().lower(), str(road).strip().lower(), str(light).strip().lower()

    time_str = str(light).strip()
    if 'день' in l:
        time_str = "Днём"
    elif 'сумерки' in l:
        time_str = "В сумерках"
    elif 'ночь' in l:
        time_str = "Ночью (светло)" if ('свет' in l or 'включено' in l) else "Ночью (темно)"

    w_str = w
    if 'ясно' in w:
        w_str = "ясно"
    elif 'пасмурно' in w:
        w_str = "пасмурно"
    elif 'дождь' in w:
        w_str = "дождь"
    elif 'снег' in w:
        w_str = "снегопад"
    elif 'туман' in w:
        w_str = "туман"

    r_str = r
    if 'сухое' in r:
        r_str = "сухой асфальт"
    elif 'мокрое' in r:
        r_str = "мокрая дорога"
    elif 'гололед' in r:
        r_str = "гололёд"
    elif 'снежн' in r:
        r_str = "снежный накат"
    elif 'обработан' in r:
        r_str = "дорога обработана"

    return f"{time_str}, {w_str}. {r_str.capitalize()}"


def project_coords(latlon):
    lat = latlon[:, 0].astype(float)
    lon = latlon[:, 1].astype(float)
    lat0, lon0 = float(np.mean(lat)), float(np.mean(lon))
    rad = math.radians(lat0)
    mx = (lon - lon0) * 111320.0 * math.cos(rad)
    my = (lat - lat0) * 110540.0
    return np.column_stack([mx, my])


def get_adaptive_params(n, args):
    n = max(1, int(n))
    ref = max(1, int(args.n_ref))

    f_eps = (ref / n) ** float(args.alpha_eps)
    f_min = (n / ref) ** float(args.beta_min)

    eps = float(args.eps) * f_eps
    ms = int(round(float(args.min_samples) * f_min))

    eps = max(float(args.eps_min), min(float(args.eps_max), eps))
    ms = int(max(int(args.min_min), min(int(args.min_max), ms)))
    ms = max(2, min(ms, n))

    return eps, ms


def parse_arguments():
    p = argparse.ArgumentParser()
    p.add_argument("--years", type=int, default=DEFAULTS['years'])
    p.add_argument("--adaptive", type=int, default=DEFAULTS['adaptive'])
    p.add_argument("--eps", type=float, default=DEFAULTS['eps'])
    p.add_argument("--min_samples", type=int, default=DEFAULTS['min_samples'])
    p.add_argument("--n_ref", type=int, default=DEFAULTS['n_ref'])
    p.add_argument("--eps_min", type=float, default=DEFAULTS['eps_min'])
    p.add_argument("--eps_max", type=float, default=DEFAULTS['eps_max'])
    p.add_argument("--min_min", type=int, default=DEFAULTS['min_min'])
    p.add_argument("--min_max", type=int, default=DEFAULTS['min_max'])
    p.add_argument("--alpha_eps", type=float, default=DEFAULTS['alpha_eps'])
    p.add_argument("--beta_min", type=float, default=DEFAULTS['beta_min'])
    p.add_argument("--noise_cluster", type=int, default=DEFAULTS['noise'])
    return p.parse_args()


def main():
    args = parse_arguments()

    try:
        conn = get_connection()
        cur = conn.cursor()
    except Exception as e:
        print(f"DB Connection failed: {e}")
        sys.exit(1)

    cur.execute("SET FOREIGN_KEY_CHECKS = 0")
    cur.execute("UPDATE dtp_events SET cluster_id = NULL")
    cur.execute("TRUNCATE TABLE ml_clusters")
    cur.execute("TRUNCATE TABLE ml_scenarios")
    cur.execute("SET FOREIGN_KEY_CHECKS = 1")
    conn.commit()

    query = f"""
        SELECT id, weather, road_conditions, light, ST_Y(location) as lat, ST_X(location) as lon
        FROM dtp_events
        WHERE weather IS NOT NULL AND road_conditions IS NOT NULL
          AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL {max(1, args.years)} YEAR)
          AND ST_X(location) BETWEEN 36 AND 39
          AND ST_Y(location) BETWEEN 54 AND 57
    """
    df = pd.read_sql(query, conn)

    if len(df) < 50:
        print("Insufficient data.")
        conn.close()
        return

    df['w'] = df['weather'].apply(extract_tag)
    df['r'] = df['road_conditions'].apply(extract_tag)
    df['l'] = df['light'].apply(normalize_light)

    X_cat = df[['w', 'r', 'l']]
    costs = []
    models = {}
    K_vals = range(8, 30)

    for k in K_vals:
        km = KModes(n_clusters=k, init='Huang', n_init=3, verbose=0)
        km.fit(X_cat)
        costs.append(km.cost_)
        models[k] = km

    x_arr = np.array(list(K_vals))
    y_arr = np.array(costs)
    xn = (x_arr - x_arr.min()) / (x_arr.max() - x_arr.min())
    yn = (y_arr - y_arr.min()) / (y_arr.max() - y_arr.min())

    vec = np.array([1, yn[-1] - yn[0]])
    vec = vec / np.linalg.norm(vec)
    vec_p = np.stack((xn, yn - yn[0]), axis=1)
    dists = np.linalg.norm(vec_p - vec_p @ vec[:, None] * vec, axis=1)

    best_k = K_vals[np.argmax(dists)]

    final_km = models[best_k]
    df['scen'] = final_km.labels_

    scen_ids = {}
    for i in range(best_k):
        cnt = final_km.cluster_centroids_[i]
        title = get_scenario_title(cnt[0], cnt[1], cnt[2])
        js = json.dumps({"weather": cnt[0], "road": cnt[1], "light": cnt[2]}, ensure_ascii=False)
        cur.execute("INSERT INTO ml_scenarios (title, factors_json) VALUES (%s, %s)", (title, js))
        scen_ids[i] = cur.lastrowid
    conn.commit()

    for tmp_id, db_id in scen_ids.items():
        sub = df[df['scen'] == tmp_id].copy()
        n = len(sub)
        if n < 3: continue

        eps, min_s = float(args.eps), max(2, min(n, int(args.min_samples)))
        if args.adaptive:
            eps, min_s = get_adaptive_params(n, args)

        if n < min_s: continue

        coords = sub[['lat', 'lon']].values.astype(float)
        xy = project_coords(coords)

        db = DBSCAN(eps=eps, min_samples=min_s)
        labels = db.fit_predict(xy)

        e_ids = sub['id'].to_numpy()
        unique = sorted(set(labels))

        for lb in unique:
            mask = (labels == lb)
            pts = coords[mask]
            batch_ids = e_ids[mask].tolist()

            if not batch_ids: continue

            is_noise = (lb == -1)
            if is_noise and not args.noise_cluster: continue

            poly_json = json.dumps(None)
            center = np.mean(pts, axis=0)

            if not is_noise and len(pts) >= 3:
                try:
                    hull = ConvexHull(pts)
                    h_pts = pts[hull.vertices]
                    h_pts = np.vstack([h_pts, h_pts[0]])
                    poly_json = json.dumps(h_pts.tolist())
                except:
                    pass

            cur.execute("""
                        INSERT INTO ml_clusters (scenario_id, center_lat, center_lon, points_count, polygon_json)
                        VALUES (%s, %s, %s, %s, %s)
                        """, (db_id, float(center[0]), float(center[1]), len(pts), poly_json))

            cid = cur.lastrowid
            limit = DEFAULTS['max_map_events']
            if len(batch_ids) > limit:
                batch_ids = batch_ids[:limit]

            data = [(cid, eid) for eid in batch_ids]
            cur.executemany("UPDATE dtp_events SET cluster_id = %s WHERE id = %s", data)

    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()