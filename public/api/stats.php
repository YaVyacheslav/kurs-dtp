<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';
require_auth();

try {
  $db = pdo();

  $from = trim((string)($_GET['from'] ?? ''));
  $to   = trim((string)($_GET['to'] ?? ''));

  if (!$from || !$to) {
    json_response(['error' => 'from/to required'], 400);
  }

  if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) $from .= ' 00:00:00';

  $toExcl = $to;
  if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
    $dt = new DateTimeImmutable($to . ' 00:00:00');
    $toExcl = $dt->modify('+1 day')->format('Y-m-d H:i:s');
  }

  $baseWhere = "WHERE e.occurred_at >= :from AND e.occurred_at < :to";
  $baseParams = [':from' => $from, ':to' => $toExcl];

  $sql = "SELECT
            COUNT(*) AS total,
            COALESCE(SUM(e.injured_count),0) AS injured,
            COALESCE(SUM(e.dead_count),0) AS dead
          FROM dtp_events e
          $baseWhere";
  $st = $db->prepare($sql);
  $st->execute($baseParams);
  $kpi = $st->fetch() ?: ['total'=>0,'injured'=>0,'dead'=>0];

  $sql = "SELECT DATE(e.occurred_at) AS d, COUNT(*) AS c
          FROM dtp_events e
          $baseWhere
          GROUP BY d
          ORDER BY d";
  $st = $db->prepare($sql);
  $st->execute($baseParams);
  $perDay = [];
  foreach ($st->fetchAll() as $r) $perDay[] = ['date' => $r['d'], 'count' => (int)$r['c']];

  $sql = "SELECT
            COALESCE(NULLIF(TRIM(e.severity), ''), '—') AS k,
            COUNT(*) AS c
          FROM dtp_events e
          $baseWhere
          GROUP BY k
          ORDER BY c DESC";
  $st = $db->prepare($sql);
  $st->execute($baseParams);
  $severity = [];
  foreach ($st->fetchAll() as $r) $severity[] = ['label'=>$r['k'], 'count'=>(int)$r['c']];

  $sql = "SELECT
            COALESCE(NULLIF(TRIM(e.category), ''), '—') AS k,
            COUNT(*) AS c
          FROM dtp_events e
          $baseWhere
          GROUP BY k
          ORDER BY c DESC";
  $st = $db->prepare($sql);
  $st->execute($baseParams);
  $categories = [];
  foreach ($st->fetchAll() as $r) $categories[] = ['label'=>$r['k'], 'count'=>(int)$r['c']];

  $sql = "SELECT
            COALESCE(NULLIF(TRIM(SUBSTRING_INDEX(e.region, ',', 1)), ''), '—') AS k,
            COUNT(*) AS c
          FROM dtp_events e
          $baseWhere
          GROUP BY k
          ORDER BY c DESC
          LIMIT 50";
  $st = $db->prepare($sql);
  $st->execute($baseParams);
  $districts = [];
  foreach ($st->fetchAll() as $r) $districts[] = ['label'=>$r['k'], 'count'=>(int)$r['c']];

  $conditions = [];
  try {
    $sql = "
      SELECT tag, SUM(cnt) AS c FROM (
        SELECT jt.tag AS tag, COUNT(*) AS cnt
        FROM dtp_events e
        JOIN JSON_TABLE(e.weather, '$[*]' COLUMNS(tag VARCHAR(255) PATH '$')) jt
        $baseWhere
        GROUP BY jt.tag

        UNION ALL

        SELECT jt2.tag AS tag, COUNT(*) AS cnt
        FROM dtp_events e
        JOIN JSON_TABLE(e.road_conditions, '$[*]' COLUMNS(tag VARCHAR(255) PATH '$')) jt2
        $baseWhere
        GROUP BY jt2.tag
      ) t
      GROUP BY tag
      ORDER BY c DESC
      LIMIT 50";
    $st = $db->prepare($sql);
    $st->execute($baseParams);
    foreach ($st->fetchAll() as $r) {
      $conditions[] = ['label' => (string)$r['tag'], 'count' => (int)$r['c']];
    }
  } catch (Throwable $e) {
    $conditions = [];
  }

  json_response([
    'from' => substr($from, 0, 10),
    'to'   => substr($to, 0, 10),
    'total' => (int)$kpi['total'],
    'injured' => (int)$kpi['injured'],
    'dead' => (int)$kpi['dead'],
    'victims' => (int)$kpi['injured'] + (int)$kpi['dead'],
    'perDay' => $perDay,
    'severity' => $severity,
    'categories' => $categories,
    'districts' => $districts,
    'conditions' => $conditions
  ]);

} catch (PDOException $e) {
  json_response(['error' => $e->getMessage()], 500);
}