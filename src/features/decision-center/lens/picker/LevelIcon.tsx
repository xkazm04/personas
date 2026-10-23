/**
 * LevelIcon - a product's readiness as a shape, never a colour (bp `components/ProjectSwitcher.tsx` LevelIcon,
 * verbatim geometry): dashed square = cannot be drawn, outline = map only, half-filled = measured,
 * filled = full. Draws in `currentColor`, so it takes the ink of whatever chip holds it.
 */
import type { ReadinessLevel } from '../../blueprint/source';

export function LevelIcon({ level }: { level: ReadinessLevel }) {
  return (
    <svg className="pj-lvl-ic" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {level === 'missing' ? (
        <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" />
      ) : (
        <>
          <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" />
          {level === 'measured' && <rect x="2" y="7" width="10" height="5" fill="currentColor" />}
          {level === 'full' && <rect x="2" y="2" width="10" height="10" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}
