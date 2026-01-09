<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';

// Можно оставить открытым для демо,
// но для “5” лучше требовать токен:
$payload = require_auth(); // <- включено

$limit  = (int)($_GET['limit'] ?? 500);
$offset = (int)($_GET['offset'] ?? 0);
$region = trim((string)($_GET['region'] ?? ''));
$category = trim((string)($_GET['category'] ?? ''));

if ($limit < 1) $limit = 1;
if ($limit > 2000) $limit = 2000;
if ($offset < 0) $offset = 0;

$where = [];
$params = [];

if ($region !== '') {
  $where[] = 'region = :region';
  $params[':region'] = $region;
}
if ($category !== '') {
  $where[] = 'category = :category';
  $params[':category'] = $category;
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

try {
  $db = pdo();

  // total
  $countSql = "SELECT COUNT(*) AS cnt FROM dtp_events $whereSql";
  $stmt = $db->prepare($countSql);
  $stmt->execute($params);
  $total = (int)($stmt->fetch()['cnt'] ?? 0);

  // data
  $dataSql = "
    SELECT
      id, occurred_at, light, category, severity,
      injured_count, dead_count, participants_count,
      region, parent_region, address,
      ST_Y(location) AS lat,
      ST_X(location) AS lon,
      weather, road_conditions
    FROM dtp_events
    $whereSql
    ORDER BY occurred_at DESC
    LIMIT :limit OFFSET :offset
  ";

  $stmt2 = $db->prepare($dataSql);

  foreach ($params as $k => $v) $stmt2->bindValue($k, $v);
  $stmt2->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt2->bindValue(':offset', $offset, PDO::PARAM_INT);

  $stmt2->execute();
  $rows = $stmt2->fetchAll();

  // нормализуем JSON поля
  $items = [];
  foreach ($rows as $r) {
    $r['lat'] = (float)$r['lat'];
    $r['lon'] = (float)$r['lon'];
    $r['weather'] = safe_json_list($r['weather'] ?? null);
    $r['road_conditions'] = safe_json_list($r['road_conditions'] ?? null);
    $items[] = $r;
  }

  json_response([
    'items' => $items,
    'total' => $total,
    'limit' => $limit,
    'offset' => $offset
  ]);

} catch (Throwable $e) {
  json_response(['error' => 'Server error', 'details' => $e->getMessage()], 500);
}
