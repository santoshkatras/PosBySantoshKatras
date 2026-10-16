// Inventory → Unit Conversion
//   Units (table units: code, name, decimals)
//   Conversions (table uom_conversions: name, base_unit_id, lines JSON [{ unitId, qty, ofUnitId }])
//     e.g. base Piece · Box = 12 Piece · Carton = 10 Box  →  factors Piece 1, Box 12, Carton 120
//   Conversion vs Item: item profile.uom = { conversionId, purchase, sales, transfer, other }
//     (default unit for each kind of transaction; a unit of that conversion)

const clean = (value, max = 60) => String(value ?? '').trim().slice(0, max);
const parse = (text, fallback) => { try { return JSON.parse(text || '') ?? fallback; } catch { return fallback; } };
export const UOM_USES = [['purchase', 'Purchase (PO, GRN, Invoice)'], ['sales', 'Sales (Quotation, Order, Bill)'], ['transfer', 'Transfer (Out / In)'], ['other', 'Stock entries (opening, adjustment, wastage)']];

// factors in base units for every unit of a conversion; error text when the chain is wrong
export function conversionFactors(baseUnitId, lines) {
  const factor = { [baseUnitId]: 1 };
  for (const [index, line] of lines.entries()) {
    const at = `Row ${index + 1}`;
    if (!line.unitId) return { error: `${at}: choose the unit.` };
    if (factor[line.unitId]) return { error: `${at}: this unit is already in the conversion.` };
    if (!(Number(line.qty) > 0)) return { error: `${at}: enter how many it contains.` };
    if (!factor[line.ofUnitId]) return { error: `${at}: “contains … of” must be the base unit or a unit from an earlier row.` };
    factor[line.unitId] = Number(line.qty) * factor[line.ofUnitId];
  }
  return { factor };
}

