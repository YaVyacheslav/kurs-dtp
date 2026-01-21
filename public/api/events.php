<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';

require_auth();

try {
  $db = pdo();

  $limit  = (int)($_GET['limit'] ?? 500);
  $offset = (int)($_GET['offset'] ?? 0);

  $region   = trim((string)($_GET['region'] ?? ''));
  $category = trim((string)($_GET['category'] ?? ''));
  $weather  = trim((string)($_GET['weather'] ?? ''));
  $road     = trim((string)($_GET['road'] ?? ''));

  $from = trim((string)($_GET['from'] ?? ''));
  $to   = trim((string)($_GET['to'] ?? ''));

  $clusterId = (int)($_GET['cluster_id'] ?? 0);

  if ($limit < 1) $limit = 1;
  if ($limit > 2000) $limit = 2000;
  if ($offset < 0) $offset = 0;

  $where = [];
  $params = [];

  $fromSql = "FROM dtp_events e";

  if ($clusterId > 0) {
    $where[] = "e.cluster_id = :cluster_id";
    $params[':cluster_id'] = $clusterId;
  }

  if ($from !== '') {
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
      $where[] = "e.occurred_at >= :from";
      $params[':from'] = $from . " 00:00:00";
    } else {
      $where[] = "e.occurred_at >= :from";
      $params[':from'] = $from;
    }
  }

  if ($to !== '') {
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
      $dt = new DateTimeImmutable($to . " 00:00:00");
      $toExcl = $dt->modify('+1 day')->format('Y-m-d H:i:s');

      $where[] = "e.occurred_at < :to_excl";
      $params[':to_excl'] = $toExcl;
    } else {
      $where[] = "e.occurred_at <= :to";
      $params[':to'] = $to;
    }
  }

  if ($region) {
    $where[] = "e.region LIKE :region";
    $params[':region'] = "%$region%";
  }
  if ($category) {
    $where[] = "e.category LIKE :cat";
    $params[':cat'] = "%$category%";
  }
  if ($weather) {
    $where[] = "e.weather LIKE :weather";
    $params[':weather'] = "%$weather%";
  }
  if ($road) {
    $where[] = "e.road_conditions LIKE :road";
    $params[':road'] = "%$road%";
  }

  $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

  $countSql = "SELECT COUNT(*) AS cnt $fromSql $whereSql";
  $stmt = $db->prepare($countSql);
  $stmt->execute($params);
  $total = (int)($stmt->fetch()['cnt'] ?? 0);

  $dataSql = "
    SELECT
      e.id,
      e.occurred_at, e.light, e.category, e.severity,
      e.injured_count, e.dead_count, e.participants_count,
      e.region, e.parent_region, e.address,
      ST_Y(e.location) AS lat,
      ST_X(e.location) AS lon,
      e.weather, e.road_conditions, e.nearby
    $fromSql
    $whereSql
    ORDER BY e.occurred_at DESC
    LIMIT :limit OFFSET :offset
  ";

  $stmt2 = $db->prepare($dataSql);
  foreach ($params as $k => $v) $stmt2->bindValue($k, $v);
  $stmt2->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt2->bindValue(':offset', $offset, PDO::PARAM_INT);
  $stmt2->execute();

  $rows = $stmt2->fetchAll();

  $items = [];
  foreach ($rows as $r) {
    $items[] = [
      'id' => (int)$r['id'],
      'source_id' => $r['id'],
      'date' => $r['occurred_at'],
      'category' => $r['category'],
      'severity' => $r['severity'],
      'region' => $r['region'],
      'parent_region' => $r['parent_region'],
      'address' => $r['address'],
      'injured' => (int)$r['injured_count'],
      'dead' => (int)$r['dead_count'],
      'weather' => safe_json_list($r['weather']),
      'road' => safe_json_list($r['road_conditions']),
      'coords' => [(float)$r['lat'], (float)$r['lon']]
    ];
  }

  json_response([
    'total' => $total,
    'limit' => $limit,
    'offset' => $offset,
    'items' => $items
  ]);

} catch (PDOException $e) {
  json_response(['error' => $e->getMessage()], 500);
}
?>