/**
 * Folio's small drawn pieces: her mark (a line-drawn owl, Athena's bird), the
 * run-state shapes, the ink drop for unread words, and a key cap. Figures, not
 * chrome (doctrine 6c): inline SVG on tokenised ink.
 */

import type { ReactNode } from 'react';
import { RUN_INK, type RunState } from './marks';

/** Her mark: two eyes and a brow, drawn in one ink. */
export function OwlMark({ size = 20, writing = false }: { size?: number; writing?: boolean }) {
  return (
    <svg className={`r5c-owl${writing ? ' writing' : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 6.5 Q12 3.2 20 6.5" />
      <path d="M4.2 6.6 C3.4 13 6.8 20 12 21 C17.2 20 20.6 13 19.8 6.6" />
      <circle cx="8.6" cy="11" r="2.6" />
      <circle cx="15.4" cy="11" r="2.6" />
      <circle className="pupil" cx="8.6" cy="11" r="0.9" />
      <circle className="pupil" cx="15.4" cy="11" r="0.9" />
      <path d="M11 14.4 L12 16 L13 14.4" />
    </svg>
  );
}

/**
 * One shape per run state, so state never rests on colour: a filled disc
 * (working), a diamond (needs you), a cross (stuck), a dashed ring (queued),
 * an open ring (idle), a half disc (later).
 */
export function StateMark({ state, size = 10 }: { state: RunState; size?: number }) {
  const ink = RUN_INK[state];
  let shape: ReactNode;
  switch (state) {
    case 'working':
      shape = <circle cx="5" cy="5" r="3.6" fill={ink} />;
      break;
    case 'needs':
      shape = <path d="M5 0.6 L9.4 5 L5 9.4 L0.6 5 Z" fill={ink} />;
      break;
    case 'stuck':
      shape = <path d="M1.6 1.6 L8.4 8.4 M8.4 1.6 L1.6 8.4" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />;
      break;
    case 'queued':
      shape = <circle cx="5" cy="5" r="3.4" fill="none" stroke={ink} strokeWidth="1.4" strokeDasharray="2 1.6" />;
      break;
    case 'later':
      shape = (
        <>
          <circle cx="5" cy="5" r="3.6" fill="none" stroke={ink} strokeWidth="1.2" />
          <path d="M5 1.4 A3.6 3.6 0 0 1 5 8.6 Z" fill={ink} />
        </>
      );
      break;
    default:
      shape = <circle cx="5" cy="5" r="3.4" fill="none" stroke={ink} strokeWidth="1.4" />;
  }
  return (
    <svg className="r5c-state" width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      {shape}
    </svg>
  );
}

/** The ink drop: new words from her that you have not read. */
export function InkDrop() {
  return (
    <svg className="r5c-ink" width="10" height="13" viewBox="0 0 10 13" aria-hidden>
      <path d="M5 0.8 C5 0.8 1 6 1 8.4 A4 4 0 0 0 9 8.4 C9 6 5 0.8 5 0.8 Z" />
    </svg>
  );
}

/** A key cap that names a key this surface really answers. */
export function Key({ children }: { children: ReactNode }) {
  return <kbd className="r5c-key typo-code">{children}</kbd>;
}