export function registerUom(app, store, { auth, allow, route, fail, writeSetting, catalogueMeta }) {
  const view = allow('catalogue.view', 'catalogue');
  const manage = allow('catalogue.manage', 'catalogue');

  const shapeUnit = (row) => ({ id: row.id, code: row.code || '', name: row.name || '', decimals: row.decimals === '1' || row.decimals === 1 || row.decimals === true });
  function shapeConversion(row, units) {
    const lines = parse(row.lines, []);
    const { factor = {} } = conversionFactors(row.base_unit_id, lines);
    const nameOf = (id) => units.find((u) => u.id === id)?.name || '?';
    return {
      id: row.id, name: row.name, code: row.code || '', baseUnitId: row.base_unit_id, active: row.active !== '0', lines,
      units: [{ unitId: row.base_unit_id, name: nameOf(row.base_unit_id), factor: 1 }, ...lines.map((l) => ({ unitId: l.unitId, name: nameOf(l.unitId), factor: factor[l.unitId] || 0 }))],
      summary: lines.map((l) => `1 ${nameOf(l.unitId)} = ${Number(l.qty)} ${nameOf(l.ofUnitId)}`).join(' · '),
    };
  }

  app.get('/api/uom', auth, view, route(async (req, res) => {
    const units = (await store.find('units', { company_id: req.companyId })).map(shapeUnit).sort((a, b) => a.name.localeCompare(b.name));
    const conversions = (await store.find('uom_conversions', { company_id: req.companyId })).map((row) => shapeConversion(row, units)).sort((a, b) => a.name.localeCompare(b.name));
    const meta = await catalogueMeta(store, req.companyId);
    const products = (await store.find('products', { company_id: req.companyId })).filter((p) => p.is_active === 1 || p.is_active === '1');
    const variants = await store.find('variants', { company_id: req.companyId });
    const categories = await store.find('categories', { company_id: req.companyId });
    const items = products.map((p) => {
      const profile = meta.profiles[p.id] || {};
      const own = variants.filter((v) => v.product_id === p.id);
      return {
        productId: p.id, name: p.name, sku: own.map((v) => v.sku).join(', '), unitId: p.unit_id, unit: units.find((u) => u.id === p.unit_id)?.name || '',
        itemType: categories.find((c) => c.id === p.category_id)?.name || '', group: profile.kind === 'matrix' ? profile.parent || '' : '',
        uom: profile.uom || null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ units, conversions, items, uses: UOM_USES });
  }));

  // ---------- units ----------
  async function saveUnit(req, res, row) {
    const name = clean(req.body?.name, 40);
    const code = clean(req.body?.code, 10).toUpperCase();
    if (name.length < 1) return fail(res, 400, 'INVALID', 'Enter the unit name (e.g. Box).');
    if (!/^[A-Z0-9.]{1,10}$/.test(code)) return fail(res, 400, 'INVALID', 'Enter a short code (e.g. BOX, KG, PCS).');
    const all = await store.find('units', { company_id: req.companyId });
    if (all.some((u) => u.id !== row?.id && (String(u.code).toUpperCase() === code || String(u.name).toLowerCase() === name.toLowerCase()))) return fail(res, 409, 'DUPLICATE', `Unit ${name} / ${code} already exists.`);
    const fields = { name, code, decimals: req.body?.decimals ? '1' : '0' };
    const saved = row ? await store.update('units', row.id, fields) : await store.insert('units', { company_id: req.companyId, ...fields });
    res.status(row ? 200 : 201).json(shapeUnit(saved));
  }
  app.post('/api/units', auth, manage, route(async (req, res) => saveUnit(req, res, null)));
  app.put('/api/units/:id', auth, manage, route(async (req, res) => {
    const [row] = await store.find('units', { id: req.params.id });
    if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Unit not found.');
    return saveUnit(req, res, row);
  }));

  // ---------- conversions ----------
  async function saveConversion(req, res, row) {
    const b = req.body || {};
    const name = clean(b.name, 60);
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the conversion name (e.g. Biscuits – Pcs/Box/Carton).');
    const units = await store.find('units', { company_id: req.companyId });
    const has = (id) => units.some((u) => u.id === id);
    if (!has(b.baseUnitId)) return fail(res, 400, 'INVALID', 'Choose the base (smallest) unit — stock is kept in this unit.');
    const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => l && (l.unitId || l.qty)).map((l) => ({ unitId: String(l.unitId || ''), qty: String(Number(l.qty) || ''), ofUnitId: String(l.ofUnitId || b.baseUnitId) })).slice(0, 12);
    if (!lines.length) return fail(res, 400, 'INVALID', 'Add at least one bigger unit, e.g. 1 Box = 12 Piece.');
    if (lines.some((l) => !has(l.unitId) || !has(l.ofUnitId))) return fail(res, 400, 'INVALID', 'A unit in the conversion was not found.');
    const check = conversionFactors(b.baseUnitId, lines);
    if (check.error) return fail(res, 400, 'INVALID', check.error);
    const all = await store.find('uom_conversions', { company_id: req.companyId });
    if (all.some((c) => c.id !== row?.id && c.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'DUPLICATE', `A conversion called ${name} already exists.`);
    if (row && row.base_unit_id !== b.baseUnitId) {
      const meta = await catalogueMeta(store, req.companyId);
      if (Object.values(meta.profiles).some((p) => p?.uom?.conversionId === row.id)) return fail(res, 400, 'INVALID', 'Items use this conversion — the base unit cannot change. Create a new conversion instead.');
    }
    const fields = { name, code: clean(b.code, 12).toUpperCase(), base_unit_id: b.baseUnitId, lines: JSON.stringify(lines), active: b.active === false ? '0' : '1' };
    const saved = row ? await store.update('uom_conversions', row.id, fields) : await store.insert('uom_conversions', { company_id: req.companyId, created_at: new Date().toISOString(), ...fields });
    res.status(row ? 200 : 201).json(shapeConversion(saved, units.map(shapeUnit)));
  }
  app.post('/api/uom/conversions', auth, manage, route(async (req, res) => saveConversion(req, res, null)));
  app.put('/api/uom/conversions/:id', auth, manage, route(async (req, res) => {
    const [row] = await store.find('uom_conversions', { id: req.params.id });
    if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Conversion not found.');
    return saveConversion(req, res, row);
  }));

  // ---------- conversion vs item ----------
  app.put('/api/uom/items', auth, manage, route(async (req, res) => {
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.productIds) ? b.productIds : []).map(String))];
    if (!ids.length) return fail(res, 400, 'INVALID', 'Tick at least one item.');
    const products = await store.find('products', { company_id: req.companyId });
    const units = await store.find('units', { company_id: req.companyId });
    let mapping = null;
    if (b.conversionId) {
      const [conv] = await store.find('uom_conversions', { id: String(b.conversionId) });
      if (!conv || conv.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Conversion not found.');
      const allowed = new Set([conv.base_unit_id, ...parse(conv.lines, []).map((l) => l.unitId)]);
      mapping = { conversionId: conv.id };
      for (const [use] of UOM_USES) {
        const unitId = String(b[use] || conv.base_unit_id);
        if (!allowed.has(unitId)) return fail(res, 400, 'INVALID', `The ${use} unit is not part of ${conv.name}.`);
        mapping[use] = unitId;
      }
      const wrong = ids.map((id) => products.find((p) => p.id === id)).filter((p) => p && p.unit_id !== conv.base_unit_id);
      if (wrong.length) {
        const base = units.find((u) => u.id === conv.base_unit_id)?.name || 'its base unit';
        return fail(res, 400, 'INVALID', `${wrong.slice(0, 3).map((p) => `${p.name} (${units.find((u) => u.id === p.unit_id)?.name || '?'})`).join(', ')}${wrong.length > 3 ? ` +${wrong.length - 3} more` : ''}: stock unit differs from ${conv.name}'s base unit ${base}. Map items whose unit is ${base}.`);
      }
    }
    let done = 0;
    for (const id of ids) {
      const product = products.find((p) => p.id === id);
      if (!product) continue;
      const [row] = await store.find('settings', { company_id: req.companyId, setting_key: `item_profile_${id}` });
      const profile = parse(row?.setting_value, {}) || {};
      if (mapping) profile.uom = mapping; else delete profile.uom;
      await writeSetting(store, req.companyId, `item_profile_${id}`, JSON.stringify(profile));
      done += 1;
    }
    res.json({ updated: done });
  }));
}

