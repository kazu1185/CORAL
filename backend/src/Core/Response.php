<?php

namespace App\Core;

/**
 * JSONレスポンスヘルパー
 */
class Response
{
    public static function json(mixed $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function error(string $message, int $status = 400, ?array $details = null): void
    {
        $body = ['error' => $message];
        if ($details !== null) {
            $body['details'] = $details;
        }
        self::json($body, $status);
    }

    public static function paginated(array $items, int $total, int $page, int $perPage): void
    {
        self::json([
            'data' => $items,
            'pagination' => [
                'total'       => $total,
                'page'        => $page,
                'per_page'    => $perPage,
                'total_pages' => $perPage > 0 ? (int) ceil($total / $perPage) : 0,
            ],
        ]);
    }
}
