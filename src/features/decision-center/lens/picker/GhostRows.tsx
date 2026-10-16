/**
 * GhostRows - the project list while the products read (loading pattern v2): rows in the real row's geometry
 * (name, slug, chip, root, the checklist grid, the doors), under the page's permanent head. No spinner.
 */
const CHECKS = [0, 1, 2, 3, 4, 5, 6];

export function GhostRows({ count = 3, label }: { count?: number; label: string }) {
  return (
    <ul className="pj-list motion-safe:animate-pulse" aria-busy="true" aria-label={label} data-testid="blueprint-picker-ghost">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="pj-row ghost" aria-hidden="true">
          <div className="pj-top">
            <div className="pj-id">
              <span className="pj-gb name" />
              <span className="pj-gb slug" />
            </div>
            <span className="pj-gb chip" />
          </div>
          <span className="pj-gb root" />
          <ul className="pj-check">
            {CHECKS.map((c) => <li key={c}><span className="pj-gb" /></li>)}
          </ul>
          <span className="pj-gb acts" />
        </li>
      ))}
    </ul>
  );
}
