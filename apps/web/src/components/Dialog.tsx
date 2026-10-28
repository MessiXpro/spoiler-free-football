import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface Props {
  title: string;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 弹层共用的键盘/读屏行为：打开时焦点进弹层（initialFocus 或弹层内第一个可聚焦元素），
 * Esc 关闭，Tab 在弹层内循环，关闭后焦点还给打开它的按钮。
 */
function useModalFocus(
  dialogRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  // 父组件每分钟重渲染（时钟）时 onClose 是新函数：不能因此把焦点再拉回去
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // 打开时焦点进对话框，关闭时还给原来的按钮（键盘和读屏用户不会"丢"在页面某处）
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      // Tab 在对话框内循环，不跑到后面的页面上
      if (e.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (el) => !el.hasAttribute('disabled'),
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // 两个都是 ref 对象，不会变：只在打开时跑一次
  }, [dialogRef, initialFocus]);
}

/** 通用弹层（直播模式说明等）：有标题，Esc/焦点处理和 ConfirmDialog 一样 */
export function Modal({
  title,
  children,
  onClose,
  testId,
}: {
  title: string;
  children?: ReactNode;
  onClose: () => void;
  testId?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onCancel, confirmRef);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
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
