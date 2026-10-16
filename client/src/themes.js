// Application themes (Settings → Display Settings). A theme recolours the sidebar, page, accent
// and buttons; styles change the font, corners, density and text size.

export const THEMES = [
  { id: 'classic', name: 'SKPOS Classic', note: 'Navy sidebar, blue accent (default)', side: '#0c2340', sideCard: '#163259', sideText: '#d5deea', sideMuted: '#a9b8cc', accent: '#2f6bff', page: '#f3f6fb', ink: '#101828' },
  { id: 'indigo', name: 'Midnight Indigo', note: 'Deep indigo with violet highlights', side: '#1e1b4b', sideCard: '#312e81', sideText: '#e0e7ff', sideMuted: '#a5b4fc', accent: '#6366f1', page: '#f5f5ff', ink: '#1e1b4b' },
  { id: 'emerald', name: 'Emerald Fresh', note: 'Green for grocery & pharmacy', side: '#053b2f', sideCard: '#065f46', sideText: '#d1fae5', sideMuted: '#86efac', accent: '#059669', page: '#f0fdf8', ink: '#052e22' },
  { id: 'saffron', name: 'Saffron Bazaar', note: 'Warm saffron for retail counters', side: '#5a2a07', sideCard: '#7c3a0b', sideText: '#ffedd5', sideMuted: '#fdba74', accent: '#ea7a0b', page: '#fff9f2', ink: '#3b1d06' },
  { id: 'royal', name: 'Royal Purple', note: 'Premium purple for boutiques', side: '#2e1065', sideCard: '#4c1d95', sideText: '#ede9fe', sideMuted: '#c4b5fd', accent: '#8b5cf6', page: '#faf7ff', ink: '#2e1065' },
  { id: 'ocean', name: 'Ocean Teal', note: 'Calm teal and aqua', side: '#0f3d3e', sideCard: '#115e59', sideText: '#ccfbf1', sideMuted: '#5eead4', accent: '#0d9488', page: '#f0fdfa', ink: '#0f2f2f' },
  { id: 'crimson', name: 'Crimson Retail', note: 'Bold red for fashion & electronics', side: '#4c0519', sideCard: '#881337', sideText: '#ffe4e6', sideMuted: '#fda4af', accent: '#e11d48', page: '#fff5f6', ink: '#3f0716' },
  { id: 'slate', name: 'Slate Professional', note: 'Neutral grey with sky accent', side: '#1e293b', sideCard: '#334155', sideText: '#e2e8f0', sideMuted: '#94a3b8', accent: '#0284c7', page: '#f1f5f9', ink: '#0f172a' },
  { id: 'charcoal', name: 'Charcoal Night', note: 'Near-black sidebar, amber accent', side: '#111111', sideCard: '#262626', sideText: '#e5e5e5', sideMuted: '#a3a3a3', accent: '#d97706', page: '#ececec', ink: '#171717' },
  { id: 'forest', name: 'Forest Hardware', note: 'Earthy green for hardware stores', side: '#1a2e05', sideCard: '#365314', sideText: '#ecfccb', sideMuted: '#bef264', accent: '#4d7c0f', page: '#f7fee7', ink: '#1a2e05' },
  { id: 'rose', name: 'Rose Boutique', note: 'Soft pink for beauty & gifting', side: '#500724', sideCard: '#831843', sideText: '#fce7f3', sideMuted: '#f9a8d4', accent: '#db2777', page: '#fff5fa', ink: '#4a0620' },
  { id: 'minimal', name: 'Light Minimal', note: 'White sidebar, clean and airy', side: '#ffffff', sideCard: '#f2f4f7', sideText: '#344054', sideMuted: '#667085', accent: '#2563eb', page: '#f8fafc', ink: '#101828', lightSide: true },
  { id: 'sky', name: 'Sky Light', note: 'Light blue sidebar, fresh look', side: '#e0f2fe', sideCard: '#bae6fd', sideText: '#0c4a6e', sideMuted: '#0369a1', accent: '#0284c7', page: '#f5fbff', ink: '#082f49', lightSide: true },
  { id: 'sand', name: 'Sand & Coffee', note: 'Beige sidebar with coffee tones', side: '#f5ebe0', sideCard: '#e3d5c5', sideText: '#4a3728', sideMuted: '#7f5539', accent: '#9c6644', page: '#fdfaf6', ink: '#3b2a1e', lightSide: true },
];

