// Entry windows (Purchase, Sales, Opening Stock, Stock Update, Transfers, Wastage, Repacking, Price Update):
// • Maximise / restore — the window fills the browser (double-click the title bar does the same).
// • Bigger item table — hides the header details (number, date, party, location …) so the item table gets the room.
// Both choices are remembered for the next window.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const read = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const save = (key, on) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ } };
const WINDOW = '.ose-window, .se-window';
const BAR = '.ose-top, .card-head';

function useWindowClass(ref, cls, on, backCls) {
  useLayoutEffect(() => {
    const win = ref.current?.closest(WINDOW);
    if (!win) return undefined;
    win.classList.toggle(cls, on);
    if (backCls) win.closest('.modal-back')?.classList.toggle(backCls, on);
    return () => { win.classList.remove(cls); if (backCls) win.closest('.modal-back')?.classList.remove(backCls); };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
}

function FocusButton() {
  const ref = useRef(null);
  const [on, setOn] = useState(() => read('skpos_win_focus'));
  useWindowClass(ref, 'win-focus', on);
  useEffect(() => {
    // the summary line in the title (Purchase / Sales) turns the details back on
    const win = ref.current?.closest(WINDOW);
    const show = (event) => { if (event.target.closest('.dc-focus-sum')) { save('skpos_win_focus', false); setOn(false); } };
    win?.addEventListener('click', show);
    return () => win?.removeEventListener('click', show);
  }, []);
  const toggle = () => setOn((cur) => { save('skpos_win_focus', !cur); return !cur; });
  return (
    <button ref={ref} type="button" className={`ose-x ose-max-btn ose-focus-btn${on ? ' on' : ''}`} onClick={toggle} aria-pressed={on} aria-label={on ? 'Show header details' : 'Bigger item table'} title={on ? 'Show the header details again' : 'Bigger item table — hide the header details'}>
      {on ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16M4 4h16v16H4zM9 13l3 3 3-3" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 9h16M9 16l3-3 3 3" /></svg>}
    </button>
  );
}

export function MaxButton({ focus = true }) {
  const ref = useRef(null);
  const [max, setMax] = useState(() => read('skpos_win_max'));
  useWindowClass(ref, 'win-max', max, 'win-max-back');
  useEffect(() => {
    const bar = ref.current?.closest(WINDOW)?.querySelector(BAR);
    if (!bar) return undefined;
    const dbl = (event) => { if (event.target.closest('button, input, select, textarea, a, .dc-focus-sum')) return; setMax((cur) => { save('skpos_win_max', !cur); return !cur; }); };
    bar.addEventListener('dblclick', dbl);
    return () => bar.removeEventListener('dblclick', dbl);
  }, []);
  const toggle = () => setMax((cur) => { save('skpos_win_max', !cur); return !cur; });
  return (
    <>
      {focus ? <FocusButton /> : null}
      <button ref={ref} type="button" className="ose-x ose-max-btn" onClick={toggle} aria-label={max ? 'Restore window size' : 'Maximise window'} title={max ? 'Restore (double-click the title bar)' : 'Maximise (double-click the title bar)'}>
        {max ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h12v12M4 8h12v12H4z" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z" /></svg>}
      </button>
    </>
  );
}
