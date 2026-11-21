import { useEffect, useRef } from 'react';

/**
 * Pull-to-refresh for a scroll container.
 *
 * The indicator is driven straight through DOM styles rather than React state:
 * a touchmove fires every few milliseconds, and re-rendering the weather
 * screen (with its animated particle background) on each one would make the
 * pull itself janky.
 *
 * `enabled` must flip true once the scroll container is actually mounted —
 * the weather screen renders a different root while it's still loading, so the
 * ref is empty on first mount and the listeners need to attach afterwards.
 */
export default function usePullToRefresh(scrollRef, indicatorRef, onRefresh, enabled, { threshold = 70, max = 110 } = {}) {
  const latest = useRef(onRefresh);
  latest.current = onRefresh;

  useEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return undefined;

    let startY = null;
    let pull = 0;
    let busy = false;

    const paint = (distance, spinning) => {
      const ind = indicatorRef.current;
      if (!ind) return;
      ind.style.transform = `translate(-50%, ${distance}px)`;
      ind.style.opacity = String(Math.min(1, distance / (threshold * 0.8)));
      const glyph = ind.firstElementChild;
      if (!glyph) return;
      glyph.classList.toggle('animate-spin', spinning);
      glyph.style.transform = spinning ? '' : `rotate(${distance * 3}deg)`;
    };

    const onStart = (e) => {
      startY = el.scrollTop <= 0 && !busy ? e.touches[0].clientY : null;
    };
    const onMove = (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        pull = 0;
        paint(0, false);
        return;
      }
      pull = Math.min(max, dy * 0.5); // resistance: the further you pull, the heavier it gets
      paint(pull, false);
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      if (pull >= threshold) {
        busy = true;
        paint(threshold * 0.8, true);
        Promise.resolve(latest.current()).finally(() => {
          busy = false;
          paint(0, false);
        });
      } else {
        paint(0, false);
      }
      pull = 0;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef, indicatorRef, enabled, threshold, max]);
}
