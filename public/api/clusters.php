<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';

require_auth();

try {
    $db = pdo();

    $stmt = $db->query("SELECT * FROM ml_scenarios ORDER BY id");
    $scenarios = $stmt->fetchAll();

    $result = [];

    foreach ($scenarios as $scen) {
        $stmt2 = $db->prepare("SELECT id, center_lat, center_lon, points_count, polygon_json FROM ml_clusters WHERE scenario_id = ?");
        $stmt2->execute([$scen['id']]);
        $clusters = $stmt2->fetchAll();

        $clustersData = [];
        $totalCount = 0;

        foreach ($clusters as $c) {
            $clusterId = (int)$c['id'];
            $polyRaw = $c['polygon_json'];
            $isNoise = ($polyRaw === null || trim((string)$polyRaw) === 'null' || trim((string)$polyRaw) === '');

            $stmt3 = $db->prepare("
                SELECT
                    id,
                    occurred_at,
                    severity,
                    category,
                    injured_count,
                    dead_count,
                    participants_count,
                    weather,
                    road_conditions,
                    light,
                    nearby,
                    region,
                    address,
                    ST_Y(location) as lat,
                    ST_X(location) as lon
                FROM dtp_events
                WHERE cluster_id = ?
                LIMIT 4000
            ");
            $stmt3->execute([$clusterId]);
            $rows = $stmt3->fetchAll();

            $points = [];
            foreach ($rows as $rp) {
                $w = safe_json_list($rp['weather']);
                $r = safe_json_list($rp['road_conditions']);
                $n = safe_json_list($rp['nearby']);

                $points[] = [
                    'coords' => [(float)$rp['lat'], (float)$rp['lon']],
                    'props' => [
                        'id' => $rp['id'],
                        'source_id' => $rp['id'],
                        'date' => $rp['occurred_at'],
                        'severity' => $rp['severity'],
                        'cat' => $rp['category'],
                        'inj' => $rp['injured_count'],
                        'dead' => $rp['dead_count'],
                        'part' => $rp['participants_count'],
                        'weather' => $w,
                        'road' => $r,
                        'light' => $rp['light'],
                        'nearby' => $n,
                        'region' => $rp['region'],
                        'address' => $rp['address']
                    ]
                ];
            }

            $clustersData[] = [
                'id' => $clusterId,
                'count' => (int)$c['points_count'],
                'polygon' => json_decode((string)$c['polygon_json'], true),
                'points' => $points,
                'is_noise' => $isNoise ? 1 : 0
            ];

            $totalCount += (int)$c['points_count'];
        }

        $title = $scen['title'];
        $icon = 'day';
        if (mb_stripos($title, 'Ночь') !== false) $icon = 'night';
        if (mb_stripos($title, 'Снег') !== false) $icon = 'snow';

        $result[] = [
            'cluster' => (int)$scen['id'],
            'title' => $title,
            'icon' => $icon,
            'count' => $totalCount,
            'clusters_data' => $clustersData
        ];
    }

    json_response(['profiles' => $result]);

} catch (PDOException $e) {
    json_response(['error' => 'DB Error: ' . $e->getMessage()], 500);
}
?>