// Desktop-style keyboard for every form:
//   Enter → next field · Shift+Enter → previous field · Enter on the last field → focus the main (Save) button
//   ↑ / ↓ on a selectable list row (data-kb-row) → previous / next row · Space on it → tick / untick
//   (data-kb-row="check": Space ticks the row's checkbox, Enter opens the row)
// A screen keeps its own Enter behaviour when its handler calls preventDefault (pick from a dropdown, scan, save…),
// or when a field / area is marked data-enter="native". Turn off with localStorage skpos_enter_moves = '0'.
const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'file', 'image', 'range', 'color', 'hidden']);
const FIELD = 'input,select,textarea';
const DIALOG = '[role=dialog],[role=alertdialog],.ose-pop,.modal-card';

function enabled() { try { return localStorage.getItem('skpos_enter_moves') !== '0'; } catch { return true; } }
function visible(el) { return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'; }
function candidate(el) {
  if (!(el instanceof HTMLElement) || el.disabled || el.readOnly || el.tabIndex < 0) return false;
  if (el.tagName === 'INPUT' && SKIP_TYPES.has(el.type)) return false;
  return visible(el);
}
function containerOf(el) {
  return el.closest(DIALOG) || el.closest('form') || el.closest('.ose-window, .dc-window, .card, .data-grid, section') || document.querySelector('main') || document.body;
}
function ignored(el) {
  if (el.tagName === 'TEXTAREA' || el.isContentEditable || el.type === 'radio') return true;
  if (el.closest('[data-enter="native"], .fb-card, .ose-entry')) return true;
  if (el.getAttribute('role') === 'combobox' || el.hasAttribute('list') || el.hasAttribute('aria-autocomplete') || el.type === 'search') return true;
  if (el.matches('[data-sc="search"], .grid-search input')) return true;
  if (document.querySelector('.ose-drop, [role=listbox][data-open="1"]')) return true;
  return false;
}
function fieldsIn(box) { return [...box.querySelectorAll(FIELD)].filter((f) => candidate(f) && f.type !== 'radio' && !f.closest('[data-enter="skip"]')); }
function mainButton(box) {
  return box.querySelector('footer .btn.primary:not(:disabled), .btn.primary:not(:disabled), button[type=submit]:not(:disabled)');
}
function focusField(f) {
  f.focus();
  if (f.tagName === 'INPUT' && typeof f.select === 'function' && !['checkbox', 'radio', 'date', 'time', 'datetime-local', 'month'].includes(f.type)) { try { f.select(); } catch { /* not selectable */ } }
  f.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function onEnter(event) {
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.matches(FIELD) || !candidate(el) || ignored(el)) return;
  const box = containerOf(el);
  const list = fieldsIn(box);
  const i = list.indexOf(el);
  if (i < 0) return;
  const form = el.closest('form');
  const last = i === list.length - 1;
  if (form && last && !event.shiftKey) return; // last field of a real form: Enter submits as usual
  if (form || el.type === 'checkbox' || el.type === 'radio') event.preventDefault();
  const dialogs = document.querySelectorAll(DIALOG).length;
  // let the screen's own Enter handler run first — skip if it opened something or moved the focus
  setTimeout(() => {
    if (document.activeElement !== el || document.querySelectorAll(DIALOG).length !== dialogs || !el.isConnected) return;
    const fresh = fieldsIn(box);
    const at = fresh.indexOf(el);
    if (at < 0) return;
    if (event.shiftKey) { if (at > 0) focusField(fresh[at - 1]); return; }
    if (at < fresh.length - 1) focusField(fresh[at + 1]);
    else mainButton(box)?.focus();
  }, 0);
}

// rows marked data-kb-row: ↑ ↓ move, Space toggles (the row's onClick or its checkbox)
function onRowKey(event) {
  const row = event.target.closest?.('[data-kb-row]');
  if (!row) return;
  const own = event.target === row || (event.target.type === 'checkbox' && event.target.closest('[data-kb-row]') === row);
  if (!own) return;
  const rows = () => [...row.parentElement.querySelectorAll(':scope > [data-kb-row]')];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const all = rows(); const next = all[all.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) { event.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); }
  } else if (event.key === 'Enter' && event.target === row && row.getAttribute('data-kb-row') === 'check') {
    event.preventDefault(); row.click();
  } else if ((event.key === ' ' || event.key === 'Spacebar') && event.target === row) {
    event.preventDefault();
    const box = row.querySelector('input[type=checkbox]');
    if (row.getAttribute('data-kb-row') === 'check' && box) box.click(); else row.click();
  }
}

// for search boxes that handle Enter themselves (pick a match): move on to the next field afterwards
export function focusNext(el, back = false) {
  if (!el || !enabled()) return;
  setTimeout(() => {
    if (!el.isConnected) return;
    const box = containerOf(el);
    const list = fieldsIn(box);
    const at = list.indexOf(el);
    if (at < 0) return;
    if (back) { if (at > 0) focusField(list[at - 1]); return; }
    if (at < list.length - 1) focusField(list[at + 1]); else mainButton(box)?.focus();
  }, 0);
}

let installed = false;
export function installKeyboard() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' && !event.target.closest?.('[data-kb-row]')) { if (enabled()) onEnter(event); return; }
    if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') onRowKey(event);
  });
}
