// Admin Panel → Company Types & Features: for each company type (Garments, Grocery, Mobile Store …) which modules
// it gets (available + switched on at registration) and which menu screens it sees. The package still limits both.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useFeedback } from './feedback.jsx';

const msg = (err) => err?.message || 'Something went wrong.';
const copy = (v) => JSON.parse(JSON.stringify(v));

export function TypesTab({ token, catalog, onSaved }) {
  const feedback = useFeedback();
  const types = catalog.companyTypes || [];
  const [map, setMap] = useState(() => copy(catalog.typeMapping || {}));
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('');
  const [counts, setCounts] = useState({});
  const [apply, setApply] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/companies', { token }).then((d) => { const c = {}; for (const x of d.items || []) if (x.companyType) c[x.companyType] = (c[x.companyType] || 0) + 1; setCounts(c); }).catch(() => {});
  }, [token]);
  const changedTypes = types.filter((t) => JSON.stringify(map[t.id]) !== JSON.stringify(catalog.typeMapping?.[t.id])).map((t) => t.id);
  const moduleChanged = types.filter((t) => JSON.stringify(map[t.id]?.modules) !== JSON.stringify(catalog.typeMapping?.[t.id]?.modules)).map((t) => t.id);
  const shown = only ? types.filter((t) => t.id === only) : types;
  const set = (id, fn) => setMap((cur) => { const next = copy(cur); fn(next[id]); return next; });
  const s = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const out = [];
    for (const f of catalog.features) {
      if (s && !`${f.group} ${f.label}`.toLowerCase().includes(s)) continue;
      let g = out.find((x) => x.name === f.group);
      if (!g) { g = { name: f.group, items: [] }; out.push(g); }
      g.items.push(f);
    }
    return out;
  }, [catalog.features, s]);
  const modules = catalog.modules.filter((m) => !s || m.label.toLowerCase().includes(s));
  const modLabel = (key) => catalog.modules.find((m) => m.key === key)?.label || key;

  async function save() {
    const affected = moduleChanged.reduce((n, id) => n + (counts[id] || 0), 0);
    const ok = await feedback.confirm({
      title: 'Save company types & features?',
      message: `${changedTypes.length} company type${changedTypes.length === 1 ? '' : 's'} changed: ${changedTypes.map((id) => types.find((t) => t.id === id)?.label).join(', ')}. New registrations of these types get only the mapped modules and screens.`,
      detail: moduleChanged.length && affected ? (apply ? `Module switches of ${affected} existing compan${affected === 1 ? 'y' : 'ies'} of these types are also set to the mapping. Screens follow the mapping for everyone straight away.` : `Existing companies keep their module switches (screens follow the mapping straight away). Tick “Apply to existing companies” to change them too.`) : 'Screens follow the mapping for existing companies of these types straight away.',
      confirmLabel: 'Save mapping', cancelLabel: 'Keep editing',
    });
    if (!ok) return;
    setPending(true); setError('');
    try {
      const out = await api('/admin/type-mapping', { method: 'PUT', body: { mapping: map, apply: apply ? moduleChanged : [] }, token });
      setMap(copy(out.typeMapping));
      onSaved(out.typeMapping);
      feedback.success({ title: 'Company types & features saved', message: out.effects?.length ? `Updated ${out.effects.length} existing compan${out.effects.length === 1 ? 'y' : 'ies'}.` : 'Saved.', detail: (out.effects || []).slice(0, 6).join('\n'), autoClose: !out.effects?.length });
    } catch (err) { setError(msg(err)); } finally { setPending(false); }
  }
  function reset(id) {
    // module defaults as at first install: computed by the server; here simply all screens on and the current modules
    set(id, (t) => { for (const k of Object.keys(t.features)) t.features[k] = true; });
  }
  const colOn = (id, list) => list.every((f) => map[id]?.features[f.id] !== false);

  return (
    <section className="data-grid ap-packages ap-types">
      <div className="grid-toolbar">
        <h2 className="grid-title">Company Types &amp; Features</h2>
        <div className="grid-search"><input value={q} placeholder="Search a module or screen" onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid-tools">
          <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Show company type"><option value="">All company types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <label className="ap-apply" title="Also set the module switches of companies already registered with a changed type"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />Apply to existing companies</label>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" disabled={!changedTypes.length || pending} onClick={() => setMap(copy(catalog.typeMapping))}>Undo changes</button>
          <button type="button" className="btn primary" disabled={!changedTypes.length || pending} onClick={save}>{pending ? 'Saving…' : 'Save Mapping'}</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Module / Screen</th>
              {shown.map((t) => (
                <th key={t.id} className={`ap-pcol${changedTypes.includes(t.id) ? ' ap-changed' : ''}`}>
                  {t.label}
                  <small>{counts[t.id] ? `${counts[t.id]} compan${counts[t.id] === 1 ? 'y' : 'ies'}` : 'no company yet'}{changedTypes.includes(t.id) ? ' · changed' : ''}</small>
                  <button type="button" className="ap-mini" onClick={() => reset(t.id)} title="Show every screen for this type">all screens</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="ap-sec"><td colSpan={shown.length + 1}>Modules — available and switched on at registration</td></tr>
            {modules.map((m) => (
              <tr key={m.key}>
                <td><b>{m.label}</b>{m.locked ? <small className="ap-muted"> · always on</small> : null}</td>
                {shown.map((t) => <td key={t.id} className="ap-pcol"><input type="checkbox" disabled={m.locked} checked={Boolean(map[t.id]?.modules[m.key])} onChange={(e) => set(t.id, (x) => { x.modules[m.key] = e.target.checked; })} aria-label={`${t.label} ${m.label}`} /></td>)}
              </tr>
            ))}
            {groups.map((g) => (
              <Fragment key={g.name}>
                <tr className="ap-sec">
                  <td>{g.name}</td>
                  {shown.map((t) => <td key={t.id} className="ap-pcol"><label className="ap-all"><input type="checkbox" checked={colOn(t.id, g.items)} onChange={(e) => set(t.id, (x) => { for (const f of g.items) x.features[f.id] = e.target.checked; })} aria-label={`${t.label} all ${g.name}`} />all</label></td>)}
                </tr>
                {g.items.map((f) => (
                  <tr key={f.id}>
                    <td>{f.label}{f.module ? <small className="ap-muted"> · {modLabel(f.module)}</small> : null}</td>
                    {shown.map((t) => {
                      const modOff = f.module && !map[t.id]?.modules[f.module];
                      return <td key={t.id} className={`ap-pcol${modOff ? ' ap-dim' : ''}`} title={modOff ? `${modLabel(f.module)} is off for ${t.label}` : undefined}><input type="checkbox" checked={map[t.id]?.features[f.id] !== false} onChange={(e) => set(t.id, (x) => { x.features[f.id] = e.target.checked; })} aria-label={`${t.label} ${f.label}`} /></td>;
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">Company types: <strong>{types.length}</strong><em>A screen shows only when the package, its module and the company type all allow it</em><em>Per-company Enable / Disable in Companies still wins</em></div>
    </section>
  );
}
