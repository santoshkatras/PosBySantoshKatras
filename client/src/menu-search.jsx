import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV } from '../../shared/domain.mjs';
import { useAuth } from './auth.jsx';
import './menu-search.css';

// Search every menu the user can open and jump to it. Ctrl+K (or the configured shortcut) focuses it.

function allowed(item, session) {
  if (!item || item.heading) return false;
  if (item.feature && !session.modules.some((module) => module.key === item.feature && module.enabled)) return false;
  return session.user.permissions.includes(item.permission);
}

export function menuEntries(session) {
  const rows = [];
  for (const item of NAV) {
    if (item.children) {
      for (const child of item.children) if (allowed(child, session)) rows.push({ id: child.id, label: child.label, group: item.label, href: child.href, ready: child.ready });
    } else if (allowed(item, session)) rows.push({ id: item.id, label: item.label, group: 'Main', href: item.href, ready: item.ready });
  }
  return rows;
}

export function MenuSearch({ className = '' }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const list = useRef(null);
  const entries = useMemo(() => (session ? menuEntries(session) : []), [session]);
  const q = text.trim().toLowerCase();
  const matches = (q ? entries.filter((row) => `${row.label} ${row.group}`.toLowerCase().includes(q)) : entries).slice(0, 12);

  useEffect(() => {
    const focus = () => { box.current?.focus(); box.current?.select(); setOpen(true); };
    window.addEventListener('skpos:menu-search', focus);
    return () => window.removeEventListener('skpos:menu-search', focus);
  }, []);
  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function go(row) {
    setText(''); setOpen(false); box.current?.blur();
    navigate(row.href);
  }
  function key(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, matches.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (matches[active]) go(matches[active]); }
    else if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); box.current?.blur(); }
  }
  const mark = (label) => {
    if (!q) return label;
    const at = label.toLowerCase().indexOf(q);
    if (at < 0) return label;
    return <>{label.slice(0, at)}<mark>{label.slice(at, at + q.length)}</mark>{label.slice(at + q.length)}</>;
  };

  return (
    <div className={`ms ${className}`}>
      <svg className="ms-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" /></svg>
      <input
        ref={box}
        value={text}
        placeholder="Search menu…"
        aria-label="Search menu"
        onChange={(event) => { setText(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={key}
      />
      <kbd>Ctrl K</kbd>
      {open ? (
        <div className="ms-drop" ref={list} role="listbox">
          {matches.length ? matches.map((row, index) => (
            <button type="button" key={row.id} role="option" aria-selected={index === active} className={index === active ? 'on' : undefined} onMouseDown={(event) => { event.preventDefault(); go(row); }} onMouseEnter={() => setActive(index)}>
              <strong>{mark(row.label)}</strong>
              <span>{row.group}{row.ready === false ? ' · soon' : ''}</span>
            </button>
          )) : <p>No menu matches “{text}”.</p>}
        </div>
      ) : null}
    </div>
  );
}
