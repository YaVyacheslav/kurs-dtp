<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';

require_auth(); // чтобы не светить базу наружу

$type = $_GET['type'] ?? '';
$q = trim((string)($_GET['q'] ?? ''));
$limit = (int)($_GET['limit'] ?? 10);
if ($limit < 1) $limit = 1;
if ($limit > 50) $limit = 50;

if (mb_strlen($q) < 2) json_response(['items' => []]);

$field = null;
if ($type === 'regions') $field = 'region';
if ($type === 'categories') $field = 'category';

if (!$field) json_response(['error' => 'Bad type'], 400);

try {
  $db = pdo();
  // prefix search (LIKE 'q%') — быстро и безопасно через prepared
  $sql = "
    SELECT $field AS v
    FROM dtp_events
    WHERE $field IS NOT NULL AND $field LIKE :q
    GROUP BY $field
    ORDER BY $field
    LIMIT :limit
  ";
  $stmt = $db->prepare($sql);
  $stmt->bindValue(':q', $q . '%', PDO::PARAM_STR);
  $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt->execute();

  $items = [];
  foreach ($stmt->fetchAll() as $r) {
    if (!empty($r['v'])) $items[] = $r['v'];
  }

  json_response(['items' => $items]);

} catch (Throwable $e) {
  json_response(['error' => 'Server error', 'details' => $e->getMessage()], 500);
}
