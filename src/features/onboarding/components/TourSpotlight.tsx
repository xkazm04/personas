import { useEffect, useRef, useState, useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';

interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PADDING = 8;
const BORDER_RADIUS = 12;

export default function TourSpotlight() {
  const tourActive = useSystemStore((s) => s.tourActive);
  const highlightTestId = useSystemStore((s) => s.tourHighlightTestId);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const rafRef = useRef<number>(0);

  const measure = useCallback(() => {
    if (!highlightTestId) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-testid="${highlightTestId}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      x: r.x - PADDING,
      y: r.y - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
  }, [highlightTestId]);

  useEffect(() => {
    if (!tourActive || !highlightTestId) {
      setRect(null);
      return;
    }

    // Initial measure with delay for layout
    const timer = setTimeout(measure, 100);

    // Re-measure on scroll/resize
    const handleReposition = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    // Observe DOM changes
    const observer = new MutationObserver(handleReposition);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
      observer.disconnect();
    };
  }, [tourActive, highlightTestId, measure]);

  if (!tourActive || !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <div
      data-testid="tour-spotlight"
      className="fixed inset-0 z-[9998] pointer-events-none"
      aria-hidden
    >
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="tour-spotlight-mask">
            <rect x="0" y="0" width={vw} height={vh} fill="white" />
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={BORDER_RADIUS}
              ry={BORDER_RADIUS}
              fill="black"
            />
          </mask>
        </defs>
        {/* Semi-transparent overlay with cutout */}
        <rect
          x="0"
          y="0"
          width={vw}
          height={vh}
          fill="rgba(0,0,0,0.35)"
          mask="url(#tour-spotlight-mask)"
        />
        {/* Pulsing border around target */}
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={BORDER_RADIUS}
          ry={BORDER_RADIUS}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeOpacity="0.5"
          className="animate-pulse"
        />
      </svg>
    </div>
  );
}
