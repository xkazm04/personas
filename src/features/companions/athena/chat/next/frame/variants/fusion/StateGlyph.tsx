/**
 * Fusion · one shape per managed state, so a state never rests on colour
 * alone (R5 · C's run-state vocabulary, copied): a filled disc (working), a
 * diamond (waits on you), a cross (stuck), an open ring (idle). Drawn figures
 * on tokenised ink (doctrine 6c).
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import type { ReactNode } from 'react';
import { STATE_INK, type ManagedState } from './useManaged';

export function StateGlyph({ state, size = 10 }: { state: ManagedState; size?: number }) {
  const ink = STATE_INK[state];
  let shape: ReactNode;
  switch (state) {
    case 'working':
      shape = <circle cx="5" cy="5" r="3.6" fill={ink} />;
      break;
    case 'waiting':
      shape = <path d="M5 0.6 L9.4 5 L5 9.4 L0.6 5 Z" fill={ink} />;
      break;
    case 'stuck':
      shape = <path d="M1.6 1.6 L8.4 8.4 M8.4 1.6 L1.6 8.4" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />;
      break;
    default:
      shape = <circle cx="5" cy="5" r="3.4" fill="none" stroke={ink} strokeWidth="1.4" />;
  }
  return (
    <svg className="fu-state" width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      {shape}
    </svg>
  );
}