// For the entry windows: the units an item can be entered in (base first) and its default per use.
export async function unitResolver(store, companyId) {
  const units = await store.find('units', { company_id: companyId });
  const conversions = await store.find('uom_conversions', { company_id: companyId });
  const unitRow = (id) => units.find((u) => u.id === id);
  return (product, profile) => {
    const map = profile?.uom;
    if (!map?.conversionId) return null;
    const conv = conversions.find((c) => c.id === map.conversionId);
    if (!conv || conv.active === '0' || conv.base_unit_id !== product.unit_id) return null;
    const lines = parse(conv.lines, []);
    const { factor, error } = conversionFactors(conv.base_unit_id, lines);
    if (error) return null;
    const list = [conv.base_unit_id, ...lines.map((l) => l.unitId)].map((id) => ({ unitId: id, name: unitRow(id)?.name || '?', code: unitRow(id)?.code || '', factor: factor[id] }));
    const unitUse = {};
    for (const [use] of UOM_USES) unitUse[use] = list.some((u) => u.unitId === map[use]) ? map[use] : conv.base_unit_id;
    return { conversionId: conv.id, units: list, unitUse };
  };
}

// Server check of a line's unit: { unitId, name, factor } when it is one of the item's units.
export function cleanUom(raw, choice) {
  if (!raw?.unitId || !choice) return null;
  const unit = choice.units.find((u) => u.unitId === String(raw.unitId));
  if (!unit || unit.factor === 1) return null;
  return { unitId: unit.unitId, name: unit.name, factor: unit.factor };
}
