import type { ReactNode } from 'react';
import { cx, kitAttrs } from './types';

export interface Crumb {
  label: ReactNode;
  /** Present = the level is a door back up (a button); absent = a name only. */
  onPress?: () => void;
  testId?: string;
}

/**
 * Crumbs: the trail of levels a drilled surface sits under, for a Section's `eyebrow`. A crumb
 * with `onPress` is a quiet text button back up to that level; one without is a name. When the
 * LAST crumb has no `onPress` it is where the reader is and carries `aria-current="page"`; a
 * surface whose Section title already names the current level passes only the levels above it,
 * so the name is not said twice. One tab stop per door, the separators are hidden from readers.
 * @catalog Crumbs - the trail of levels above a drilled surface (Section eyebrow); a crumb with onPress is a door back up, a last plain crumb is aria-current. Kit.
 */
export function Crumbs({ items, label, testId }: {
  items: readonly Crumb[];
  /** Accessible name of the trail's nav landmark. */
  label: string;
  testId?: string;
}) {
  const last = items.length - 1;
  return (
    <nav className="k-crumbs typo-eyebrow" {...kitAttrs('Crumbs')} aria-label={label} data-testid={testId}>
      <ol>
        {items.map((c, i) => {
          const current = i === last && !c.onPress;
          return (
            <li key={i}>
              {i > 0 && <span className="k-sep" aria-hidden="true">·</span>}
              {c.onPress ? (
                <button type="button" className="k-crumb" onClick={c.onPress} data-testid={c.testId}>{c.label}</button>
              ) : (
                <span className={cx('k-crumb', current && 'is-current')} aria-current={current ? 'page' : undefined} data-testid={c.testId}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
