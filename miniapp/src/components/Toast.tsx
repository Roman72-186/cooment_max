import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number; // ms, default 3000; 0 = persistent
  action?: { label: string; onClick: () => void };
}

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);

  return (
    <div className="toast-container" aria-live="polite" role="status">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Ошибки держим дольше по умолчанию — текст непредсказуемой длины приходит от сервера
  const defaultDuration = toast.type === 'error' ? 5500 : 3000;

  useEffect(() => {
    if (toast.duration === 0) return;
    const timer = setTimeout(() => {
      ref.current?.classList.add('toast--exit');
      setTimeout(() => onRemove(toast.id), 180);
    }, toast.duration ?? defaultDuration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, defaultDuration, onRemove]);

  const icon = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' }[toast.type];

  return (
    <div ref={ref} className={`toast toast--${toast.type}`} role={toast.type === 'error' ? 'alert' : undefined}>
      <span className="toast__icon" aria-hidden="true">{icon}</span>
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button className="toast__action" onClick={() => { toast.action!.onClick(); onRemove(toast.id); }}>
          {toast.action.label}
        </button>
      )}
      <button className="toast__close" onClick={() => onRemove(toast.id)} aria-label="Закрыть уведомление">
        ✕
      </button>
    </div>
  );
}