export const FONTS = [
  ['inter', 'Inter (default)', "Inter, 'General Sans', system-ui, sans-serif", ''],
  ['general', 'General Sans', "'General Sans', Inter, system-ui, sans-serif", ''],
  ['segoe', 'Segoe UI (Windows)', "'Segoe UI', system-ui, -apple-system, sans-serif", ''],
  ['poppins', 'Poppins', "Poppins, Inter, system-ui, sans-serif", 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap'],
  ['nunito', 'Nunito', "Nunito, Inter, system-ui, sans-serif", 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap'],
  ['roboto', 'Roboto', "Roboto, Inter, system-ui, sans-serif", 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap'],
  ['noto', 'Noto Sans (Indian languages)', "'Noto Sans', 'Noto Sans Devanagari', Inter, sans-serif", 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;600&display=swap'],
];
export const RADII = [['rounded', 'Rounded (default)', 1], ['sharp', 'Sharp corners', 0.35], ['soft', 'Extra round', 1.5]];
export const DENSITIES = [['comfortable', 'Comfortable (default)'], ['compact', 'Compact — more rows on screen']];
export const SCALES = [['90', 'Small text (90%)'], ['100', 'Normal (100%)'], ['110', 'Large text (110%)'], ['120', 'Extra large (120%)']];

export const DEFAULT_DISPLAY = { theme: 'classic', font: 'inter', radius: 'rounded', density: 'comfortable', scale: '100' };
const CACHE_KEY = 'skpos.display';

const alpha = (hex, a) => {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function themeCss(display) {
  const d = { ...DEFAULT_DISPLAY, ...(display || {}) };
  const t = THEMES.find((row) => row.id === d.theme) || THEMES[0];
  const font = FONTS.find((row) => row[0] === d.font) || FONTS[0];
  const radius = (RADII.find((row) => row[0] === d.radius) || RADII[0])[2];
  const hover = t.lightSide ? alpha(t.accent, 0.08) : 'rgba(255,255,255,.08)';
  const subActive = t.lightSide ? alpha(t.accent, 0.14) : alpha(t.accent, 0.22);
  const zoom = Number(d.scale) / 100 || 1;
  return `
:root{--accent:${t.accent};--accent-soft:${alpha(t.accent, 0.1)};--paper:${t.page};--ink:${t.ink};--font:${font[2]};--radius-scale:${radius}}
body,.shell,.workforce,.il,.im,.ose-window,.ose-pop,.dc-window,.pc,.bp,.ds,.sk,.tt,.pm{font-family:${font[2]}}
html body .shell.hrpay .sidebar,html body .shell.hrpay .hr-brand,html body .shell.hrpay .hr-side-foot{background:${t.side}}
html body .shell.hrpay .sidebar{color:${t.sideText};${t.lightSide ? `border-right:1px solid ${alpha(t.ink, 0.08)};` : ''}}
html body .shell.hrpay .hr-brand strong{color:${t.lightSide ? t.ink : '#fff'}}
html body .shell.hrpay .hr-brand small,html body .shell.hrpay .hr-org-title,html body .shell.hrpay .hr-org-card small{color:${t.sideMuted}}
html body .shell.hrpay .sidebar nav a,html body .shell.hrpay .sidebar nav button.nav-parent,html body .shell.hrpay .sidebar nav button.nav-soon{color:${t.sideText}}
html body .shell.hrpay .sidebar nav a:hover,html body .shell.hrpay .sidebar nav button.nav-parent:hover{background:${hover};color:${t.lightSide ? t.ink : '#fff'}}
html body .shell.hrpay .sidebar nav a.active,html body .shell.hrpay .sidebar nav button.nav-parent.active{background:${t.accent};color:#fff}
html body .shell.hrpay .sidebar nav a.nav-sub{color:${t.sideMuted}}
html body .shell.hrpay .sidebar nav a.nav-sub:hover{background:${hover};color:${t.lightSide ? t.ink : '#fff'}}
html body .shell.hrpay .sidebar nav a.nav-sub.active{background:${subActive};color:${t.lightSide ? t.ink : '#fff'};box-shadow:inset 2px 0 ${t.accent}}
html body .shell.hrpay .nav-children{border-left-color:${t.lightSide ? alpha(t.ink, 0.12) : 'rgba(255,255,255,.14)'}}
html body .shell.hrpay .hr-org-card{background:${t.sideCard}}
html body .shell.hrpay .hr-org-card strong{color:${t.lightSide ? t.ink : '#fff'}}
html body .shell.hrpay .sk-mark{background:${t.accent}}
html body .shell.hrpay .workspace{background:${t.page}}
html body .btn.primary,html body .il-btn.primary,html body .im-btn.primary,html body .fb-btn.primary:not(.danger){background:${t.accent};border-color:${t.accent};color:#fff}
html body .ose-link,html body .nd-link,html body .dc-pend{color:${t.accent}}
html body .im-tabs button.on,html body .il-detail-tabs button.on{color:${t.accent};border-color:${t.accent}}
.ose-search input:focus,.dc-party input:focus{border-color:${t.accent}}
${radius !== 1 ? `.card,.data-grid,.il-main,.il-detail,.im-block,.ose-window,.ose-pop,.ose-table,.btn,.il-btn,.im-btn,.nd-card,.pc-main,.pc-list,.bp-main,.bp-side,.fb-card,.dc-badge{border-radius:${radius === 0.35 ? '4px' : '18px'} !important}` : ''}
${d.density === 'compact' ? `.table-wrap td,.il-table-wrap td,.ose-table tbody td{padding-top:5px !important;padding-bottom:5px !important}.table-wrap th,.il-table-wrap th{padding-top:7px !important;padding-bottom:7px !important}.im-grid{gap:10px !important}.nd-main{gap:16px !important}` : ''}
${zoom !== 1 ? `html body .shell.hrpay .content{zoom:${zoom}}` : ''}
`;
}

export function loadFont(display) {
  const font = FONTS.find((row) => row[0] === (display?.font || 'inter'));
  if (!font?.[3] || document.querySelector(`link[data-font="${font[0]}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = font[3]; link.dataset.font = font[0];
  document.head.appendChild(link);
}

export function applyDisplay(display) {
  let tag = document.getElementById('skpos-theme');
  if (!tag) { tag = document.createElement('style'); tag.id = 'skpos-theme'; document.head.appendChild(tag); }
  tag.textContent = themeCss(display);
  loadFont(display);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(display || {})); } catch { /* cache only */ }
}

export function cachedDisplay() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}
