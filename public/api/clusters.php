<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';

require_auth();

// === НАСТРОЙКИ ===
$limit = (int)($_GET['limit'] ?? 3000); // Берем больше данных для обучения
if ($limit < 500) $limit = 500;
if ($limit > 10000) $limit = 10000;

// Веса для "интересности" кластеров
// Увеличиваем вес условий, чтобы алгоритм не группировал только по карте
const WEIGHT_GEO = 1.0;      // География (оставляем базовой)
const WEIGHT_TIME = 2.5;     // Время (важно выделять ночь/час пик)
const WEIGHT_WEATHER = 4.0;  // Погода (ОЧЕНЬ ВАЖНО, чтобы найти дождь/снег)
const WEIGHT_ROAD = 4.0;     // Дорога (ОЧЕНЬ ВАЖНО для гололеда)
const WEIGHT_LIGHT = 2.0;    // Освещение

$region = trim((string)($_GET['region'] ?? ''));
$categoryFilter = trim((string)($_GET['category'] ?? ''));

// ---- HELPERS ----

function get_tags_from_json($raw): array {
    $arr = json_decode((string)$raw, true);
    if (!is_array($arr)) return [];
    $res = [];
    foreach ($arr as $v) {
        $v = trim((string)$v);
        // Упрощаем похожие теги
        if ($v === 'Режим движения не изменялся') continue; // мусор
        if ($v !== '') $res[] = $v;
    }
    return $res;
}

function parse_time_feature(string $occurred_at): array {
    $dt = new DateTime($occurred_at);
    $h = (int)$dt->format('G');
    // Циклическое время
    $rad = 2.0 * M_PI * ($h / 24.0);
    return [sin($rad), cos($rad)];
}

function one_hot_vocab(array $allLists, int $limit = 20): array {
    $counts = [];
    foreach ($allLists as $list) {
        foreach ($list as $val) $counts[$val] = ($counts[$val] ?? 0) + 1;
    }
    arsort($counts);
    $vocab = [];
    $idx = 0;
    foreach ($counts as $k => $cnt) {
        // Игнорируем слишком редкие, чтобы не шуметь
        if ($cnt < 5) break;
        $vocab[$k] = $idx++;
        if ($idx >= $limit) break;
    }
    return $vocab;
}

function zscore(array $vals): array {
    $mean = array_sum($vals) / count($vals);
    $variance = 0.0;
    foreach ($vals as $v) $variance += ($v - $mean) ** 2;
    $std = sqrt($variance / max(1, count($vals) - 1)) ?: 1.0;
    return [$mean, $std];
}

// Стандартный Евклид
function dist_sq(array $a, array $b): float {
    $sum = 0;
    $c = count($a);
    for ($i=0; $i<$c; $i++) {
        $d = $a[$i] - $b[$i];
        $sum += $d*$d;
    }
    return $sum;
}

function kmeans(array $X, int $k): array {
    $n = count($X);
    $dim = count($X[0]);
    // Инициализация K-means++
    $centroids = [$X[mt_rand(0, $n-1)]];
    for ($i=1; $i<$k; $i++) {
        $dists = [];
        $sumD = 0;
        foreach ($X as $row) {
            $minD = INF;
            foreach ($centroids as $c) $minD = min($minD, dist_sq($row, $c));
            $dists[] = $minD;
            $sumD += $minD;
        }
        $r = (mt_rand() / mt_getrandmax()) * $sumD;
        $curr = 0;
        $chosen = 0;
        foreach ($dists as $idx => $d) {
            $curr += $d;
            if ($curr >= $r) { $chosen = $idx; break; }
        }
        $centroids[] = $X[$chosen];
    }

    $labels = array_fill(0, $n, 0);
    for ($iter=0; $iter<15; $iter++) { // 15 итераций обычно достаточно
        $changed = false;
        $sums = array_fill(0, $k, array_fill(0, $dim, 0.0));
        $counts = array_fill(0, $k, 0);

        foreach ($X as $id => $row) {
            $minDist = INF;
            $bestC = 0;
            foreach ($centroids as $cid => $c) {
                $d = dist_sq($row, $c);
                if ($d < $minDist) { $minDist = $d; $bestC = $cid; }
            }
            if ($labels[$id] !== $bestC) {
                $labels[$id] = $bestC;
                $changed = true;
            }
            for ($j=0; $j<$dim; $j++) $sums[$bestC][$j] += $row[$j];
            $counts[$bestC]++;
        }

        if (!$changed) break;

        foreach ($centroids as $cid => &$c) {
            if ($counts[$cid] > 0) {
                for ($j=0; $j<$dim; $j++) $c[$j] = $sums[$cid][$j] / $counts[$cid];
            }
        }
    }

    // Считаем инерцию
    $inertia = 0.0;
    foreach ($X as $id => $row) $inertia += dist_sq($row, $centroids[$labels[$id]]);

    return [$labels, $inertia];
}

