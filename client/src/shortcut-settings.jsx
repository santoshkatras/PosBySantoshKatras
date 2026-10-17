import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import { SHORTCUT_ACTIONS, SHORTCUT_GROUPS, keysFromEvent, normaliseKeys, shortcutList } from '../../shared/app-config.mjs';
import './app-settings.css';

// Configurations → Shortcut Keys: every keyboard shortcut, form by form.

const RESERVED = ['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+R', 'F12', 'Alt+F4', 'Tab', 'Enter', 'Shift+Tab'];
const BROWSER_NOTE = { F5: 'F5 normally reloads the page — SKPOS takes it over only on the Sales Bill payment window.' };

function conflicts(list) {
  const out = {};
  const enabled = list.filter((row) => row.enabled && !row.fixed);
  for (const a of enabled) {
    for (const b of enabled) {
      if (a === b || a.keys !== b.keys) continue;
      const overlap = a.group === b.group || a.group === 'global' || b.group === 'global';
      const sameTarget = a.target && a.target === b.target;
      if (overlap && !sameTarget) (out[a.id] ||= []).push(b.label);
    }
  }
  return out;
}

export function ShortcutSettingsPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [saved, setSaved] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState({});
  const [recording, setRecording] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    request('/app-settings/shortcuts').then((data) => { setSaved(data.saved || {}); setDraft(data.saved || {}); setCanEdit(data.canEdit); }).catch((err) => setError(message(err)));
  }, [request]);

  const list = useMemo(() => shortcutList(draft), [draft]);
  const clash = useMemo(() => conflicts(list), [list]);
  const dirty = saved && JSON.stringify(shortcutList(saved)) !== JSON.stringify(list);

  useEffect(() => {
    if (!recording) return undefined;
    const onKey = (event) => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { setRecording(''); return; }
      const combo = keysFromEvent(event);
      if (!combo) return;
      if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey) { setRecording(''); return; }
      if (RESERVED.includes(combo)) { feedback.toast(`${combo} is kept for the browser / typing. Choose another key.`, 'error'); return; }
      const plain = !event.ctrlKey && !event.altKey && !/^F\d{1,2}$/.test(event.key);
      if (plain) { feedback.toast('Use a function key (F1–F12) or combine with Ctrl / Alt, so typing is not affected.', 'error'); return; }
      setDraft((current) => ({ ...current, [recording]: { ...(current[recording] || {}), keys: normaliseKeys(combo), enabled: current[recording]?.enabled !== false } }));
      setRecording('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, feedback]);

  function setRow(id, patch) { setDraft((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } })); }
  function resetRow(action) { setDraft((current) => { const next = { ...current }; delete next[action.id]; return next; }); }

  async function resetAll() {
    if (!(await feedback.confirm({ title: 'Restore default keys?', message: 'All shortcut keys go back to the SKPOS defaults. Save to apply.', tone: 'danger', confirmLabel: 'Restore' }))) return;
    setDraft({});
  }

  async function save() {
    if (Object.keys(clash).length) { feedback.failure({ title: 'Some keys are used twice', message: 'Fix the rows marked in red, then save.' }); return; }
    if (!(await feedback.confirm({ title: 'Save shortcut keys?', message: 'The new keys work immediately for every user of this business.' }))) return;
    setPending(true); setError('');
    const body = {};
    for (const row of list) if (!row.fixed && (row.keys !== row.defaultKeys || !row.enabled)) body[row.id] = { keys: row.keys, enabled: row.enabled };
    try {
      const result = await request('/app-settings/shortcuts', { method: 'PUT', body: { saved: body } });
      setSaved(result.saved); setDraft(result.saved);
      window.dispatchEvent(new CustomEvent('skpos:shortcuts'));
      feedback.success({ title: 'Shortcut keys saved successfully', message: 'Press Ctrl + / anywhere to see them.' });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }

  if (!saved) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading shortcut keys…</p>}</section>;

  const q = query.trim().toLowerCase();
  const shown = list.filter((row) => (group === 'all' || row.group === group) && (!q || `${row.label} ${row.keys}`.toLowerCase().includes(q)));
  const changed = list.filter((row) => row.keys !== row.defaultKeys || !row.enabled).length;

  return (
    <div className="cfg sk">
      <div className="cfg-top">
        <div>
          <h1>Shortcut Key Configurations</h1>
          <p>Keyboard shortcuts for every form. Click a key to record a new one. Form keys work only while that form is open; “Anywhere” keys work on every screen. Press <kbd>Ctrl</kbd> + <kbd>/</kbd> anytime to see the list.</p>
          <EnterMovesToggle />
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {canEdit ? (
            <>
              <button type="button" className="btn" onClick={resetAll} disabled={!changed}>Restore defaults</button>
              <button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Shortcuts'}</button>
            </>
          ) : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="cfg-bar">
        <input className="cfg-search" data-sc="search" value={query} placeholder="Search action or key, e.g. save, F10" onChange={(event) => setQuery(event.target.value)} />
        <div className="cfg-chips">
          <button type="button" className={group === 'all' ? 'on' : ''} onClick={() => setGroup('all')}>All forms <em>{list.length}</em></button>
          {SHORTCUT_GROUPS.map(([id, label]) => <button type="button" key={id} className={group === id ? 'on' : ''} title={label} onClick={() => setGroup(id)}>{label.split(' (')[0].replace('Anywhere in the application', 'Anywhere')} <em>{list.filter((row) => row.group === id).length}</em></button>)}
        </div>
      </div>
      {SHORTCUT_GROUPS.filter(([id]) => shown.some((row) => row.group === id)).map(([id, label]) => (
        <section className="cfg-card" key={id}>
          <h3>{label}</h3>
          <div className="table-wrap sk-table">
            <table>
              <thead><tr><th>Action</th><th>Shortcut key</th><th>Default</th><th>Enabled</th><th /></tr></thead>
              <tbody>
                {shown.filter((row) => row.group === id).map((row) => {
                  const bad = clash[row.id];
                  return (
                    <tr key={row.id} className={bad ? 'sk-bad' : undefined}>
                      <td><strong>{row.label}</strong>{bad ? <small className="sk-warn">Also used by: {bad.join(', ')}</small> : null}{BROWSER_NOTE[row.keys] ? <small>{BROWSER_NOTE[row.keys]}</small> : null}</td>
                      <td>
                        {row.fixed ? <kbd>{row.keys}</kbd> : (
                          <button type="button" disabled={!canEdit} className={recording === row.id ? 'sk-key sk-capture' : 'sk-key'} onClick={() => setRecording(recording === row.id ? '' : row.id)}>
                            {recording === row.id ? 'Press keys… (Esc cancels)' : row.keys.split('+').map((part, index) => <span key={index}>{index ? '+' : ''}<kbd>{part}</kbd></span>)}
                          </button>
                        )}
                      </td>
                      <td className="sk-def">{row.defaultKeys}{row.keys !== row.defaultKeys ? <i>changed</i> : null}</td>
                      <td>{row.fixed ? <small>always</small> : <label className="cfg-switch"><input type="checkbox" disabled={!canEdit} checked={row.enabled} onChange={(event) => setRow(row.id, { enabled: event.target.checked, keys: row.keys })} /><span /></label>}</td>
                      <td>{!row.fixed && canEdit && (row.keys !== row.defaultKeys || !row.enabled) ? <button type="button" className="cfg-link" onClick={() => resetRow(row)}>Reset</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!shown.length ? <p className="cfg-empty">No shortcut matches “{query}”.</p> : null}
      <p className="cfg-note">{SHORTCUT_ACTIONS.length} actions across {SHORTCUT_GROUPS.length} form groups. Enter confirms and Esc cancels in every pop-up; these two keys cannot be changed.</p>
    </div>
  );
}

// This computer only: Enter moves to the next field (desktop style) — see keyboard.js
function EnterMovesToggle() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem('skpos_enter_moves') !== '0'; } catch { return true; } });
  return (
    <label className="sk-enter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 600, fontSize: 13 }}>
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); try { localStorage.setItem('skpos_enter_moves', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
      <kbd>Enter</kbd> moves to the next field in every form (<kbd>Shift</kbd>+<kbd>Enter</kbd> goes back) · <kbd>Space</kbd> ticks rows in pick lists — this computer
    </label>
  );
}
