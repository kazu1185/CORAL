import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';

/**
 * マスタ設定ページのCRUD共通フック
 *
 * 一覧取得 / 追加・編集の保存 / 有効・無効トグル の3点セットが
 * 設定ページ（決済方法・部屋タイプ・プラン・法人・チャネル・スタッフ）で
 * ほぼ同一のコピペになっていたため集約した（規約 #15: 重複コード禁止）。
 *
 * ページ固有の事前チェック（例: 自分自身の無効化禁止、'other'チャネルの無効化禁止）は
 * 呼び出し側で toggleActive をラップして実装する。
 *
 * @param {string} endpoint APIパス（例: '/master/payment-methods'）
 * @param {object} options
 *   - listKey:    レスポンス内の一覧キー（例: 'payment_methods'）
 *   - query:      一覧取得時のクエリ文字列（例: 'all=1'。設定画面は非アクティブも表示するため）
 *   - labelOf:    トグル確認ダイアログに表示する名称を返す関数（item => item.method_name）
 *   - toggleNote: 無効化確認に付け足す注意文（任意。無効化時のみ表示）
 */
export function useMasterCrud(endpoint, { listKey, query = '', labelOf, toggleNote = '' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const { confirm } = useConfirm();

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`${endpoint}${query ? `?${query}` : ''}`);
      setItems(res[listKey] || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, query, listKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 有効/無効トグル（確認ダイアログ付き・論理削除のためDELETEは使わない）
  const toggleActive = async (item) => {
    const action = item.is_active ? '無効化' : '有効化';
    const note = item.is_active && toggleNote ? `\n${toggleNote}` : '';
    const ok = await confirm(`${action}確認`, `「${labelOf(item)}」を${action}しますか？${note}`);
    if (!ok) return;

    try {
      await api.put(`${endpoint}/${item.id}`, { is_active: item.is_active ? 0 : 1 });
      fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  // 追加(POST) / 編集(PUT) の共通保存
  // エラー時はメッセージを「返す」（モーダル側がフォーム内にエラー表示するための既存規約）
  const save = async (data) => {
    try {
      if (data.id) {
        await api.put(`${endpoint}/${data.id}`, data);
      } else {
        await api.post(endpoint, data);
      }
      setModal(null);
      fetchData();
    } catch (e) {
      return e.message;
    }
  };

  return { items, setItems, loading, error, setError, modal, setModal, fetchData, toggleActive, save };
}