function get_cluster_name(array $clusterRows, array $globalStats): array {
    $count = count($clusterRows);
    if ($count === 0) return ['Неизвестно', 'Нет данных'];

    // 1. Собираем локальную статистику
    $locTime = ['Ночь' => 0, 'Утро' => 0, 'День' => 0, 'Вечер' => 0];
    $locWeather = [];
    $locRoad = [];
    $locRegion = [];
    $lats = []; $lons = [];

    foreach ($clusterRows as $r) {
        // Время
        $h = (int)(new DateTime($r['occurred_at']))->format('G');
        if ($h < 6) $locTime['Ночь']++;
        elseif ($h < 11) $locTime['Утро']++;
        elseif ($h < 17) $locTime['День']++;
        else $locTime['Вечер']++;

        // Гео
        $reg = $r['region'] ?: 'Неизвестно';
        $locRegion[$reg] = ($locRegion[$reg] ?? 0) + 1;
        $lats[] = $r['lat']; $lons[] = $r['lon'];

        // Теги
        foreach (get_tags_from_json($r['weather']) as $w) $locWeather[$w] = ($locWeather[$w] ?? 0) + 1;
        foreach (get_tags_from_json($r['road_conditions']) as $rd) $locRoad[$rd] = ($locRoad[$rd] ?? 0) + 1;
    }

    // 2. Ищем ОТЛИЧИТЕЛЬНЫЕ черты (Lift > 1.0)
    // Сравниваем долю в кластере с долей во всей выборке

    // --- Погода/Дорога ---
    $notableConditions = [];

    // Проверяем погоду
    foreach ($locWeather as $w => $cnt) {
        $localShare = $cnt / $count;
        $globalShare = ($globalStats['weather'][$w] ?? 1) / $globalStats['total'];
        $lift = $localShare / $globalShare;

        // Если это явление встречается здесь в 2 раза чаще, чем обычно - это фишка кластера
        if ($lift > 2.0 && $localShare > 0.15) {
            $notableConditions[$w] = $lift;
        }
    }
    // Проверяем дорогу
    foreach ($locRoad as $rd => $cnt) {
        $localShare = $cnt / $count;
        $globalShare = ($globalStats['road'][$rd] ?? 1) / $globalStats['total'];
        $lift = $localShare / $globalShare;

        if ($rd !== 'Сухое' && $lift > 1.8 && $localShare > 0.15) {
            $notableConditions[$rd] = $lift;
        }
    }

    arsort($notableConditions);
    $conditionTitle = array_key_first($notableConditions);

    if (!$conditionTitle) {
        // Если ничего особенного, берем топ погоду, но только если это не "Ясно"
        arsort($locWeather);
        $topW = array_key_first($locWeather);
        $conditionTitle = ($topW !== 'Ясно' && $topW !== 'Пасмурно') ? $topW : 'Обычные условия';
    }

    // --- Время ---
    $timeTitle = 'День';
    $bestTimeLift = 0;
    foreach ($locTime as $t => $cnt) {
        $localShare = $cnt / $count;
        $globalShare = ($globalStats['time'][$t] ?? 1) / $globalStats['total'];
        $lift = $localShare / $globalShare;
        if ($lift > $bestTimeLift) {
            $bestTimeLift = $lift;
            $timeTitle = $t;
        }
    }
    // Если лифт слабый, значит смешанное время
    if ($bestTimeLift < 1.3) $timeTitle = "Сутки";

    // --- География ---
    arsort($locRegion);
    $topReg = array_key_first($locRegion);
    $regShare = $locRegion[$topReg] / $count;

    // Центр масс
    $avgLat = array_sum($lats)/$count;
    $avgLon = array_sum($lons)/$count;

    // Определяем сторону света
    $geoTitle = $topReg;
    if ($regShare < 0.4) {
        $dLat = $avgLat - 55.751244;
        $dLon = $avgLon - 37.618423;
        $angle = rad2deg(atan2($dLat, $dLon));
        if (sqrt($dLat**2 + $dLon**2) > 0.15) $geoTitle = "МКАД/Окраины";
        else if ($angle >= 45 && $angle < 135) $geoTitle = "Север";
        else if ($angle >= -45 && $angle < 45) $geoTitle = "Восток";
        else if ($angle >= -135 && $angle < -45) $geoTitle = "Юг";
        else $geoTitle = "Запад";
    }

    return [
        "$geoTitle — $timeTitle", // Заголовок
        $conditionTitle           // Подзаголовок
    ];
}


