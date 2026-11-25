import { useEffect, useRef, useState } from 'react';

/**
 * Schedules DOM reveals inside requestAnimationFrame frames via IntersectionObserver
 * so scrolling hundreds of cards stays locked at 60fps even on low-end GPUs.
 */
export function useFrameReveal(depsKey: string) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const frameQueueRef = useRef<HTMLElement[]>([]);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      rafIdRef.current = null;
      const batch = frameQueueRef.current.splice(0, 12);
      for (const el of batch) {
        el.classList.add('is-visible');
      }
      if (frameQueueRef.current.length > 0) {
        rafIdRef.current = requestAnimationFrame(flush);
      }
    };

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let added = false;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            frameQueueRef.current.push(el);
            observerRef.current?.unobserve(el);
            added = true;
          }
        }
        if (added && rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(flush);
        }
      },
      { rootMargin: '80px 0px', threshold: 0.04 }
    );

    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      frameQueueRef.current = [];
      observerRef.current?.disconnect();
    };
  }, [depsKey]);

  return (el: HTMLElement | null) => {
    if (el && observerRef.current && !el.classList.contains('is-visible')) {
      observerRef.current.observe(el);
    }
  };
}

/**
 * Frame-accurate timer for hero slide progression (pauses cleanly when tab is hidden).
 */
export function useFrameCarousel(length: number, intervalMs = 6500, paused = false) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (length <= 1 || paused) {
      setProgress(0);
      return;
    }

    let start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      if (document.hidden) {
        start = now - progress * intervalMs;
      } else {
        const elapsed = now - start;
        if (elapsed >= intervalMs) {
          start = now;
          setIndex((i) => (i + 1) % length);
          setProgress(0);
        } else {
          setProgress(elapsed / intervalMs);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [length, intervalMs, paused]);

  const safeIndex = length > 0 ? index % length : 0;
  return { index: safeIndex, setIndex, progress };
}
