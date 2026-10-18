import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 二次确认对话框（不用浏览器自带的 confirm，手机上体验更好，也方便测试） */
export function ConfirmDialog({
  title,
  children,
  confirmText = '确定',
  cancelText = '取消',
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        data-testid="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title">{title}</h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} data-testid="confirm-cancel">
            {cancelText}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            data-testid="confirm-ok"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
