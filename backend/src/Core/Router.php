<?php

namespace App\Core;

use App\Middleware\AuthMiddleware;
use App\Middleware\PermissionMiddleware;

/**
 * シンプルなURLルーター
 */
class Router
{
    /** @var array{method: string, pattern: string, paramNames: string[], handler: string, options: array}[] */
    private array $routes = [];

    /**
     * ルートを追加
     */
    public function addRoute(string $method, string $path, string $handler, array $options = []): void
    {
        // :param をキャプチャグループに変換
        $paramNames = [];
        $pattern = preg_replace_callback('/:([a-zA-Z_]+)/', function ($matches) use (&$paramNames) {
            $paramNames[] = $matches[1];
            return '([^/]+)';
        }, $path);
        $pattern = '#^' . $pattern . '$#';

        $this->routes[] = [
            'method'     => strtoupper($method),
            'pattern'    => $pattern,
            'paramNames' => $paramNames,
            'handler'    => $handler,
            'options'    => $options,
        ];
    }

    /**
     * リクエストをディスパッチ
     */
    public function dispatch(Request $request): void
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== $request->method) {
                continue;
            }
            if (!preg_match($route['pattern'], $request->path, $matches)) {
                continue;
            }

            // URLパラメータをセット
            array_shift($matches);
            foreach ($route['paramNames'] as $i => $name) {
                $request->params[$name] = $matches[$i] ?? '';
            }

            $options = $route['options'];

            // 認証処理
            $authRequired = !isset($options['auth']) || $options['auth'] !== false;
            $deviceAuth = !empty($options['device_auth']);

            if ($deviceAuth) {
                AuthMiddleware::handleDevice($request);
            } elseif ($authRequired) {
                AuthMiddleware::handle($request);
            }

            // 権限チェック
            if (isset($options['permission'])) {
                PermissionMiddleware::handle($request, $options['permission']);
            }

            // コントローラー呼び出し
            $this->callHandler($route['handler'], $request);
            return;
        }

        // マッチしなかった
        Response::error('エンドポイントが見つかりません', 404);
    }

    /**
     * 'ControllerName@method' 形式のハンドラーを呼び出す
     */
    private function callHandler(string $handler, Request $request): void
    {
        [$controllerName, $method] = explode('@', $handler, 2);
        $className = 'App\\Controllers\\' . $controllerName;

        if (!class_exists($className)) {
            Response::error("コントローラー {$controllerName} が見つかりません", 500);
        }

        $controller = new $className();

        if (!method_exists($controller, $method)) {
            Response::error("メソッド {$method} が見つかりません", 500);
        }

        $controller->$method($request);
    }
}