// ---- MAIN ----
try {
    $db = pdo();
    $params = [];
    $where = [];

    if ($region) { $where[] = "region = :r"; $params[':r'] = $region; }
    if ($categoryFilter) { $where[] = "category = :c"; $params[':c'] = $categoryFilter; }
    $sqlWhere = $where ? "WHERE ".implode(' AND ', $where) : "";

    $sql = "SELECT id, occurred_at, weather, road_conditions, light, region, injured_count, dead_count, ST_Y(location) as lat, ST_X(location) as lon
            FROM dtp_events $sqlWhere ORDER BY occurred_at DESC LIMIT :lim";

    $stmt = $db->prepare($sql);
    foreach ($params as $k=>$v) $stmt->bindValue($k, $v);
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    if (count($rows) < 50) json_response(['error' => 'Мало данных'], 400);

    // 1. Глобальная статистика (для Lift)
    $globalStats = [
        'total' => count($rows),
        'weather' => [], 'road' => [], 'time' => ['Ночь'=>0,'Утро'=>0,'День'=>0,'Вечер'=>0]
    ];

    // Парсим данные
    $parsedData = [];
    $allWeather = [];
    $allRoad = [];
    $allLight = [];
    $lats = []; $lons = [];

    foreach ($rows as $r) {
        // Гео
        $lats[] = (float)$r['lat'];
        $lons[] = (float)$r['lon'];

        // Погода/Дорога
        $wList = get_tags_from_json($r['weather']);
        $rdList = get_tags_from_json($r['road_conditions']);
        $lVal = $r['light'] ?? '';

        // Статистика
        foreach ($wList as $w) $globalStats['weather'][$w] = ($globalStats['weather'][$w] ?? 0) + 1;
        foreach ($rdList as $rd) $globalStats['road'][$rd] = ($globalStats['road'][$rd] ?? 0) + 1;

        $h = (int)(new DateTime($r['occurred_at']))->format('G');
        if ($h < 6) $globalStats['time']['Ночь']++;
        elseif ($h < 11) $globalStats['time']['Утро']++;
        elseif ($h < 17) $globalStats['time']['День']++;
        else $globalStats['time']['Вечер']++;

        $parsedData[] = [
            'lat' => (float)$r['lat'],
            'lon' => (float)$r['lon'],
            'w' => $wList,
            'rd' => $rdList,
            'l' => $lVal,
            'time' => $r['occurred_at'],
            'orig' => $r
        ];

        $allWeather[] = $wList;
        $allRoad[] = $rdList;
        if ($lVal) $allLight[] = [$lVal];
    }

    // Словари One-Hot
    $vWeather = one_hot_vocab($allWeather);
    $vRoad = one_hot_vocab($allRoad);
    $vLight = one_hot_vocab($allLight);

    // Z-score гео
    [$latM, $latS] = zscore($lats);
    [$lonM, $lonS] = zscore($lons);

    // 2. Сборка матрицы X с ВЕСАМИ
    $X = [];
    foreach ($parsedData as $item) {
        $vec = [];

        // Гео (Вес 1.0)
        $vec[] = WEIGHT_GEO * ($item['lat'] - $latM) / $latS;
        $vec[] = WEIGHT_GEO * ($item['lon'] - $lonM) / $lonS;

        // Время (Вес 2.5)
        [$sinT, $cosT] = parse_time_feature($item['time']);
        $vec[] = WEIGHT_TIME * $sinT;
        $vec[] = WEIGHT_TIME * $cosT;

        // Погода (Вес 4.0 - КЛЮЧЕВОЙ МОМЕНТ)
        foreach ($vWeather as $val => $idx) {
            $has = in_array($val, $item['w']);
            // Если погода "плохая" (снег, дождь), даем еще бонус к весу
            $isBad = ($val !== 'Ясно' && $val !== 'Пасмурно');
            $w = WEIGHT_WEATHER * ($isBad ? 1.5 : 1.0);
            $vec[] = $has ? $w : 0.0;
        }

        // Дорога (Вес 4.0)
        foreach ($vRoad as $val => $idx) {
            $has = in_array($val, $item['rd']);
            $isBad = ($val !== 'Сухое');
            $w = WEIGHT_ROAD * ($isBad ? 1.5 : 1.0);
            $vec[] = $has ? $w : 0.0;
        }

        $X[] = $vec;
    }

    // 3. Кластеризация (Фиксируем k побольше, чтобы найти редкие группы)
    // Либо автоподбор, но смещенный к большему числу
    $bestRes = null;
    $bestScore = -1.0;

    // Ищем от 5 до 9 кластеров (меньше 5 - скучно, больше 9 - каша)
    for ($k=5; $k<=9; $k++) {
        [$labels, $inertia] = kmeans($X, $k);
        // Простая эвристика "локтя" через инерцию (силуэт дорого считать на бою)
        // Но для курсовой добавим штраф за k
        $score = -($inertia) - ($k * $inertia * 0.05);

        if ($bestRes === null || $score > $bestScore) {
            $bestScore = $score;
            $bestRes = ['k'=>$k, 'labels'=>$labels, 'inertia'=>$inertia];
        }
    }

    $finalK = $bestRes['k'];
    $labels = $bestRes['labels'];

    // 4. Формируем профили
    $clusters = [];
    for ($c=0; $c<$finalK; $c++) $clusters[$c] = [];

    foreach ($parsedData as $i => $item) {
        $clusters[$labels[$i]][] = $item['orig'];
    }

    $profiles = [];
    $byId = [];

    foreach ($clusters as $c => $rows) {
        if (empty($rows)) continue;

        // Заполняем ID метки
        foreach ($rows as $r) $byId[(string)$r['id']] = $c;

        // Генерация умного имени
        [$title, $sub] = get_cluster_name($rows, $globalStats);

        // Центр для карты
        $cLat = 0; $cLon = 0;
        $inj = 0; $dead = 0;
        foreach ($rows as $r) {
            $cLat += $r['lat'];
            $cLon += $r['lon'];
            $inj += $r['injured_count'];
            $dead += $r['dead_count'];
        }
        $cnt = count($rows);

        $profiles[] = [
            'cluster' => $c,
            'title' => $title,
            'subtitle' => $sub, // <-- Здесь будет "Снегопад" или "Гололедица"
            'count' => $cnt,
            'injured_sum' => $inj,
            'dead_sum' => $dead,
            'center' => [$cLat/$cnt, $cLon/$cnt]
        ];
    }

    // Сортируем: сначала самые опасные (с погодой), потом обычные
    usort($profiles, function($a, $b) {
        // Приоритет, если подзаголовок НЕ "Обычные условия" и НЕ "Ясно"
        $aBad = ($a['subtitle'] !== 'Обычные условия' && $a['subtitle'] !== 'Ясно');
        $bBad = ($b['subtitle'] !== 'Обычные условия' && $b['subtitle'] !== 'Ясно');
        if ($aBad && !$bBad) return -1;
        if (!$aBad && $bBad) return 1;
        return $b['count'] <=> $a['count'];
    });

    json_response([
        'k' => $finalK,
        'inertia' => $bestRes['inertia'],
        'labels_by_id' => $byId,
        'profiles' => $profiles
    ]);

} catch (Throwable $e) {
    json_response(['error' => $e->getMessage()], 500);
}