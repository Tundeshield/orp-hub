import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { friendlyError } from '../lib/db.js';

export function Button({ variant = 'primary', size, busy, children, className = '', ...rest }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner sm" aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children, full, as: Tag = 'label' }) {
  return (
    <Tag className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </Tag>
  );
}

const TONES = {
  pending: 'amber', clarification: 'amber', revision: 'amber', submitted: 'blue', approved: 'blue',
  partly_paid: 'violet', paid: 'green', closed: 'grey', rejected: 'red', cancelled: 'grey',
  reviewed: 'green', overdue: 'red', booked: 'blue', open: 'green', blocked: 'grey', completed: 'green',
  rescheduled: 'grey', no_show: 'red', todo: 'grey', in_progress: 'blue', done: 'green',
  high: 'red', medium: 'amber', low: 'grey', new: 'amber', praying: 'blue', answered: 'green', shared: 'green',
};

export function Badge({ status, children, tone }) {
  return <span className={`badge tone-${tone || TONES[status] || 'grey'}`}>{children || String(status || '').replace(/_/g, ' ')}</span>;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><span className="spinner" aria-hidden /> {label}</div>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="error-note" role="alert">{typeof error === 'string' ? error : friendlyError(error)}</div>;
}

export function Modal({ open, title, onClose, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value}
          className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}{typeof t.count === 'number' && t.count > 0 ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// Runs an async action with busy + error state, and toasts success.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn, successMsg) => {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      if (successMsg) toast(successMsg);
      return r ?? true;
    } catch (e) {
      console.error(e);
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, error, setError, run };
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg) => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, msg }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, children }) {
  const { busy, error, run } = useAction();
  return (
    <Modal open={open} title={title} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Back</Button>
        <Button variant={danger ? 'danger' : 'primary'} busy={busy}
          onClick={async () => { if (await run(onConfirm)) onClose(); }}>{confirmLabel}</Button>
      </>}>
      {message && <p>{message}</p>}
      {children}
      <ErrorNote error={error} />
    </Modal>
  );
}
