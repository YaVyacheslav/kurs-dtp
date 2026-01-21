<?php
declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

set_time_limit(0);
ini_set('memory_limit', '512M');
ignore_user_abort(true);

require_once __DIR__ . '/common.php';

function fix_encoding(string $str): string {
    if (mb_check_encoding($str, 'UTF-8')) {
        return $str;
    }
    return mb_convert_encoding($str, 'UTF-8', 'CP866');
}

try {
    $u = require_auth();
    if (($u['role'] ?? '') !== 'admin') {
        throw new Exception('Access denied');
    }

    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $eps = $input['eps'] ?? 900.0;
    $min = $input['min_samples'] ?? 3;
    $years = $input['years'] ?? 2;

    $scriptPath = realpath(__DIR__ . '/../analyze.py');
    if (!$scriptPath || !file_exists($scriptPath)) {
        throw new Exception('File analyze.py not found.');
    }

    $pythonCmd = 'python';

    $cmd = sprintf(
        'cd %s && set PYTHONIOENCODING=utf-8 && %s %s --eps %s --min_samples %d --years %d --adaptive 1 --noise_cluster 1 2>&1',
        escapeshellarg(dirname($scriptPath)),
        $pythonCmd,
        escapeshellarg(basename($scriptPath)),
        escapeshellarg((string)$eps),
        $min,
        $years
    );

    $output = [];
    $exitCode = 0;
    exec($cmd, $output, $exitCode);

    $rawText = implode("\n", $output);
    $cleanText = fix_encoding($rawText);

    if (!$cleanText && $exitCode === 0) {
        $cleanText = "Скрипт выполнен успешно.";
    }

    json_response([
        'ok' => ($exitCode === 0),
        'exit_code' => $exitCode,
        'output' => $cleanText
    ]);

} catch (Throwable $e) {
    json_response(['error' => $e->getMessage()], 500);
}