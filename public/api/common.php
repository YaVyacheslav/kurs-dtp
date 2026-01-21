<?php
declare(strict_types=1);

const DB_HOST = '127.0.0.1';
const DB_PORT = 3306;
const DB_NAME = 'kurs_bd';
const DB_USER = 'root';
const DB_PASS = '';

const JWT_SECRET = '7f8c9d0e1a2b3c4d5e6f7a8b9c0d1e2f';
const JWT_ALG = 'HS256';
const ACCESS_TOKEN_TTL_SECONDS = 1800;

const ROLE_ORDER = [
  'user' => 1,
  'analyst' => 2,
  'admin' => 3
];

function json_response($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function pdo(): PDO {
  static $pdo = null;
  if ($pdo instanceof PDO) return $pdo;

  $dsn = sprintf(
    'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
    DB_HOST,
    DB_PORT,
    DB_NAME
  );

  $pdo = new PDO($dsn, DB_USER, DB_PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
  ]);

  return $pdo;
}

function base64url_encode(string $data): string {
  return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode(string $data): string {
  $remainder = strlen($data) % 4;
  if ($remainder) $data .= str_repeat('=', 4 - $remainder);
  return base64_decode(strtr($data, '-_', '+/')) ?: '';
}

function jwt_sign(array $payload): string {
  $header = ['typ' => 'JWT', 'alg' => JWT_ALG];

  $h = base64url_encode(json_encode($header, JSON_UNESCAPED_UNICODE));
  $p = base64url_encode(json_encode($payload, JSON_UNESCAPED_UNICODE));

  $sig = hash_hmac('sha256', "$h.$p", JWT_SECRET, true);
  $s = base64url_encode($sig);

  return "$h.$p.$s";
}

function jwt_verify(string $token): ?array {
  $parts = explode('.', $token);
  if (count($parts) !== 3) return null;
  [$h, $p, $s] = $parts;

  $expected = base64url_encode(hash_hmac('sha256', "$h.$p", JWT_SECRET, true));
  if (!hash_equals($expected, $s)) return null;

  $payload = json_decode(base64url_decode($p), true);
  if (!is_array($payload)) return null;

  if (isset($payload['exp']) && time() > (int)$payload['exp']) return null;

  return $payload;
}

function issue_access_token(int $userId, string $role): string {
  $now = time();
  $payload = [
    'sub' => (string)$userId,
    'role' => $role,
    'iat' => $now,
    'exp' => $now + ACCESS_TOKEN_TTL_SECONDS
  ];
  return jwt_sign($payload);
}

function require_auth(): array {
  $t = bearer_token();
  if (!$t) json_response(['error' => 'Missing Authorization Bearer token'], 401);

  $payload = jwt_verify($t);
  if (!$payload) json_response(['error' => 'Invalid or expired token'], 401);

  return $payload;
}

function require_role(array $payload, string $minRole): void {
  $r = $payload['role'] ?? 'user';
  $a = ROLE_ORDER[$r] ?? 0;
  $b = ROLE_ORDER[$minRole] ?? 999;
  if ($a < $b) json_response(['error' => 'Insufficient role'], 403);
}

function safe_json_list(?string $raw): ?array {
  if (!$raw) return null;
  $v = json_decode($raw, true);
  return is_array($v) ? $v : null;
}

function bearer_token(): ?string {
  $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');

  if (!$hdr && function_exists('apache_request_headers')) {
    $h = apache_request_headers();
    $hdr = $h['Authorization'] ?? ($h['authorization'] ?? '');
  }

  if (preg_match('/Bearer\s+(.+)/i', $hdr, $m)) return trim($m[1]);
  return null;
}