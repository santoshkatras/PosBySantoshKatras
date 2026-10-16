import { useLayoutEffect } from 'react';

// Size a list page to the space left in the page body, so nothing outside the
// table scrolls and the table scrolls inside with its own scrollbars.
// Phones and narrow windows keep normal page scrolling.
export function useFitHeight(ref, { minWidth = 900, gap = 2, minHeight = 320, active = true } = {}) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !active) return undefined;
    const body = node.closest('.wf-body') || node.closest('.workspace');
    function fit() {
      if (!body || window.innerWidth < minWidth) {
        node.style.height = '';
        body?.classList.remove('fit-locked');
        return;
      }
      body.classList.add('fit-locked');
      body.scrollTop = 0;
      const box = body.getBoundingClientRect();
      const padBottom = parseFloat(getComputedStyle(body).paddingBottom) || 0;
      const top = node.getBoundingClientRect().top;
      node.style.height = `${Math.max(minHeight, Math.floor(box.bottom - padBottom - top - gap))}px`;
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(body || document.body);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      body?.classList.remove('fit-locked');
      node.style.height = '';
    };
  }, [ref, minWidth, gap, minHeight, active]);
}
