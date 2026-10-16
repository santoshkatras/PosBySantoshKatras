import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import { DEFAULT_DISPLAY, DENSITIES, FONTS, RADII, SCALES, THEMES, applyDisplay, loadFont } from './themes.js';
import './app-settings.css';

// Configurations → Display Settings: application theme gallery with live preview and styles.

function Mock({ theme, display, big }) {
  const font = (FONTS.find((row) => row[0] === display.font) || FONTS[0])[2];
  const r = (RADII.find((row) => row[0] === display.radius) || RADII[0])[2];
  const rad = (px) => `${Math.round(px * r)}px`;
  const rows = display.density === 'compact' ? 6 : 4;
  const zoom = Number(display.scale) / 100 || 1;
  return (
    <div className={big ? 'ds-mock big' : 'ds-mock'} style={{ fontFamily: font, background: theme.page, color: theme.ink, borderRadius: rad(big ? 14 : 10) }}>
      <div className="ds-mock-side" style={{ background: theme.side, color: theme.sideText, borderRight: theme.lightSide ? '1px solid rgba(16,24,40,.08)' : 0 }}>
        <div className="ds-mock-brand"><i style={{ background: theme.accent, borderRadius: rad(6) }} />{big ? <b style={{ color: theme.lightSide ? theme.ink : '#fff' }}>SKPOS</b> : null}</div>
        <span className="on" style={{ background: theme.accent, color: '#fff', borderRadius: rad(6) }}>{big ? 'Dashboard' : ''}</span>
        {['Item Master', 'Purchase', 'Sales', 'Promotions', 'Settings'].map((label) => <span key={label} style={{ color: theme.sideMuted, borderRadius: rad(6) }}>{big ? label : ''}</span>)}
      </div>
      <div className="ds-mock-main" style={{ fontSize: big ? `${12 * zoom}px` : undefined }}>
        <div className="ds-mock-head">
          <b>{big ? 'Sales Bill' : ''}</b>
          <span style={{ background: theme.accent, borderRadius: rad(8) }}>{big ? '+ New Bill' : ''}</span>
        </div>
        {big ? (
          <div className="ds-mock-cards">
            {[['Today', '₹ 48,250'], ['Bills', '126'], ['Avg. bill', '₹ 383']].map(([k, v]) => <div key={k} style={{ borderRadius: rad(10) }}><small>{k}</small><strong>{v}</strong></div>)}
          </div>
        ) : null}
        <div className="ds-mock-table" style={{ borderRadius: rad(10) }}>
          {Array.from({ length: big ? rows : 3 }, (_, index) => (
            <p key={index} style={{ padding: big ? (display.density === 'compact' ? '4px 10px' : '8px 10px') : undefined }}>
              {big ? <><span>SB-{1024 + index}</span><span>Walk-in customer</span><em style={{ color: theme.accent }}>₹ {(index + 3) * 215}</em></> : <><i /><i /></>}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DisplaySettingsPage() {
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [scope, setScope] = useState('user');
  const [draft, setDraft] = useState(DEFAULT_DISPLAY);
  const [previewing, setPreviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const effective = (d, s) => ({ ...DEFAULT_DISPLAY, ...(d?.company || {}), ...(s === 'user' ? d?.user || {} : {}) });
  useEffect(() => {
    request('/app-settings/display').then((result) => {
      setData(result);
      const start = result.canEdit && !result.user ? 'company' : 'user';
      setScope(start);
      setDraft(effective(result, start));
    }).catch((err) => setError(message(err)));
  }, [request]);
  // leaving the page without saving drops the trial theme
  useEffect(() => () => { if (window.__skposDisplay) applyDisplay(window.__skposDisplay); }, []);
  useEffect(() => { FONTS.forEach((row) => loadFont({ font: row[0] })); }, []);

  const live = useMemo(() => (data ? { ...DEFAULT_DISPLAY, ...(data.company || {}), ...(data.user || {}) } : DEFAULT_DISPLAY), [data]);
  useEffect(() => { window.__skposDisplay = live; }, [live]);
  const saved = data ? effective(data, scope) : DEFAULT_DISPLAY;
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const theme = THEMES.find((row) => row.id === draft.theme) || THEMES[0];
  const set = (key, value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (previewing) applyDisplay(next);
  };

  function togglePreview() {
    if (previewing) { applyDisplay(live); setPreviewing(false); }
    else { applyDisplay(draft); setPreviewing(true); }
  }
  function switchScope(next) {
    setScope(next);
    setDraft(effective(data, next));
    if (previewing) { applyDisplay(live); setPreviewing(false); }
  }

  async function save() {
    const label = scope === 'company' ? 'every user of this business (unless they chose their own theme)' : 'your login only';
    if (!(await feedback.confirm({ title: 'Apply this theme?', message: `Save “${theme.name}” for ${label}?` }))) return;
    setPending(true); setError('');
    try {
      await request('/app-settings/display', { method: 'PUT', body: { scope, display: draft } });
      const next = { ...data, [scope]: draft };
      setData(next);
      const applied = { ...DEFAULT_DISPLAY, ...(next.company || {}), ...(next.user || {}) };
      window.__skposDisplay = applied;
      window.dispatchEvent(new CustomEvent('skpos:display', { detail: applied }));
      setPreviewing(false);
      feedback.success({ title: 'Display settings saved successfully', message: scope === 'user' && !next.user ? '' : `${theme.name} is now applied${scope === 'company' ? ' for the business' : ' for you'}.` });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }

  async function resetMine() {
    if (!(await feedback.confirm({ title: 'Use the business theme?', message: 'Remove your personal theme and follow the theme set for the business?' }))) return;
    try {
      await request('/app-settings/display', { method: 'PUT', body: { scope: 'user', reset: true } });
      const next = { ...data, user: null };
      setData(next);
      const applied = { ...DEFAULT_DISPLAY, ...(next.company || {}) };
      setDraft(applied);
      window.__skposDisplay = applied;
      window.dispatchEvent(new CustomEvent('skpos:display', { detail: applied }));
      setPreviewing(false);
      feedback.success({ title: 'Personal theme removed', message: 'You now follow the business theme.' });
    } catch (err) { setError(message(err)); }
  }

  if (!data) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading display settings…</p>}</section>;

  return (
    <div className="cfg ds">
      <div className="cfg-top">
        <div>
          <h1>Display Settings</h1>
          <p>Pick an application theme and style. Preview it on the whole screen before saving. A personal theme overrides the business theme for your login only.</p>
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          <button type="button" className={previewing ? 'btn ds-previewing' : 'btn'} onClick={togglePreview}>{previewing ? 'Stop preview' : 'Preview on screen'}</button>
          <button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Theme'}</button>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="cfg-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={scope === 'user'} className={scope === 'user' ? 'on' : ''} onClick={() => switchScope('user')}>Only for me <em>{session.user.name?.split(' ')[0] || 'You'}</em></button>
        <button type="button" role="tab" aria-selected={scope === 'company'} className={scope === 'company' ? 'on' : ''} disabled={!data.canEdit} title={data.canEdit ? '' : 'Needs settings permission'} onClick={() => switchScope('company')}>For the whole business</button>
        {scope === 'user' && data.user ? <button type="button" className="cfg-link" onClick={resetMine}>Use the business theme instead</button> : null}
      </div>

      <div className="ds-grid">
        <section className="cfg-card">
          <h3>Application themes <small>{THEMES.length} themes</small></h3>
          <div className="ds-themes">
            {THEMES.map((row) => (
              <button type="button" key={row.id} className={row.id === draft.theme ? 'ds-theme on' : 'ds-theme'} onClick={() => set('theme', row.id)} aria-pressed={row.id === draft.theme}>
                <Mock theme={row} display={{ ...draft, theme: row.id }} />
                <strong>{row.name}{row.id === saved.theme ? <i>Current</i> : null}</strong>
                <small>{row.note}</small>
                <span className="ds-swatch">{[row.side, row.accent, row.page].map((c) => <b key={c} style={{ background: c }} />)}</span>
              </button>
            ))}
          </div>
        </section>
        <aside className="cfg-card ds-side">
          <h3>Preview</h3>
          <Mock theme={theme} display={draft} big />
          <h3 className="pad">Styles</h3>
          <label className="cfg-field">Font
            <select value={draft.font} onChange={(event) => set('font', event.target.value)}>{FONTS.map(([id, label, family]) => <option key={id} value={id} style={{ fontFamily: family }}>{label}</option>)}</select>
          </label>
          <div className="cfg-field">Corners
            <div className="cfg-seg">{RADII.map(([id, label]) => <button type="button" key={id} className={draft.radius === id ? 'on' : ''} onClick={() => set('radius', id)}>{label.replace(' (default)', '')}</button>)}</div>
          </div>
          <div className="cfg-field">Table density
            <div className="cfg-seg">{DENSITIES.map(([id, label]) => <button type="button" key={id} className={draft.density === id ? 'on' : ''} title={label} onClick={() => set('density', id)}>{label.split(' ')[0]}</button>)}</div>
          </div>
          <div className="cfg-field">Text size
            <div className="cfg-seg">{SCALES.map(([id]) => <button type="button" key={id} className={draft.scale === id ? 'on' : ''} onClick={() => set('scale', id)}>{id}%</button>)}</div>
          </div>
          <button type="button" className="cfg-link" onClick={() => setDraft({ ...DEFAULT_DISPLAY })}>Restore SKPOS defaults</button>
        </aside>
      </div>
    </div>
  );
}
