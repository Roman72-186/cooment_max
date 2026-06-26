import { useAppStore } from '../store/useAppStore';

export function ConfirmDialog() {
  const req = useAppStore((s) => s.confirmRequest);
  const resolveConfirm = useAppStore((s) => s.resolveConfirm);

  if (!req) return null;

  return (
    <div className="confirm-overlay" onClick={resolveConfirm}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog__msg">{req.message}</p>
        <div className="confirm-dialog__btns">
          <button className="btn btn--ghost" onClick={resolveConfirm}>
            Отмена
          </button>
          <button
            className={`btn ${req.variant === 'danger' ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => { req.onConfirm(); resolveConfirm(); }}
          >
            {req.confirmLabel ?? 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
}