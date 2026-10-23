import type { ReadinessLevel } from '../../source';

/**
 * A product's readiness as a SHAPE, never a colour (bp ProjectSwitcher.tsx:15-27, verbatim geometry): diamond = the
 * sample, dashed square = missing (cannot be drawn), outline square = map only, half-filled = measured, filled = full.
 * Decorative: the word for the level always sits beside it.
 */
export function LevelIcon({ level }: { level: ReadinessLevel | 'sample' }) {
  return (
    <svg className="bp-lvl-ic" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" data-level={level}>
      {level === 'sample' ? <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill="currentColor" />
        : level === 'missing' ? <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" />
        : (
          <>
            <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" />
            {level === 'measured' && <rect x="2" y="7" width="10" height="5" fill="currentColor" />}
            {level === 'full' && <rect x="2" y="2" width="10" height="10" fill="currentColor" />}
          </>
        )}
    </svg>
  );
}
