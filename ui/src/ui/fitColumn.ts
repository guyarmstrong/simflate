// The left tool columns (Draft tools, Inflate materials) on short windows.

import { useLayoutEffect, useRef } from 'react';

/** Short windows (Guy): the column first tightens, then shrinks its icons,
 *  then splits into two columns side by side; only after that it scrolls.
 *  Sets `data-fit` ('' | 'small' | 'two') on the element, measured on the
 *  page again whenever the window changes. */
export function useFitColumn<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const col = ref.current;
    if (!col) return;
    const fit = () => {
      for (const level of ['', 'small', 'two']) {
        col.dataset.fit = level;
        if (col.scrollHeight <= col.clientHeight + 1) return;
      }
    };
    fit();
    // Watch the space it sits in, not the column (its own width changes as it fits).
    const ro = new ResizeObserver(fit);
    ro.observe(col.parentElement ?? col);
    return () => ro.disconnect();
  }, []);
  return ref;
}
