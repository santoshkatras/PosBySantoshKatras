// Unit selection on stock in / out entries (shared by server and client).
// An item mapped to a unit conversion carries
//   units:   [{ unitId, name, code, factor }]  — base (stock) unit first, factor 1
//   unitUse: { purchase, sales, transfer, other } — default unit for each kind of entry
// Stock and every saved quantity / rate stay in the base unit; the line keeps
//   uom: { unitId, name, factor } and, per row, uq (qty in that unit) and ur (rate in that unit).

const r4 = (value) => Math.round((Number(value) || 0) * 10000) / 10000;
const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

export function unitList(item) {
  return Array.isArray(item?.units) && item.units.length ? item.units : [];
}

// Default unit for a kind of entry: the mapped default, else the base unit.
export function defaultUnit(item, use) {
  const units = unitList(item);
  if (!units.length) return null;
  const wanted = item.unitUse?.[use];
  return units.find((u) => u.unitId === wanted) || units[0];
}

export const factorOf = (unit) => (num(unit?.factor) > 0 ? num(unit.factor) : 1);
export const uomOf = (unit) => (unit && factorOf(unit) !== 1 ? { unitId: unit.unitId, name: unit.name, factor: factorOf(unit) } : null);

// entry unit → base: qty × factor, rates ÷ factor (MRP / selling price stay per base unit)
export function rowToBase(row, unit) {
  const f = factorOf(unit);
  const { uq, ur, ...rest } = row;
  if (f === 1) return rest;
  const out = { ...rest, uq: row.qty, ur: row.rate, qty: row.qty === '' || row.qty == null ? '' : r4(num(row.qty) * f) };
  if (row.rate !== undefined) out.rate = row.rate === '' ? '' : num(row.rate) / f;
  if (row.basis !== undefined && row.basis !== '' && row.basis != null) out.basis = num(row.basis) / f;
  if (Array.isArray(row.batches)) out.batches = row.batches.map((b) => ({ ...b, qty: b.qty === '' ? '' : r4(num(b.qty) * f) }));
  return out;
}

// base → entry unit (opening a saved line again); always worked out from the base values
export function rowFromBase(row, unit) {
  const f = factorOf(unit);
  const { uq, ur, ...rest } = row;
  if (f === 1) return rest;
  const out = { ...rest, qty: row.qty === '' || row.qty == null ? '' : String(r4(num(row.qty) / f)) };
  if (row.rate !== undefined) out.rate = row.rate === '' ? '' : String(r4(num(row.rate) * f));
  if (row.basis !== undefined && row.basis !== '' && row.basis != null) out.basis = String(r4(num(row.basis) * f));
  if (Array.isArray(row.batches)) out.batches = row.batches.map((b) => ({ ...b, qty: b.qty === '' ? '' : String(r4(num(b.qty) / f)) }));
  return out;
}

// before saving: uq / ur follow the base qty and rate (scans may have changed the base qty)
export function lineWithUnits(line) {
  const f = factorOf(line.uom);
  const strip = ({ uq, ur, ...rest }) => rest;
  if (f === 1) { const { uom, ...rest } = line; return { ...rest, variants: (line.variants || []).map(strip) }; }
  return { ...line, variants: (line.variants || []).map((row) => ({ ...strip(row), ...(row.qty === '' || row.qty == null ? {} : { uq: r4(num(row.qty) / f) }), ...(row.rate === '' || row.rate == null ? {} : { ur: r4(num(row.rate) * f) }) })) };
}

// a quantity that is not a whole number of the unit is easier to read in the base unit
export const fitsUnit = (qty, unit) => !(num(qty) > 0) || Math.abs(num(qty) / factorOf(unit) - Math.round(num(qty) / factorOf(unit))) < 0.0001;

// rate typed for one unit → same price for another unit
export const swapRate = (value, from, to) => (value === '' || value == null ? value : String(r4((num(value) / factorOf(from)) * factorOf(to))));

// "2 Box (24 PCS)" — qty is the base quantity
export function unitText(qty, uom, baseUnit = '') {
  const fmt = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(v));
  if (!uom || factorOf(uom) === 1) return `${fmt(qty)}${baseUnit ? ` ${baseUnit}` : ''}`;
  return `${fmt(num(qty) / factorOf(uom))} ${uom.name}${baseUnit ? ` (${fmt(qty)} ${baseUnit})` : ''}`;
}

export const toUnit = (qty, unit) => r4(num(qty) / factorOf(unit));
export const toBase = (qty, unit) => r4(num(qty) * factorOf(unit));

// unit an entry window opens in: the line's unit, unless its quantity is not a whole number of it
export function openUnit(line) {
  const units = Array.isArray(line?.units) ? line.units : [];
  if (!units.length) return null;
  const chosen = units.find((u) => u.unitId === line.uom?.unitId) || units[0];
  const total = (line.variants || []).reduce((sum, row) => sum + num(row.qty), 0);
  return fitsUnit(total, chosen) ? chosen : units[0];
}

// quantity text in the line's entry unit — qty is the base quantity
export function lineQtyText(line, qty) {
  const fmt = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(v));
  return factorOf(line?.uom) === 1 ? fmt(qty) : `${fmt(num(qty) / factorOf(line.uom))} ${line.uom.name}`;
}
