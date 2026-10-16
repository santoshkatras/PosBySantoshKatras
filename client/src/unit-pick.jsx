import { factorOf } from '../../shared/units.mjs';
import './line-tools.css';

// Unit chooser beside a quantity: Piece / Box (12) / Carton (120). Hidden when the item has one unit.
export function UnitSelect({ units, value, onChange, label = 'Unit', compact = false, baseName = '' }) {
  if (!Array.isArray(units) || units.length < 2) return null;
  const chosen = units.find((u) => u.unitId === value?.unitId) || units[0];
  const select = (
    <select className="up-select" aria-label={label} value={chosen.unitId} onChange={(event) => onChange(units.find((u) => u.unitId === event.target.value) || units[0])}>
      {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name}{factorOf(u) !== 1 ? ` (${factorOf(u)} ${baseName || units[0].name})` : ''}</option>)}
    </select>
  );
  return compact ? select : <label className="up-field">{label}{select}</label>;
}

// "= 24 PCS" under the quantity when a bigger unit is chosen
export function BaseHint({ qty, unit, baseName }) {
  const f = factorOf(unit);
  if (f === 1 || !(Number(qty) > 0)) return null;
  const total = Math.round(Number(qty) * f * 1000) / 1000;
  return <small className="up-hint">= {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(total)} {baseName}</small>;
}
