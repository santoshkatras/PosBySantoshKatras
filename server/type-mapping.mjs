// Company types vs features mapping, saved in platform_settings ('type_mapping'). Read by sessions,
// registration and the Admin Panel.
import { mergeTypeMapping } from '../shared/licensing.mjs';

let cache = null;
export async function readTypeMapping(store) {
  if (cache && Date.now() - cache.at < 30000) return cache.map;
  const [row] = await store.find('platform_settings', { setting_key: 'type_mapping' });
  let saved = null;
  try { saved = JSON.parse(row?.setting_value || 'null'); } catch { saved = null; }
  const map = mergeTypeMapping(saved);
  cache = { at: Date.now(), map };
  return map;
}
export async function writeTypeMapping(store, mapping) {
  const clean = mergeTypeMapping(mapping);
  const [row] = await store.find('platform_settings', { setting_key: 'type_mapping' });
  const text = JSON.stringify(clean);
  if (row) await store.update('platform_settings', row.id, { setting_value: text });
  else await store.insert('platform_settings', { setting_key: 'type_mapping', setting_value: text, company_id: null });
  cache = null;
  return clean;
}
