import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from './api.js';
import { useAuth } from './auth.jsx';
import './service.css';

export function inr(value, digits = 0) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value) || 0);
}

export function inr2(value) {
  return inr(value, 2);
}

export function dt(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function day(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function km(value) {
  if (value == null || value === '') return '—';
  return `${new Intl.NumberFormat('en-IN').format(Number(value))} km`;
}

export function since(value, nowMs = Date.now()) {
  if (!value) return '—';
  const mins = Math.max(0, Math.round((nowMs - new Date(value).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function until(value, nowMs = Date.now()) {
  if (!value) return '';
  const diff = new Date(value).getTime() - nowMs;
  const text = since(new Date(nowMs - Math.abs(diff)).toISOString(), nowMs);
  return diff < 0 ? `${text} late` : `in ${text}`;
}

export function daysFromToday(dateText) {
  if (!dateText) return null;
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  return Math.round((new Date(dateText.slice(0, 10)).getTime() - today) / 86400000);
}

export function errorText(error) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

export function waLink(mobile, text) {
  const digits = String(mobile || '').replace(/\D/g, '').slice(-10);
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
}

export function Plate({ value, type, small }) {
  return (
    <span className={`plate${small ? ' small' : ''}`} title={type === 'car' ? 'Car' : 'Bike'}>
      <span className="plate-ind">IND</span>
      <span className="plate-no">{value || '—'}</span>
    </span>
  );
}

export function VehicleIcon({ type, size = 18 }) {
  if (type === 'car') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Car">
        <path d="M5 16H3v-4l2-5h14l2 5v4h-2M5 16a2 2 0 1 0 4 0 2 2 0 0 0-4 0zm10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 16h6M4 12h16" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Bike">
      <path d="M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm14 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 15l4-6h5l3 6M12 9l-1-3h3M14 9h3" />
    </svg>
  );
}

const STATUS_TONE = {
  checked_in: 'grey', awaiting_approval: 'amber', approved: 'blue', in_progress: 'violet', waiting_parts: 'orange', qc: 'teal', ready: 'green', delivered: 'ink', cancelled: 'red',
};

export function StatusPill({ status, label }) {
  return <span className={`svc-pill ${STATUS_TONE[status] || 'grey'}`}>{label || status}</span>;
}

export function CustomerLink({ customer, className }) {
  const { can } = useAuth();
  if (!customer) return <span>—</span>;
  if (!can('customers.view')) return <span className={className}>{customer.name}</span>;
  return (
    <Link className={`cust-link ${className || ''}`} to={`/customers/${customer.id}`} onClick={(event) => event.stopPropagation()} title="Open customer history">
      {customer.name}
    </Link>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    function key(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal-card svc-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <h2>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Re-render every `ms` so elapsed timers tick.
export function useNow(ms = 30000) {
  const [nowMs, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return nowMs;
}

// Live updates from the workshop. Calls onChange when any job changes; falls back to polling.
export function useLive(onChange, { poll = 60000 } = {}) {
  const [live, setLive] = useState(false);
  const [stamp, setStamp] = useState(Date.now());
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    let source = null;
    let retry = null;
    let debounce = null;
    let closed = false;
    function fire() {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        setStamp(Date.now());
        handler.current?.();
      }, 250);
    }
    function connect() {
      if (closed || typeof EventSource === 'undefined') return;
      const token = sessionStorage.getItem('sk_access');
      if (!token) return;
      source = new EventSource(`/api/service/stream?token=${encodeURIComponent(token)}`);
      source.onopen = () => setLive(true);
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'hello') fire();
        } catch { /* ignore */ }
      };
      source.onerror = () => {
        setLive(false);
        source?.close();
        clearTimeout(retry);
        retry = setTimeout(connect, 5000);
      };
    }
    connect();
    const timer = setInterval(fire, poll);
    return () => {
      closed = true;
      source?.close();
      clearTimeout(retry);
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [poll]);
  return { live, stamp };
}

export function LiveBadge({ live, stamp }) {
  const nowMs = useNow(10000);
  return (
    <span className={`live-badge${live ? ' on' : ''}`} title={live ? 'Receiving live updates' : 'Reconnecting — refreshing every minute'}>
      <i />{live ? 'Live' : 'Offline'} · updated {since(new Date(stamp).toISOString(), nowMs)} ago
    </span>
  );
}

export function useLoader(loader, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setData(await loader());
      setError('');
    } catch (err) {
      setError(errorText(err));
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload, setData };
}

export function Field({ label, children, hint, wide }) {
  return (
    <label className={`svc-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Stars({ value }) {
  if (!value) return null;
  return <span className="stars" aria-label={`${value} of 5`}>{'★'.repeat(Math.round(value))}<em>{'★'.repeat(5 - Math.round(value))}</em></span>;
}
