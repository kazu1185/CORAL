import { useState, useRef } from 'react';
import { api } from '../api/client';

/**
 * マスタ設定のドラッグ&ドロップ並び替え共通フック
 *
 * 決済方法・部屋タイプ・部屋の各設定ページで95%同一の実装が
 * コピペされていたため集約した（規約 #15: 重複コード禁止）。
 *
 * ハンドラには id ではなく行のオブジェクトそのものを渡す
 * （部屋設定の「同一フロア内のみ移動可」のようなグループ制約を sameGroup で判定するため）。
 *
 * @param {object} params
 *   - items / setItems: 並び替え対象の配列とそのsetter（楽観更新に使用）
 *   - endpoint:  並び順保存API（例: '/master/rooms/reorder'）
 *   - onError:   保存失敗時にエラーメッセージを受け取るハンドラ
 *   - refetch:   保存失敗時に表示を元へ戻すための再取得関数
 *   - sameGroup: (dragItem, overItem) => boolean。同一グループ内のみ移動を許可する判定。省略時は無制限
 *   - orderIds:  (newItems, moved) => id[]。APIに送るID配列の組み立て。省略時は全件
 *                （部屋設定は移動した部屋と同じフロアのIDのみ送るため差し替える）
 */
export function useDragReorder({
  items,
  setItems,
  endpoint,
  onError,
  refetch,
  sameGroup = () => true,
  orderIds = (newItems) => newItems.map(i => i.id),
}) {
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragNode = useRef(null);

  const handleDragStart = (e, item) => {
    setDragId(item.id);
    dragNode.current = e.currentTarget;
    // ドラッグ開始時に半透明にする（次フレームで適用しないとドラッグ画像に影響）
    requestAnimationFrame(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4';
    });
  };

  const handleDragOver = (e, item) => {
    e.preventDefault(); // ドロップ可能にする
    const dragItem = items.find(i => i.id === dragId);
    if (dragItem && sameGroup(dragItem, item) && item.id !== dragOverId) {
      setDragOverId(item.id);
    }
  };

  const handleDragEnd = async () => {
    if (dragNode.current) dragNode.current.style.opacity = '1';
    dragNode.current = null;

    // 並び順が変わった場合のみAPIに保存
    if (dragId !== null && dragOverId !== null && dragId !== dragOverId) {
      const newItems = [...items];
      const fromIdx = newItems.findIndex(i => i.id === dragId);
      const toIdx = newItems.findIndex(i => i.id === dragOverId);

      if (fromIdx !== -1 && toIdx !== -1 && sameGroup(newItems[fromIdx], newItems[toIdx])) {
        const [moved] = newItems.splice(fromIdx, 1);
        newItems.splice(toIdx, 0, moved);
        setItems(newItems); // 楽観更新（先に画面へ反映）

        try {
          await api.post(endpoint, { order: orderIds(newItems, moved) });
        } catch (e) {
          // 失敗時は再取得して表示を元に戻す
          onError?.(e.message);
          refetch?.();
        }
      }
    }
    setDragId(null);
    setDragOverId(null);
  };

  return { dragId, dragOverId, handleDragStart, handleDragEnd, handleDragOver };
}
