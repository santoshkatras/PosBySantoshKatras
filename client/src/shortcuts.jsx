import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SHORTCUT_GROUPS, keysFromEvent, shortcutList } from '../../shared/app-config.mjs';
import { useAuth } from './auth.jsx';
import { applyDisplay, cachedDisplay, DEFAULT_DISPLAY } from './themes.js';
import './shortcuts.css';

// Theme + keyboard shortcuts for the whole app (mounted once in the Shell).

function visible(el) {
  return Boolean(el && (el.offsetParent !== null || el.getClientRects().length) && !el.closest('[aria-hidden="true"]'));
}

function activate(el) {
  if (el.disabled) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) { el.click(); return true; }
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { el.focus(); if (el.select) el.select(); return true; }
  el.click();
  return true;
}

export function useAppTheme() {
  const { request, session } = useAuth();
  useEffect(() => { applyDisplay(cachedDisplay() || DEFAULT_DISPLAY); }, []);
  useEffect(() => {
    if (!session) return undefined;
    let live = true;
    request('/app-settings/display').then((data) => { if (live) applyDisplay({ ...DEFAULT_DISPLAY, ...(data.company || {}), ...(data.user || {}) }); }).catch(() => {});
    const onChange = (event) => applyDisplay(event.detail);
    window.addEventListener('skpos:display', onChange);
    return () => { live = false; window.removeEventListener('skpos:display', onChange); };
  }, [session, request]);
}

export function ShortcutLayer() {
  const { request, session } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState(() => shortcutList({}));
  const [help, setHelp] = useState(false);
  const listRef = useRef(list);
  listRef.current = list;

  const load = useCallback(() => {
    request('/app-settings/shortcuts').then((data) => setList(shortcutList(data.saved))).catch(() => {});
  }, [request]);
  useEffect(() => {
    if (!session) return undefined;
    load();
    window.addEventListener('skpos:shortcuts', load);
    return () => window.removeEventListener('skpos:shortcuts', load);
  }, [session, load]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('.fb-back')) return; // a confirmation pop-up owns the keyboard
      if (document.querySelector('.sk-capture')) return; // recording a new key in settings
      const combo = keysFromEvent(event);
      if (!combo || combo === 'Esc') return;
      const target = event.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d{1,2}$/.test(event.key);
      if (typing && plain) return;
      const matches = listRef.current.filter((row) => row.enabled && !row.fixed && row.keys === combo);
      if (!matches.length) return;
      // form keys first (they act on what is open), then app-wide keys
      const ordered = [...matches.filter((row) => row.target), ...matches.filter((row) => !row.target)];
      for (const action of ordered) {
        if (action.target) {
          const els = [...document.querySelectorAll(`[data-sc="${action.target}"]`)].filter(visible);
          const el = els[els.length - 1];
          if (el && activate(el)) { event.preventDefault(); event.stopPropagation(); return; }
          continue;
        }
        if (action.id === 'shortcut-help') { event.preventDefault(); setHelp((value) => !value); return; }
        if (action.event) { event.preventDefault(); window.dispatchEvent(new CustomEvent(action.event)); return; }
        if (action.href) {
          if (document.querySelector('.ose-window, .ose-pop')) return; // don't leave an open entry window
          event.preventDefault(); navigate(action.href); return;
        }
      }
    };
    const onHelp = () => setHelp((value) => !value);
    document.addEventListener('keydown', onKey);
    window.addEventListener('skpos:shortcut-help', onHelp);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('skpos:shortcut-help', onHelp); };
  }, [navigate]);

  // Show the mapped key on every control that has one (buttons get a small badge, fields a tooltip),
  // so the shortcuts are visible where they work. Follows the user's own key mapping.
  useEffect(() => {
    const byTarget = new Map();
    for (const row of list) if (row.enabled && row.target && !byTarget.has(row.target)) byTarget.set(row.target, row.keys);
    let frame = 0;
    const decorate = () => {
      frame = 0;
      for (const el of document.querySelectorAll('[data-sc]')) {
        const keys = byTarget.get(el.getAttribute('data-sc')) || '';
        if ((el.getAttribute('data-keys') || '') === keys) continue;
        if (keys) el.setAttribute('data-keys', keys); else el.removeAttribute('data-keys');
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) { const base = (el.getAttribute('title') || '').replace(/\s*\(Shortcut: [^)]*\)$/, ''); el.setAttribute('title', keys ? `${base}${base ? ' ' : ''}(Shortcut: ${keys})` : base); }
      }
    };
    decorate();
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(decorate); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [list]);

  useEffect(() => {
    if (!help) return undefined;
    const key = (event) => { if (event.key === 'Escape') setHelp(false); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [help]);

  if (!help) return null;
  return (
    <div className="sk-help-back" onMouseDown={() => setHelp(false)}>
      <div className="sk-help" role="dialog" aria-label="Shortcut keys" onMouseDown={(event) => event.stopPropagation()}>
        <header><h3>Shortcut Keys</h3><button type="button" onClick={() => setHelp(false)} aria-label="Close">×</button></header>
        <div className="sk-help-body">
          {SHORTCUT_GROUPS.map(([group, label]) => {
            const rows = list.filter((row) => row.group === group && row.enabled);
            if (!rows.length) return null;
            return (
              <section key={group}>
                <h4>{label}</h4>
                {rows.map((row) => <p key={row.id}><span>{row.label}</span><kbd>{row.keys}</kbd></p>)}
              </section>
            );
          })}
        </div>
        <footer>Change these in Configurations → Shortcut Keys. Enter confirms and Esc cancels in every pop-up.</footer>
      </div>
    </div>
  );
}
