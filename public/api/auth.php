<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

try {
  if ($method === 'POST' && $action === 'register') {
    $data = read_json_body();
    $email = trim((string)($data['email'] ?? ''));
    $password = (string)($data['password'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
      json_response(['error' => 'Invalid email'], 400);
    }
    if (strlen($password) < 8) {
      json_response(['error' => 'Password must be at least 8 characters'], 400);
    }

    $db = pdo();
    $stmt = $db->prepare('SELECT id FROM app_users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    if ($stmt->fetch()) json_response(['error' => 'Email already registered'], 409);

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $ins = $db->prepare('INSERT INTO app_users (email, password_hash, role) VALUES (:email, :hash, :role)');
    $ins->execute([':email' => $email, ':hash' => $hash, ':role' => 'user']);

    $userId = (int)$db->lastInsertId();
    $token = issue_access_token($userId, 'user');

    json_response(['access_token' => $token, 'token_type' => 'bearer']);
  }

  if ($method === 'POST' && $action === 'login') {
    $data = read_json_body();
    $email = trim((string)($data['email'] ?? ''));
    $password = (string)($data['password'] ?? '');

    $db = pdo();
    $stmt = $db->prepare('SELECT id, password_hash, role FROM app_users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    $u = $stmt->fetch();
    if (!$u || !password_verify($password, (string)$u['password_hash'])) {
      json_response(['error' => 'Bad credentials'], 401);
    }

    $token = issue_access_token((int)$u['id'], (string)$u['role']);
    json_response(['access_token' => $token, 'token_type' => 'bearer']);
  }

  if ($method === 'GET' && $action === 'me') {
    $payload = require_auth();
    $userId = (int)$payload['sub'];

    $db = pdo();
    $stmt = $db->prepare('SELECT id, email, role, created_at FROM app_users WHERE id = :id');
    $stmt->execute([':id' => $userId]);
    $u = $stmt->fetch();
    if (!$u) json_response(['error' => 'User not found'], 404);

    json_response(['user' => $u]);
  }

  json_response(['error' => 'Not found'], 404);

} catch (Throwable $e) {
  json_response(['error' => 'Server error', 'details' => $e->getMessage()], 500);
}
