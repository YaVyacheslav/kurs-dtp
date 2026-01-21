<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';

echo "<h2>Запуск ML-анализа...</h2>";
echo "<div style='background:#1e1e1e; color:#0f0; padding:15px; border-radius:5px; font-family:monospace; white-space:pre-wrap;'>";

$eps = isset($_GET['eps']) ? (float)$_GET['eps'] : 600.0;
$min = isset($_GET['min_samples']) ? (int)$_GET['min_samples'] : 18;
$years = isset($_GET['years']) ? (int)$_GET['years'] : 2;
$scenarioLimit = isset($_GET['scenario_limit']) ? (int)$_GET['scenario_limit'] : 700;

if ($eps < 50) $eps = 50;
if ($eps > 5000) $eps = 5000;
if ($min < 2) $min = 2;
if ($min > 200) $min = 200;
if ($years < 1) $years = 1;
if ($years > 20) $years = 20;
if ($scenarioLimit < 1) $scenarioLimit = 1;
if ($scenarioLimit > 5000) $scenarioLimit = 5000;

$cmd = sprintf(
    'python analyze.py --eps %s --min_samples %d --years %d --scenario_limit %d --noise_cluster 1 2>&1',
    escapeshellarg((string)$eps),
    $min,
    $years,
    $scenarioLimit
);

$output = shell_exec($cmd);

echo htmlspecialchars($output ?: 'Скрипт не вернул ответа. Возможно, python не добавлен в PATH или ошибка прав.');
echo "</div>";
