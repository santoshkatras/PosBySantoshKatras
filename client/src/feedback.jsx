import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import './feedback.css';

// App-wide confirmations ("Do you want to edit this?") and result pop-ups ("Item saved successfully").
// confirm() resolves true / false; success() / failure() show a pop-up that closes itself; toast() is a small note.

const FeedbackContext = createContext(null);

const ICONS = {
  question: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  danger: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  success: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  error: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
};

function Icon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name] || ICONS.info} /></svg>;
}

export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const resolver = useRef(null);
  const timer = useRef(null);

  const close = useCallback((value) => {
    clearTimeout(timer.current);
    setDialog(null);
    const done = resolver.current;
    resolver.current = null;
    done?.(value);
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    const opts = typeof options === 'string' ? { message: options } : options || {};
    resolver.current?.(false);
    resolver.current = resolve;
    setDialog({ kind: 'confirm', tone: opts.tone || 'question', title: opts.title || 'Please confirm', message: opts.message || 'Do you want to continue?', confirmLabel: opts.confirmLabel || 'Yes', cancelLabel: opts.cancelLabel || 'No', detail: opts.detail || '' });
  }), []);

  const result = useCallback((kind, options) => new Promise((resolve) => {
    const opts = typeof options === 'string' ? { message: options } : options || {};
    resolver.current?.(false);
    resolver.current = resolve;
    setDialog({ kind, tone: kind, title: opts.title || (kind === 'success' ? 'Success' : 'Something went wrong'), message: opts.message || '', detail: opts.detail || '' });
    clearTimeout(timer.current);
    if (kind === 'success' && opts.autoClose !== false) timer.current = setTimeout(() => close(true), opts.duration || 2200);
  }), [close]);

  const toast = useCallback((text, tone = 'success') => {
    const id = `${Date.now()}${Math.random()}`;
    setToasts((rows) => [...rows.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((rows) => rows.filter((row) => row.id !== id)), 3200);
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const key = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(false); }
      if (event.key === 'Enter') { event.stopPropagation(); event.preventDefault(); close(true); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [dialog, close]);

  const value = useMemo(() => ({
    confirm,
    success: (options) => result('success', options),
    failure: (options) => result('error', options),
    toast,
  }), [confirm, result, toast]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {dialog ? (
        <div className="fb-back" onMouseDown={() => close(false)}>
          <div className={`fb-card ${dialog.tone}`} role={dialog.kind === 'confirm' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={dialog.title} onMouseDown={(event) => event.stopPropagation()}>
            <span className="fb-icon"><Icon name={dialog.tone} /></span>
            <h3>{dialog.title}</h3>
            {dialog.message ? <p>{dialog.message}</p> : null}
            {dialog.detail ? <small>{dialog.detail}</small> : null}
            <div className="fb-actions">
              {dialog.kind === 'confirm' ? (
                <>
                  <button type="button" className="fb-btn" onClick={() => close(false)}>{dialog.cancelLabel}</button>
                  <button type="button" className={`fb-btn primary ${dialog.tone === 'danger' ? 'danger' : ''}`} autoFocus onClick={() => close(true)}>{dialog.confirmLabel}</button>
                </>
              ) : <button type="button" className="fb-btn primary" autoFocus onClick={() => close(true)}>OK</button>}
            </div>
            {dialog.kind === 'success' ? <i className="fb-bar" /> : null}
          </div>
        </div>
      ) : null}
      <div className="fb-toasts" aria-live="polite">
        {toasts.map((row) => <div key={row.id} className={`fb-toast ${row.tone}`}><Icon name={row.tone === 'error' ? 'error' : row.tone === 'info' ? 'info' : 'success'} /><span>{row.text}</span></div>)}
      </div>
    </FeedbackContext.Provider>
  );
}

const FALLBACK = {
  confirm: async (options) => window.confirm(typeof options === 'string' ? options : options?.message || 'Continue?'),
  success: async () => true,
  failure: async () => true,
  toast: () => {},
};

export function useFeedback() {
  return useContext(FeedbackContext) || FALLBACK;
}
