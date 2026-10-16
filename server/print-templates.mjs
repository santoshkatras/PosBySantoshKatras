// Configurations → Print Template Setup. One saved template per kind (barcode labels for now),
// kept in settings as print_template_<kind> so every counter / computer prints the same way.
const KINDS = ['barcode'];

export function registerPrintTemplates(app, store, { auth, allow, route, fail, writeSetting }) {
  const read = async (companyId, kind) => {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: `print_template_${kind}` });
    try { return JSON.parse(row?.setting_value || 'null'); } catch { return null; }
  };
  // any signed-in user who prints labels needs to read it
  app.get('/api/print-templates', auth, route(async (req, res) => {
    const out = {};
    for (const kind of KINDS) out[kind] = await read(req.companyId, kind);
    res.json(out);
  }));
  app.put('/api/print-templates/:kind', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const kind = String(req.params.kind);
    if (!KINDS.includes(kind)) return fail(res, 404, 'NOT_FOUND', 'Unknown print template.');
    const value = req.body?.setup;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(res, 400, 'INVALID', 'Template settings are missing.');
    const text = JSON.stringify(value);
    if (text.length > 20000) return fail(res, 400, 'INVALID', 'Template settings are too large.');
    await writeSetting(store, req.companyId, `print_template_${kind}`, text);
    res.json({ saved: true, setup: value });
  }));
}
