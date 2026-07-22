import { createContext, useContext, useState, useCallback } from 'react';
import './ConfirmDialog.css';

/**
 * 共通ダイアログ
 * window.confirm() / alert() / prompt() の代替として全画面で使用
 * ブラウザ標準ダイアログは使用禁止（コーディング規約 #14）
 *
 * 使い方:
 *   const { confirm, alert, prompt } = useConfirm();
 *   const ok = await confirm('移動しますか？', '301号室 → 403号室に移動します');
 *   await alert('保存しました');
 *   const value = await prompt('日付入力', '分割日を選択してください', { inputType: 'date', defaultValue: '2026-04-16' });
 */

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback((title, message, options = {}) => {
    return new Promise((resolve) => {
      setDialog({
        title,
        message,
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'キャンセル',
        confirmColor: options.confirmColor || 'blue',
        showCancel: true,
        resolve,
      });
    });
  }, []);

  const alert = useCallback((title, message) => {
    return new Promise((resolve) => {
      setDialog({
        title,
        message,
        confirmLabel: 'OK',
        confirmColor: 'blue',
        showCancel: false,
        resolve,
      });
    });
  }, []);

  // prompt: 入力フィールド付きダイアログ。入力値を返す（キャンセル時はnull）
  // options: { inputType, defaultValue, min, max, placeholder, hint, confirmLabel, confirmColor }
  const prompt = useCallback((title, message, options = {}) => {
    return new Promise((resolve) => {
      setDialog({
        title,
        message,
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'キャンセル',
        confirmColor: options.confirmColor || 'blue',
        showCancel: true,
        isPrompt: true,
        inputType: options.inputType || 'text',
        inputValue: options.defaultValue || '',
        inputMin: options.min,
        inputMax: options.max,
        placeholder: options.placeholder || '',
        hint: options.hint || '',
        resolve,
      });
    });
  }, []);

  const handleClose = (result) => {
    if (dialog?.isPrompt) {
      // prompt: trueならinputValueを返し、falseならnullを返す
      dialog.resolve(result ? dialog.inputValue : null);
    } else {
      dialog?.resolve(result);
    }
    setDialog(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      {dialog && (
        <>
          <div className="cd__overlay" onClick={() => dialog.showCancel && handleClose(false)} />
          <div className="cd__dialog">
            <h3 className="cd__title">{dialog.title}</h3>
            {dialog.message && <p className="cd__message">{dialog.message}</p>}
            {dialog.isPrompt && (
              <div className="cd__input-wrap">
                <input
                  type={dialog.inputType}
                  className="cd__input"
                  value={dialog.inputValue}
                  onChange={(e) => setDialog(prev => ({ ...prev, inputValue: e.target.value }))}
                  min={dialog.inputMin}
                  max={dialog.inputMax}
                  placeholder={dialog.placeholder}
                  autoFocus
                />
                {dialog.hint && <span className="cd__hint">{dialog.hint}</span>}
              </div>
            )}
            <div className="cd__actions">
              {dialog.showCancel && (
                <button className="cd__btn cd__btn--cancel" onClick={() => handleClose(false)}>
                  {dialog.cancelLabel}
                </button>
              )}
              <button
                className={`cd__btn cd__btn--confirm cd__btn--${dialog.confirmColor}`}
                onClick={() => handleClose(true)}
                autoFocus={!dialog.isPrompt}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm は ConfirmProvider 内で使用してください');
  }
  return context;
}
