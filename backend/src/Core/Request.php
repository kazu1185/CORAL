<?php

namespace App\Core;

/**
 * HTTPリクエスト解析
 */
class Request
{
    public string $method;
    public string $path;
    public array $params = [];
    public array $query;
    public array $body;
    public ?array $auth = null;

    public static function fromGlobals(): self
    {
        $request = new self();

        $request->method = strtoupper($_SERVER['REQUEST_METHOD']);

        // パスからクエリ文字列を除去
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $pos = strpos($uri, '?');
        $request->path = $pos !== false ? substr($uri, 0, $pos) : $uri;
        // 末尾スラッシュを正規化（ルート以外）
        $request->path = rtrim($request->path, '/') ?: '/';

        $request->query = $_GET;

        // JSONボディの解析
        $request->body = [];
        if (in_array($request->method, ['POST', 'PUT', 'PATCH'], true)) {
            $raw = file_get_contents('php://input');
            if ($raw !== '' && $raw !== false) {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $request->body = $decoded;
                }
            }
        }

        return $request;
    }
}
