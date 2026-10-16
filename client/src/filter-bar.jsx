import { useEffect, useRef, useState } from 'react';

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5.2-5.2" /></svg>;
}

function FunnelIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" /></svg>;
}

export function FilterBar({ fields, values, onChange, placeholder = 'Search', extra = null }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const active = fields.filter((field) => values[field.id] && values[field.id] !== 'all');

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (!box.current?.contains(event.target)) setOpen(false);
    }
    function key(event) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  function labelFor(field) {
    return field.options.find(([id]) => id === values[field.id])?.[1] || values[field.id];
  }

  function clearAll() {
    onChange(Object.fromEntries([...fields.map((field) => [field.id, 'all']), ['query', '']]));
  }

  return (
    <div className="il-filters" ref={box}>
      <label className="il-search">
        <SearchIcon />
        <input value={values.query || ''} placeholder={placeholder} aria-label="Search" data-sc="search" onChange={(event) => onChange({ ...values, query: event.target.value })} />
        {values.query ? <button type="button" className="il-search-x" aria-label="Clear search" onClick={() => onChange({ ...values, query: '' })}>×</button> : null}
      </label>
      {extra}
      {fields.length ? (
        <button type="button" className={open || active.length ? 'il-filter-btn on' : 'il-filter-btn'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <FunnelIcon />
          Filters
          {active.length ? <span className="il-count">{active.length}</span> : null}
        </button>
      ) : null}
      {active.length || values.query ? <button type="button" className="il-clear" onClick={clearAll}>Clear all</button> : null}
      {active.length ? (
        <div className="il-chips">
          {active.map((field) => (
            <button key={field.id} type="button" className="il-chip" title={`Remove ${field.label} filter`} onClick={() => onChange({ ...values, [field.id]: 'all' })}>
              <span>{field.label}:</span> {labelFor(field)} <i aria-hidden="true">×</i>
            </button>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="il-filter-pop" role="dialog" aria-label="Filters">
          <header>
            <strong>Filters</strong>
            <span>{active.length ? `${active.length} applied` : 'None applied'}</span>
          </header>
          <div className="il-filter-grid">
            {fields.map((field) => (
              <label key={field.id}>{field.label}
                <select value={values[field.id] || 'all'} onChange={(event) => onChange({ ...values, [field.id]: event.target.value })}>
                  {field.options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <footer>
            <button type="button" className="il-clear" onClick={() => onChange({ ...values, ...Object.fromEntries(fields.map((field) => [field.id, 'all'])) })}>Reset filters</button>
            <button type="button" className="il-btn primary" onClick={() => setOpen(false)}>Done</button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
