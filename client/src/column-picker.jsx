import { useEffect, useLayoutEffect, useRef, useState } from 'react';

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />
      <path d="M19.4 13a7.7 7.7 0 0 0 .1-2l2-1.5-2-3.4-2.3.8a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.5 2.4a7.6 7.6 0 0 0-1.7 1l-2.3-.8-2 3.4 2 1.5a7.7 7.7 0 0 0 .1 2l-2 1.5 2 3.4 2.3-.8a7.6 7.6 0 0 0 1.7 1l.5 2.4h4l.5-2.4a7.6 7.6 0 0 0 1.7-1l2.3.8 2-3.4z" />
    </svg>
  );
}

// Gear button for a table header cell. Opens a list of columns to show or hide.
// columns: [[id, label]], value: [ids], defaults: [ids]
export function ColumnPicker({ columns, value, onChange, defaults }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef(null);
  const panel = useRef(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = 240;
    setPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (panel.current?.contains(event.target) || button.current?.contains(event.target)) return;
      setOpen(false);
    }
    function key(event) { if (event.key === 'Escape') setOpen(false); }
    function away() { setOpen(false); }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  function toggle(id) {
    if (value.includes(id)) {
      if (value.length === 1) return; // keep at least one column
      onChange(value.filter((item) => item !== id));
    } else {
      onChange(columns.map(([key]) => key).filter((key) => key === id || value.includes(key)));
    }
  }

  return (
    <>
      <button ref={button} type="button" className={open ? 'col-gear on' : 'col-gear'} aria-label="Choose columns" aria-expanded={open} title="Choose columns" onClick={(event) => { event.stopPropagation(); setOpen((now) => !now); }}>
        <GearIcon />
      </button>
      {open ? (
        <div ref={panel} className="col-panel" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label="Columns">
          <header>
            <strong>Columns</strong>
            <span>{value.length} of {columns.length}</span>
          </header>
          <div className="col-list">
            {columns.map(([id, label]) => (
              <label key={id}>
                <input type="checkbox" checked={value.includes(id)} onChange={() => toggle(id)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <footer>
            <button type="button" onClick={() => onChange(columns.map(([id]) => id))}>Show all</button>
            {defaults ? <button type="button" onClick={() => onChange(defaults)}>Reset to default</button> : null}
          </footer>
        </div>
      ) : null}
    </>
  );
}

// Per-browser memory of chosen columns, so a reload keeps them.
export function useColumns(key, defaults) {
  const [value, setValue] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`sk_cols_${key}`) || 'null');
      return Array.isArray(saved) && saved.length ? saved : defaults;
    } catch {
      return defaults;
    }
  });
  function update(next) {
    setValue(next);
    try { localStorage.setItem(`sk_cols_${key}`, JSON.stringify(next)); } catch { /* storage off */ }
  }
  return [value, update];
}
