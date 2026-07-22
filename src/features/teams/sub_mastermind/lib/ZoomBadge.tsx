// Debug zoom readout (top-right): exact zoom factor + semantic band, so gaps
// in readability can be reported per level ("at z 0.48 the labels are mush").
// Prototype instrumentation — likely demoted or removed at consolidation.
import { mix, MONO } from './ink';
import { zoomMode } from './types';

export function ZoomBadge({ z }: { z: number }) {
  return (
    <div
      className="absolute top-3 right-3 z-10 pointer-events-none px-2.5 py-1.5 rounded-interactive"
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: '0.1em',
        color: 'var(--foreground)',
        background: mix('var(--background)', 78),
        border: `1px solid ${mix('var(--foreground)', 12)}`,
        fontVariantNumeric: 'tabular-nums',
      }}
      data-testid="mm-zoom-badge"
    >
      z {z.toFixed(2)} · {Math.round(z * 100)}% · {zoomMode(z).toUpperCase()}
    </div>
  );
}
