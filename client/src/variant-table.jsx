import { useMemo, useState } from 'react';
import { GST_RATES } from '../../shared/domain.mjs';
import './variant-table.css';

// Editable columns of the matrix variant table.
export const VARIANT_COLUMNS = [
  { id: 'name', label: 'Variant / Item Name', width: 260, type: 'text' },
  { id: 'sku', label: 'SKU / Item Code', width: 150, type: 'text', mono: true },
  { id: 'barcode', label: 'Barcode', width: 140, type: 'text', mono: true },
  { id: 'mrp', label: 'MRP ₹', width: 96, type: 'number' },
  { id: 'salePrice', label: 'Selling ₹', width: 96, type: 'number' },
  { id: 'costPrice', label: 'Cost ₹', width: 96, type: 'number' },
  { id: 'hsnSac', label: 'HSN', width: 96, type: 'text', mono: true },
  { id: 'gstRate', label: 'GST %', width: 84, type: 'gst' },
  { id: 'openingStock', label: 'Opening Stock', width: 106, type: 'number' },
  { id: 'minStock', label: 'Min Stock', width: 90, type: 'number' },
];

function CopyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6 10l6 6 6-6M5 20h14" /></svg>;
}

export function VariantTable({ rows, attrLabels, locations, locationId, onLocation, onEdit, onCopy, onToggle, onRegenerate }) {
  const [filters, setFilters] = useState({});
  const [flash, setFlash] = useState('');

  const visible = useMemo(() => rows.filter((row) => Object.entries(filters).every(([key, text]) => {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return true;
    if (key.startsWith('attr:')) return String(row.attrs[Number(key.slice(5))] || '').toLowerCase().includes(needle);
    return String(row[key] ?? '').toLowerCase().includes(needle);
  })), [rows, filters]);

  const included = rows.filter((row) => row.include);
  const totalStock = included.reduce((sum, row) => sum + (Number(row.openingStock) || 0), 0);
  const filtered = visible.length !== rows.length;

  function copyDown(column) {
    const source = visible.find((row) => row.include) || visible[0];
    if (!source) return;
    const value = source[column.id];
    if (column.id === 'sku' || column.id === 'name') {
      setFlash(`${column.label} must be different on each row, so it is not copied.`);
      return;
    }
    onCopy(column.id, value, visible.map((row) => row.key));
    setFlash(`Copied ${column.label} “${value === '' ? 'blank' : value}” to ${visible.length} ${filtered ? 'filtered ' : ''}row${visible.length === 1 ? '' : 's'}.`);
  }

  if (!rows.length) {
    return <p className="vt-empty">Pick two or more values in the categories above (for example Colour: Red, Blue and Size: M, L). Every combination becomes a row here.</p>;
  }

  return (
    <div className="vt">
      <div className="vt-bar">
        <strong>{rows.length} combination{rows.length === 1 ? '' : 's'}</strong>
        <span>{included.length} will be created{totalStock ? ` · ${totalStock} opening stock` : ''}</span>
        <label className="vt-loc">Opening stock at
          <select value={locationId} onChange={(event) => onLocation(event.target.value)}>
            {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <button type="button" className="vt-btn" onClick={onRegenerate}>Regenerate SKUs</button>
        {Object.values(filters).some(Boolean) ? <button type="button" className="vt-btn" onClick={() => setFilters({})}>Clear filters</button> : null}
      </div>
      {flash ? <p className="vt-flash" role="status">{flash}</p> : null}
      <div className="vt-scroll">
        <table>
          <thead>
            <tr>
              <th className="vt-check">
                <input type="checkbox" aria-label="Select all visible" checked={visible.length > 0 && visible.every((row) => row.include)} onChange={(event) => onToggle(visible.map((row) => row.key), event.target.checked)} />
              </th>
              <th className="vt-num">#</th>
              {attrLabels.map((label, index) => <th key={`a${index}`} className="vt-attr" style={{ width: 96 }}>{label}</th>)}
              {VARIANT_COLUMNS.map((column) => (
                <th key={column.id} style={{ minWidth: column.width }}>
                  <span className="vt-head">
                    {column.label}
                    {column.id !== 'name' && column.id !== 'sku' ? (
                      <button type="button" className="vt-copy" title={`Copy the first ${filtered ? 'filtered ' : ''}row's ${column.label} to all ${filtered ? 'filtered ' : ''}rows`} aria-label={`Copy ${column.label} to all`} onClick={() => copyDown(column)}><CopyIcon /></button>
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
            <tr className="vt-filters">
              <th />
              <th />
              {attrLabels.map((label, index) => (
                <th key={`f${index}`}><input placeholder="Filter" aria-label={`Filter ${label}`} value={filters[`attr:${index}`] || ''} onChange={(event) => setFilters((current) => ({ ...current, [`attr:${index}`]: event.target.value }))} /></th>
              ))}
              {VARIANT_COLUMNS.map((column) => (
                <th key={column.id}><input placeholder="Filter" aria-label={`Filter ${column.label}`} value={filters[column.id] || ''} onChange={(event) => setFilters((current) => ({ ...current, [column.id]: event.target.value }))} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key} className={row.include ? '' : 'off'}>
                <td className="vt-check"><input type="checkbox" aria-label={`Create ${row.name}`} checked={row.include} onChange={(event) => onToggle([row.key], event.target.checked)} /></td>
                <td className="vt-num">{rows.indexOf(row) + 1}</td>
                {row.attrs.map((value, index) => <td key={`a${index}`} className="vt-attr"><span>{value}</span></td>)}
                {VARIANT_COLUMNS.map((column) => (
                  <td key={column.id}>
                    {column.type === 'gst' ? (
                      <select value={row.gstRate} onChange={(event) => onEdit(row.key, 'gstRate', event.target.value)} aria-label={`GST for ${row.name}`}>
                        {[...new Set([...GST_RATES, row.gstRate].filter(Boolean))].map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                      </select>
                    ) : (
                      <input
                        className={column.mono ? 'mono' : undefined}
                        inputMode={column.type === 'number' ? 'decimal' : undefined}
                        value={row[column.id] ?? ''}
                        aria-label={`${column.label} for ${row.name}`}
                        onChange={(event) => onEdit(row.key, column.id, column.type === 'number' ? event.target.value.replace(/[^0-9.]/g, '') : event.target.value)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!visible.length ? <tr><td className="vt-none" colSpan={2 + attrLabels.length + VARIANT_COLUMNS.length}>No rows match the filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="vt-hint">Tip: the ⇩ button in a column copies the first {filtered ? 'filtered ' : ''}row's value to every {filtered ? 'filtered ' : ''}row. Filter first to copy to just some rows (for example all “XL”).</p>
    </div>
  );
}

// Every combination of the values picked in each category level.
export function combinations(levels) {
  const filled = levels.filter((level) => level.values.length);
  if (!filled.length) return [];
  // Levels with one value apply to every row but don't need to appear in names or SKUs.
  let combos = [{ ids: [], names: [], slots: {} }];
  for (const level of filled) {
    const varies = level.values.length > 1;
    const next = [];
    for (const combo of combos) {
      for (const value of level.values) {
        next.push({ ids: [...combo.ids, value.id], names: varies ? [...combo.names, value.name] : combo.names, slots: { ...combo.slots, [level.level]: value.id } });
      }
    }
    combos = next;
    if (combos.length > 500) break;
  }
  return combos.slice(0, 500).map((combo) => ({ ...combo, key: combo.ids.join('|') }));
}

function abbr(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(clean)) return clean.slice(0, 4);
  return clean.slice(0, 3) || 'X';
}

// SKU for each combination: BASE-RED-XL, made unique within the table.
export function variantSkus(base, combos) {
  const seen = new Map();
  const out = {};
  for (const combo of combos) {
    let sku = [base || 'ITEM', ...combo.names.map(abbr)].join('-');
    const count = seen.get(sku) || 0;
    seen.set(sku, count + 1);
    if (count) sku = `${sku}-${count + 1}`;
    out[combo.key] = sku;
  }
  return out;
}
