// How much of a technique was actually proved: filled = it ran, half = it was
// inspected, empty = it was only claimed. Three glyphs rather than three
// words, because the distinction is the whole point of the technique list and
// a word would read as decoration.
import type { TechniqueProof } from '../runModel';

const TONE: Record<TechniqueProof['proof'], string> = {
  execution: 'text-status-success',
  inspection: 'text-status-info',
  claim: 'text-muted-dark',
};

export function ProofGlyph({ proof, label }: { proof: TechniqueProof['proof']; label: string }) {
  return (
    <svg width="18" height="18" role="img" aria-label={label} className={`flex-none ${TONE[proof]}`}>
      <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {proof === 'execution' ? <circle cx="9" cy="9" r="6" fill="currentColor" /> : null}
      {proof === 'inspection' ? <path d="M9 3a6 6 0 0 0 0 12z" fill="currentColor" /> : null}
    </svg>
  );
}

/** The council mark of one star, as a glyph rather than a colour alone. */
export function StateGlyph({ mark, size = 16, label }: { mark: string; size?: number; label: string }) {
  const c = size / 2;
  const r = size / 2 - 2.5;
  if (mark === 'approved') {
    return (
      <svg width={size} height={size} role="img" aria-label={label} className="flex-none">
        <circle cx={c} cy={c} r={r + 1} fill="var(--status-success)" />
        <path
          d={`M${c - 3.5} ${c}l2.6 2.8 4.6-5.4`}
          stroke="var(--background)"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (mark === 'pending') {
    return (
      <svg width={size} height={size} role="img" aria-label={label} className="flex-none">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--status-pending)" strokeWidth="1.8" />
        <circle cx={c} cy={c} r={r * 0.42} fill="var(--status-pending)" />
      </svg>
    );
  }
  if (mark === 'rejected') {
    return (
      <svg width={size} height={size} role="img" aria-label={label} className="flex-none">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--status-error)" strokeWidth="1.8" />
        <path
          d={`M${c - r * 0.7} ${c + r * 0.7}L${c + r * 0.7} ${c - r * 0.7}`}
          stroke="var(--status-error)"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} role="img" aria-label={label} className="flex-none">
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--muted-dark)"
        strokeWidth="1.3"
        strokeDasharray="2.2 2.6"
      />
    </svg>
  );
}

export default ProofGlyph;
