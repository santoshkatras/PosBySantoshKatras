import { useEffect } from 'react';

// Pin (freeze) columns in every table of the app.
// Each header cell gets a small pin button. Pinning a column freezes it and
// every column to its left, like "Freeze panes" in Excel. The choice is kept
// per screen and per table in this browser.

const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7"/></svg>';
const SKIP_HEAD = ['col-set', 'sg-x', 'no-pin'];

function storageKey(table) {
  const tables = [...document.querySelectorAll('table')];
  return `sk_pin|${window.location.pathname}|${tables.indexOf(table)}`;
}

function readPin(table) {
  try { return localStorage.getItem(storageKey(table)) || ''; } catch { return ''; }
}

function writePin(table, label) {
  try {
    if (label) localStorage.setItem(storageKey(table), label);
    else localStorage.removeItem(storageKey(table));
  } catch { /* storage off */ }
}

function headLabel(th) {
  let text = '';
  for (const node of th.childNodes) {
    if (node.nodeType === 1 && node.classList.contains('pin-btn')) continue;
    text += node.textContent || '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function canPin(th) {
  if (SKIP_HEAD.some((name) => th.classList.contains(name))) return false;
  return Boolean(headLabel(th)) || Boolean(th.querySelector('input'));
}

function ensureButtons(row) {
  for (const th of row.cells) {
    const has = th.querySelector(':scope > .pin-btn');
    if (!canPin(th) || !headLabel(th)) {
      has?.remove();
      continue;
    }
    if (has) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pin-btn';
    button.innerHTML = PIN_SVG;
    th.appendChild(button);
  }
}

function clearCell(cell) {
  if (!cell.classList.contains('pin-cell')) return;
  cell.classList.remove('pin-cell', 'pin-edge');
  cell.style.position = '';
  cell.style.left = '';
  if (cell.tagName === 'TH' && cell.querySelector(':scope > .pin-btn') && getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
}

function applyTable(table) {
  const head = table.tHead?.rows[0];
  if (!head) return;
  ensureButtons(head);

  const pinned = readPin(table);
  let pinCol = -1;
  let col = 0;
  const starts = [];
  for (const th of head.cells) {
    starts.push(col);
    const label = headLabel(th);
    if (pinned && label === pinned) pinCol = col + th.colSpan - 1;
    const button = th.querySelector(':scope > .pin-btn');
    if (button) {
      const on = pinned && label === pinned;
      button.classList.toggle('on', Boolean(on));
      button.title = on ? `Unfreeze columns (pinned up to ${label})` : `Freeze columns up to ${label}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (button) {
      const align = getComputedStyle(th).textAlign;
      button.classList.toggle('at-left', align === 'right' || align === 'end' || align === 'center');
    }
    if (button && th.style.position !== 'sticky' && getComputedStyle(th).position === 'static') th.style.position = 'relative';
    col += th.colSpan;
  }
  if (pinned && pinCol < 0) pinCol = -1; // the pinned column is hidden now

  // Left offset of each column, from the header widths.
  const lefts = [];
  let running = 0;
  [...head.cells].forEach((th, index) => {
    for (let c = 0; c < th.colSpan; c += 1) lefts[starts[index] + c] = running;
    running += th.offsetWidth;
  });

  for (const section of [table.tHead, ...table.tBodies, table.tFoot]) {
    if (!section) continue;
    for (const row of section.rows) {
      let at = 0;
      for (const cell of row.cells) {
        const end = at + cell.colSpan - 1;
        const skip = cell.classList.contains('col-set');
        if (pinCol >= 0 && end <= pinCol && !skip) {
          cell.classList.add('pin-cell');
          cell.classList.toggle('pin-edge', end === pinCol);
          cell.style.position = 'sticky';
          cell.style.left = `${lefts[at] || 0}px`;
        } else clearCell(cell);
        at = end + 1;
      }
    }
  }
}

function applyAll() {
  for (const table of document.querySelectorAll('table')) {
    if (table.dataset.nopin !== undefined) continue;
    applyTable(table);
  }
}

export function useTablePins() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; applyAll(); });
    };
    const resize = new ResizeObserver(schedule);
    const watched = new WeakSet();
    const watchTables = () => {
      for (const table of document.querySelectorAll('table')) {
        if (watched.has(table)) continue;
        watched.add(table);
        resize.observe(table);
      }
    };
    const mutations = new MutationObserver(() => { watchTables(); schedule(); });
    mutations.observe(document.body, { childList: true, subtree: true });

    function click(event) {
      const button = event.target.closest?.('.pin-btn');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const th = button.closest('th');
      const table = button.closest('table');
      const label = headLabel(th);
      writePin(table, readPin(table) === label ? '' : label);
      applyTable(table);
    }
    document.addEventListener('click', click, true);
    window.addEventListener('resize', schedule);
    watchTables();
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      document.removeEventListener('click', click, true);
      window.removeEventListener('resize', schedule);
    };
  }, []);
}
