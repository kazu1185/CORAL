const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8080/api/v1';

let logoutCallback = null;

export function setLogoutCallback(fn) {
  logoutCallback = fn;
}

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('pms_token');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_staff');
    if (logoutCallback) logoutCallback();
    throw new ApiError('セッションが切れました。再ログインしてください', 401);
  }

  if (response.status === 403) {
    throw new ApiError('この操作を行う権限がありません', 403);
  }

  // 楽観ロック競合: 他スタッフが先に更新した場合（409 Conflict）
  if (response.status === 409) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      data.error || 'この予約は別のスタッフによって更新されています。画面を再読み込みしてください。',
      409
    );
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(data.error || 'エラーが発生しました', response.status, data.details);
  }

  return data;
}

export class ApiError extends Error {
  constructor(message, status, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * ファイルアップロード用リクエスト
 * FormData送信時はContent-Typeを設定しない（ブラウザがmultipart/form-dataを自動設定）
 */
export async function apiUpload(path, formData) {
  const token = localStorage.getItem('pms_token');
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (response.status === 401) {
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_staff');
    if (logoutCallback) logoutCallback();
    throw new ApiError('セッションが切れました。再ログインしてください', 401);
  }

  if (response.status === 403) {
    throw new ApiError('この操作を行う権限がありません', 403);
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(data.error || 'エラーが発生しました', response.status, data.details);
  }

  return data;
}

/**
 * PDFなどのバイナリファイルをダウンロードする
 * 認証トークン付きでfetchし、Blob URLを生成してブラウザのダウンロードを発火
 */
export async function apiDownload(path, filename) {
  const token = localStorage.getItem('pms_token');
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (response.status === 401) {
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_staff');
    if (logoutCallback) logoutCallback();
    throw new ApiError('セッションが切れました。再ログインしてください', 401);
  }

  if (!response.ok) {
    // エラーレスポンスがJSONの場合はパースして投げる
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || 'ダウンロードに失敗しました', response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * PDFなどのバイナリを Blob として取得する（ダウンロードは発火しない）。
 * フロントモードのアプリ内PDFプレビュー（iframe表示＋印刷）で使用する。
 * iPad standalone PWA では <a download> がトラップになりやすいため、
 * 呼び出し側で objectURL を作って画面内の iframe に表示する用途。
 * objectURL の解放（URL.revokeObjectURL）は呼び出し側の責務。
 */
export async function apiFetchBlob(path) {
  const token = localStorage.getItem('pms_token');
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (response.status === 401) {
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_staff');
    if (logoutCallback) logoutCallback();
    throw new ApiError('セッションが切れました。再ログインしてください', 401);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || 'ファイルの取得に失敗しました', response.status);
  }
  return response.blob();
}

// 便利メソッド
export const api = {
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => apiRequest(path, { method: 'DELETE' }),
  upload: (path, formData) => apiUpload(path, formData),
  download: (path, filename) => apiDownload(path, filename),
  fetchBlob: (path) => apiFetchBlob(path),
};
