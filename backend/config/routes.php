<?php

/**
 * ルート定義
 *
 * @var \App\Core\Router $router
 */

// ============================================================
// 認証
// ============================================================
$router->addRoute('POST', '/api/v1/auth/login',       'AuthController@login',     ['auth' => false]);
$router->addRoute('POST', '/api/v1/auth/logout',      'AuthController@logout');
$router->addRoute('GET',  '/api/v1/auth/me',          'AuthController@me');
$router->addRoute('PUT',  '/api/v1/auth/pin',         'AuthController@changePin');
$router->addRoute('GET',  '/api/v1/auth/staff-list',  'AuthController@staffList', ['auth' => false]);

// ============================================================
// ダッシュボード
// ============================================================
$router->addRoute('GET',  '/api/v1/dashboard',                  'DashboardController@index',           ['permission' => 'reservation.view']);
$router->addRoute('GET',  '/api/v1/dashboard/alerts',           'DashboardController@alerts',          ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/dashboard/resolve-tl-error', 'DashboardController@resolveTlError',  ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/dashboard/resolve-tl-errors','DashboardController@resolveTlErrors', ['permission' => 'reservation.view']);

// ============================================================
// 予約
// ============================================================
$router->addRoute('GET',  '/api/v1/reservations',             'ReservationController@index',  ['permission' => 'reservation.view']);
$router->addRoute('GET',  '/api/v1/reservations/:id',         'ReservationController@show',   ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/reservations',             'ReservationController@store',  ['permission' => 'reservation.create']);
$router->addRoute('PUT',  '/api/v1/reservations/:id',         'ReservationController@update', ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/reservations/merge',       'ReservationController@merge',   ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/reservations/:id/split',           'ReservationController@split',         ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/reservations/:id/unmerge-source', 'ReservationController@unmergeSource', ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/reservations/:id/resolve-merge-alert', 'ReservationController@resolveMergeAlert', ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/reservations/:id/cancel',  'ReservationController@cancel',  ['permission' => 'reservation.cancel']);
$router->addRoute('POST', '/api/v1/reservations/:id/restore', 'ReservationController@restore', ['permission' => 'reservation.cancel']);

// ============================================================
// 部屋・清掃（スタッフ認証）
// ============================================================
$router->addRoute('GET', '/api/v1/rooms',                     'RoomController@index',              ['permission' => 'reservation.view']);
$router->addRoute('GET', '/api/v1/rooms/indicator',           'RoomController@indicator',           ['permission' => 'reservation.view']);
$router->addRoute('GET', '/api/v1/rooms/inventory',            'RoomController@inventory',            ['permission' => 'reservation.view']);
$router->addRoute('PUT', '/api/v1/rooms/:id/housekeeping',    'RoomController@updateHousekeeping',  ['permission' => 'housekeeping.update']);
$router->addRoute('GET',  '/api/v1/rooms/grid-config',       'RoomController@gridConfig',          ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/rooms/grid-config',       'RoomController@updateGridConfig',    ['permission' => 'master.edit']);
$router->addRoute('POST', '/api/v1/rooms/grid-layout',       'RoomController@updateGridLayout',    ['permission' => 'master.edit']);

// 清掃ボード（デバイストークン認証）
$router->addRoute('GET', '/api/v1/housekeeping',      'RoomController@housekeepingBoard',  ['device_auth' => true, 'auth' => false]);
$router->addRoute('PUT', '/api/v1/housekeeping/:id',  'RoomController@housekeepingUpdate', ['device_auth' => true, 'auth' => false]);

// ============================================================
// アサイン
// ============================================================
$router->addRoute('GET',    '/api/v1/assigns',             'AssignController@index',     ['permission' => 'assign.edit']);
$router->addRoute('POST',   '/api/v1/assigns',             'AssignController@store',     ['permission' => 'assign.edit']);
$router->addRoute('PUT',    '/api/v1/assigns/:id',         'AssignController@update',    ['permission' => 'assign.edit']);
$router->addRoute('DELETE', '/api/v1/assigns/:id',         'AssignController@destroy',   ['permission' => 'assign.edit']);
$router->addRoute('POST',   '/api/v1/assigns/:id/move',    'AssignController@moveRoom',  ['permission' => 'assign.edit']);
$router->addRoute('POST',   '/api/v1/assigns/:id/split',   'AssignController@splitMove', ['permission' => 'assign.edit']);

// ============================================================
// チェックイン・チェックアウト
// ============================================================
$router->addRoute('POST', '/api/v1/reservations/:id/checkin',  'CheckinController@checkin',  ['permission' => 'checkin.execute']);
$router->addRoute('POST', '/api/v1/reservations/:id/checkout', 'CheckinController@checkout', ['permission' => 'checkout.execute']);
// 複数室予約のグループ一括CI/CO
$router->addRoute('POST', '/api/v1/reservations/:id/group-checkin',  'CheckinController@groupCheckin',  ['permission' => 'checkin.execute']);
$router->addRoute('POST', '/api/v1/reservations/:id/group-checkout', 'CheckinController@groupCheckout', ['permission' => 'checkout.execute']);

// ============================================================
// ゲスト
// ============================================================
$router->addRoute('GET',  '/api/v1/guests',                       'GuestController@index',           ['permission' => 'guest.edit']);
// match は :id より先に定義（"match" が :id パラメータとして誤マッチするのを防ぐ）
$router->addRoute('GET',  '/api/v1/guests/match',                 'GuestController@matchCandidates', ['permission' => 'guest.edit']);
$router->addRoute('GET',  '/api/v1/guests/:id',                   'GuestController@show',            ['permission' => 'guest.edit']);
$router->addRoute('POST', '/api/v1/guests',                       'GuestController@store',           ['permission' => 'guest.edit']);
$router->addRoute('PUT',  '/api/v1/guests/:id',                   'GuestController@update',          ['permission' => 'guest.edit']);
$router->addRoute('POST', '/api/v1/guests/:id/merge',             'GuestController@merge',           ['permission' => 'guest.merge']);
$router->addRoute('POST', '/api/v1/reservations/:id/link-guest',  'GuestController@linkGuest',       ['permission' => 'guest.edit']);

// パスポート画像
$router->addRoute('POST',   '/api/v1/reservations/:id/passport',  'GuestController@uploadPassport',    ['permission' => 'guest.edit']);
$router->addRoute('DELETE', '/api/v1/passports/:id',               'GuestController@deletePassport',    ['permission' => 'guest.edit']);
$router->addRoute('GET',    '/api/v1/passports/:id/image',         'GuestController@servePassportImage', ['permission' => 'guest.edit']);

// ============================================================
// 帳票（領収書・請求書）
// ============================================================
$router->addRoute('POST', '/api/v1/documents/receipt',       'DocumentController@issueReceipt', ['permission' => 'receipt.issue']);
$router->addRoute('POST', '/api/v1/documents/invoice',       'DocumentController@issueInvoice', ['permission' => 'invoice.issue']);
// 即売の領収書（宿泊予約に紐づかない物販）。:id より前に置くこと（'sales-receipt' がIDとして解釈されないように）
$router->addRoute('POST', '/api/v1/documents/sales-receipt', 'DocumentController@issueSalesReceipt', ['permission' => 'receipt.issue']);
$router->addRoute('GET',  '/api/v1/documents/:id',           'DocumentController@show',         ['permission' => 'receipt.issue']);
$router->addRoute('GET',  '/api/v1/documents',               'DocumentController@index',        ['permission' => 'receipt.issue']);
$router->addRoute('POST', '/api/v1/documents/:id/reissue',   'DocumentController@reissue',      ['permission' => 'receipt.issue']);

// ============================================================
// マスタ管理
// ============================================================

// 部屋タイプ
$router->addRoute('GET',  '/api/v1/master/room-types',      'MasterController@roomTypes',      ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/master/room-types',      'MasterController@storeRoomType',  ['permission' => 'master.rooms']);
$router->addRoute('PUT',  '/api/v1/master/room-types/:id',  'MasterController@updateRoomType', ['permission' => 'master.rooms']);
$router->addRoute('POST', '/api/v1/master/room-types/reorder', 'MasterController@reorderRoomTypes', ['permission' => 'master.rooms']);

// 部屋
$router->addRoute('GET', '/api/v1/master/rooms',            'MasterController@rooms',      ['permission' => 'reservation.view']);
$router->addRoute('PUT', '/api/v1/master/rooms/:id',        'MasterController@updateRoom', ['permission' => 'master.rooms']);
$router->addRoute('POST', '/api/v1/master/rooms/reorder',  'MasterController@reorderRooms', ['permission' => 'master.rooms']);

// プラン
$router->addRoute('GET',  '/api/v1/master/plans',     'MasterController@plans',      ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/master/plans',     'MasterController@storePlan',   ['permission' => 'master.plans']);
$router->addRoute('PUT',  '/api/v1/master/plans/:id', 'MasterController@updatePlan',  ['permission' => 'master.plans']);

// 商品（物販）
// GET は物販の販売画面でも使うため reservation.view（プラン・決済方法と同じ扱い）
$router->addRoute('GET',  '/api/v1/master/products',         'MasterController@products',        ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/master/products',         'MasterController@storeProduct',    ['permission' => 'master.products']);
$router->addRoute('PUT',  '/api/v1/master/products/:id',     'MasterController@updateProduct',   ['permission' => 'master.products']);
$router->addRoute('POST', '/api/v1/master/products/reorder', 'MasterController@reorderProducts',  ['permission' => 'master.products']);

// 宿泊税
$router->addRoute('GET', '/api/v1/master/tax-rules',        'MasterController@taxRules',      ['permission' => 'reservation.view']);
$router->addRoute('PUT', '/api/v1/master/tax-rules/:id',    'MasterController@updateTaxRule', ['permission' => 'master.tax']);

// 法人
$router->addRoute('GET',  '/api/v1/master/corporates',      'MasterController@corporates',      ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/master/corporates',      'MasterController@storeCorporate',   ['permission' => 'master.corporate']);
$router->addRoute('PUT',  '/api/v1/master/corporates/:id',  'MasterController@updateCorporate', ['permission' => 'master.corporate']);

// スタッフ
$router->addRoute('GET',  '/api/v1/master/staff',                'MasterController@staff',      ['permission' => 'staff.manage']);
$router->addRoute('POST', '/api/v1/master/staff',                'MasterController@storeStaff', ['permission' => 'staff.manage']);
$router->addRoute('PUT',  '/api/v1/master/staff/:id',            'MasterController@updateStaff', ['permission' => 'staff.manage']);
$router->addRoute('POST', '/api/v1/master/staff/:id/reset-pin',  'MasterController@resetPin',   ['permission' => 'staff.pin_reset']);

// 権限
$router->addRoute('GET', '/api/v1/master/permissions',              'MasterController@permissions',            ['permission' => 'system.permissions']);
$router->addRoute('GET', '/api/v1/master/role-permissions/:role',   'MasterController@rolePermissions',        ['permission' => 'system.permissions']);
$router->addRoute('PUT', '/api/v1/master/role-permissions/:role',   'MasterController@updateRolePermissions',  ['permission' => 'system.permissions']);

// システム設定
$router->addRoute('GET', '/api/v1/master/settings',   'MasterController@settings',       ['permission' => 'system.session_config']);
$router->addRoute('PUT', '/api/v1/master/settings',   'MasterController@updateSettings', ['permission' => 'system.session_config']);

// 決済方法
$router->addRoute('GET',  '/api/v1/master/payment-methods',     'MasterController@paymentMethods',      ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/master/payment-methods',     'MasterController@storePaymentMethod',  ['permission' => 'master.plans']);
$router->addRoute('PUT',  '/api/v1/master/payment-methods/:id', 'MasterController@updatePaymentMethod', ['permission' => 'master.plans']);
$router->addRoute('POST', '/api/v1/master/payment-methods/reorder', 'MasterController@reorderPaymentMethods', ['permission' => 'master.plans']);

// チャネルマスタ
$router->addRoute('GET',  '/api/v1/master/channels',              'MasterController@channels',               ['permission' => 'reservation.view']);
$router->addRoute('POST', '/api/v1/master/channels',              'MasterController@storeChannel',           ['permission' => 'system.session_config']);
$router->addRoute('PUT',  '/api/v1/master/channels/:id',          'MasterController@updateChannel',          ['permission' => 'system.session_config']);
$router->addRoute('POST', '/api/v1/master/channels/remap-other',  'MasterController@remapOtherReservations', ['permission' => 'system.session_config']);

// ホテル基本情報
$router->addRoute('GET', '/api/v1/master/hotel-info', 'MasterController@hotelInfo',       ['permission' => 'system.session_config']);
$router->addRoute('PUT', '/api/v1/master/hotel-info', 'MasterController@updateHotelInfo', ['permission' => 'system.session_config']);

// ============================================================
// 物販（販売）
// ============================================================
$router->addRoute('POST', '/api/v1/product-sales',             'ProductSaleController@store',  ['permission' => 'product_sales.create']);
$router->addRoute('GET',  '/api/v1/product-sales',             'ProductSaleController@index',  ['permission' => 'product_sales.view']);
$router->addRoute('PUT',  '/api/v1/product-sales/:id/cancel',  'ProductSaleController@cancel', ['permission' => 'product_sales.create']);


// ============================================================
// TL取込
// ============================================================
$router->addRoute('POST', '/api/v1/tl-import/process', 'TlImportController@process', ['permission' => 'reservation.create']);
$router->addRoute('GET',  '/api/v1/tl-import/logs',    'TlImportController@logs',    ['permission' => 'reservation.view']);


// ============================================================
// 売上・レポート
// ============================================================
$router->addRoute('GET', '/api/v1/reports/daily',     'ReportController@daily',     ['permission' => 'report.view']);
$router->addRoute('GET', '/api/v1/reports/products',  'ReportController@products',  ['permission' => 'report.view']);
$router->addRoute('GET', '/api/v1/reports/income-pdf', 'ReportController@incomePdf', ['permission' => 'report.export']);
