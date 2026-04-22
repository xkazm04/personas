// Compact event stamp glyph — one per StampKind. Used by both the view-
// mode sweep (not currently rendered) and the edit-mode event rows in
// the Forge editor.

import type { StampKind } from './ucPickerTypes';

export function StampGlyph({ kind, size = 14 }: { kind: StampKind; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size}>
      {kind === 'up' && (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 14 L 10 6 L 16 14" />
          <path d="M 4 17 L 16 17" strokeOpacity={0.45} />
        </g>
      )}
      {kind === 'down' && (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 6 L 10 14 L 16 6" />
          <path d="M 4 3 L 16 3" strokeOpacity={0.45} />
        </g>
      )}
      {kind === 'hold' && (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M 4 10 L 16 10" />
          <path d="M 4 5 L 16 5" strokeOpacity={0.45} />
          <path d="M 4 15 L 16 15" strokeOpacity={0.45} />
        </g>
      )}
      {kind === 'scan' && (
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx={10} cy={10} r={6} />
          <path d="M 14.5 14.5 L 18 18" />
        </g>
      )}
      {kind === 'gem' && (
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
          <path d="M 10 3 L 17 8 L 14 17 L 6 17 L 3 8 Z" />
          <path d="M 3 8 L 17 8" strokeOpacity={0.5} />
        </g>
      )}
      {kind === 'spike' && (
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M 2 13 L 6 13 L 8 6 L 11 17 L 13 10 L 18 10" />
        </g>
      )}
      {kind === 'bolt' && (
        <path
          d="M 11 2 L 4 12 L 9 12 L 7 18 L 16 8 L 11 8 L 13 2 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={0.5}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
