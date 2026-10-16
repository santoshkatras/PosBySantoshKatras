import { useEffect, useRef, useState } from 'react';
import './search-select.css';

function createRow(query, options, allowCreate) {
  const typed = query.trim();
  if (!allowCreate || !typed) return false;
  return !options.some((option) => option.label.toLowerCase() === typed.toLowerCase());
}

function useActive(length) {
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  useEffect(() => {
    setActive(0);
  }, [length]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, length]);
  return { active, setActive, listRef };
}

function moveActive(event, length, active, setActive, pick) {
  if (event.key === 'Escape') {
    event.preventDefault();
    return 'close';
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (length) setActive((index) => Math.min(length - 1, index + 1));
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (length) setActive((index) => Math.max(0, index - 1));
    return true;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (length) pick(Math.min(active, length - 1));
    return true;
  }
  return false;
}

export function SearchSelect({ value, onChange, options, placeholder = 'Choose', required = false, allowCreate = false, onCreate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.id === value);
  const shown = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const canCreate = createRow(query, options, allowCreate);
  const rows = canCreate ? [...shown, { id: '__create', label: `Create “${query.trim()}”` }] : shown;
  const { active, setActive, listRef } = useActive(open ? rows.length : 0);

  function pick(index) {
    const row = rows[index];
    if (!row) return;
    if (row.id === '__create') onCreate?.(query.trim());
    else onChange(row.id);
    setOpen(false);
  }

  return (
    <div className="search-select">
      <input
        required={required}
        value={open ? query : (selected?.label || '')}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          const moved = moveActive(event, rows.length, active, setActive, pick);
          if (moved === 'close') setOpen(false);
        }}
      />
      {open ? (
        <ul ref={listRef}>
          {rows.map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                data-active={index === active}
                className={index === active ? 'on' : undefined}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(index);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
          {!rows.length ? <li className="empty">No matches</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function ChipSelect({ values = [], onChange, options, placeholder = 'Choose', required = false, allowCreate = false, onCreate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);
  const selected = options.filter((option) => values.includes(option.id));
  const shown = options.filter((option) => !values.includes(option.id) && option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const canCreate = createRow(query, options, allowCreate);
  const rows = canCreate ? [...shown, { id: '__create', label: `Create “${query.trim()}”` }] : shown;
  const { active, setActive, listRef } = useActive(open ? rows.length : 0);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function add(id) {
    if (!values.includes(id)) onChange([...values, id]);
    setQuery('');
  }

  function pick(index) {
    const row = rows[index];
    if (!row) return;
    if (row.id === '__create') onCreate?.(query.trim());
    else add(row.id);
  }

  return (
    <div className="chip-select" ref={boxRef}>
      <div className="chip-box" onClick={() => setOpen(true)}>
        <div className="chip-scroll">
          {selected.map((option) => (
            <span className="chip" key={option.id}>
              {option.label}
              <i
                role="button"
                aria-label={`Remove ${option.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(values.filter((id) => id !== option.id));
                }}
              >×</i>
            </span>
          ))}
          {!selected.length ? <span className="chip-placeholder">{placeholder}</span> : null}
        </div>
        {selected.length ? <span className="chip-count">{selected.length}</span> : null}
        <span className="chip-caret" aria-hidden="true">▾</span>
      </div>
      <input className="chip-required" tabIndex={-1} required={required} value={values.join(',')} onChange={() => {}} />
      {open ? (
        <div className="chip-menu">
          <input
            autoFocus
            value={query}
            placeholder="Search or type a new value"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const moved = moveActive(event, rows.length, active, setActive, pick);
              if (moved === 'close') setOpen(false);
            }}
          />
          <ul ref={listRef}>
            {rows.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  data-active={index === active}
                  className={index === active ? 'on' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(index);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))}
            {!rows.length ? <li className="empty">No matches</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
