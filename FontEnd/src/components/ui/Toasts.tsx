import { useCallback, useRef, useState } from 'react';

/**
 * Lightweight toast notifications shared by the dashboards.
 *
 * Usage:
 *   const { toasts, notify, dismiss } = useToasts();
 *   notify('success', 'Payment confirmed.');
 *   ...
 *   <ToastViewport toasts={toasts} onDismiss={dismiss} />
 *
 * Styling leans on the app's CSS variables so it follows the active theme.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const AUTO_DISMISS_MS = 4500;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  return { toasts, notify, dismiss };
}

const KIND_COLOR: Record<ToastKind, string> = {
  success: 'var(--primary)',
  error: 'var(--danger)',
  info: 'var(--accent)',
};

const KIND_ICON: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

export function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <>
      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', bottom: '1.4rem', right: '1.4rem', zIndex: 200,
          display: 'flex', flexDirection: 'column', gap: '0.55rem', maxWidth: 380,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
              padding: '0.75rem 0.9rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderLeft: `3px solid ${KIND_COLOR[t.kind]}`,
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-lg)',
              animation: 'toastIn 0.25s ease both',
            }}
          >
            <span aria-hidden="true" style={{ color: KIND_COLOR[t.kind], fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.4 }}>
              {KIND_ICON[t.kind]}
            </span>
            <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {t.message}
            </span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', fontSize: '0.78rem', lineHeight: 1.4, padding: 0,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
