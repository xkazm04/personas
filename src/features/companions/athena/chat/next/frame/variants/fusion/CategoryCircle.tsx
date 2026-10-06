/**
 * Fusion · one managed category on the rail, in Filament's slim language: a
 * circle in the category's own ink with its glyph inside, ringed by its
 * items' states as arcs (working, waits on you, stuck, idle - each arc as long
 * as its share), its count beneath. A corner badge carries the urgent state
 * as a SHAPE too: a raised hand when something in it waits on you, a stop
 * sign when something is stuck. Pressing it (click, Enter, Space) unfolds the
 * category's panel beside the rail.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { forwardRef } from 'react';
import { Hand, OctagonAlert } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { FUSION_COPY as F } from './copy';
import { STATE_INK, STATE_ORDER, type ManagedCategory } from './useManaged';

const SIZE = 36;
const R = 16;
const LEN = 2 * Math.PI * R;
const GAP = 2.4;

function Arcs({ counts }: { counts: ManagedCategory['counts'] }) {
  const total = STATE_ORDER.reduce((n, s) => n + counts[s], 0);
  if (total === 0) return <circle className="fu-arc-empty" cx={SIZE / 2} cy={SIZE / 2} r={R} />;
  let at = 0;
  return (
    <>
      {STATE_ORDER.filter((s) => counts[s] > 0).map((s) => {
        const span = (counts[s] / total) * LEN;
        const len = total > 1 ? Math.max(1.5, span - GAP) : span;
        const el = (
          <circle
            key={s}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={STATE_INK[s]}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${len} ${LEN - len}`}
            strokeDashoffset={-at}
          />
        );
        at += span;
        return el;
      })}
    </>
  );
}

export function describe(c: ManagedCategory): string {
  const parts = STATE_ORDER.filter((s) => c.counts[s] > 0).map((s) => `${c.counts[s]} ${F.state[s]}`);
  return F.categoryNamed(c.label, c.items.length, parts.join(', '));
}

export const CategoryCircle = forwardRef<
  HTMLButtonElement,
  { category: ManagedCategory; open: boolean; onToggle: () => void; onKeyToggle: () => void }
>(function CategoryCircle({ category: c, open, onToggle, onKeyToggle }, ref) {
    const Icon = c.icon;
    const quiet = c.items.length === 0;
    return (
      // Re-keyed on open so a tooltip shown by the hover that opened the panel
      // goes away instead of sitting on the panel's head; while open it waits
      // out any further hover (the panel says it all).
      <Tooltip key={open ? 'open' : 'closed'} content={describe(c)} placement="top" delay={open ? 60_000 : undefined}>
        <Button
          ref={ref}
          variant="ghost"
          className={`fu-cat${quiet ? ' is-quiet' : ''}${open ? ' is-open' : ''}`}
          style={{ ['--ink' as string]: c.ink }}
          // A keyboard press (detail 0) hands the panel focus; a click leaves it on the circle.
          onClick={(e) => (e.detail === 0 ? onKeyToggle() : onToggle())}
          aria-expanded={open}
          aria-label={describe(c)}
          data-testid={`companion-fusion-cat-${c.key}`}
        >
          <span className="fu-cat-dial">
            <svg className="fu-cat-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
              <Arcs counts={c.counts} />
            </svg>
            <span className="fu-cat-core" aria-hidden>
              <Icon />
            </span>
            {c.counts.waiting > 0 ? (
              <span className="fu-cat-badge is-waiting" aria-hidden>
                <Hand />
              </span>
            ) : c.counts.stuck > 0 ? (
              <span className="fu-cat-badge is-stuck" aria-hidden>
                <OctagonAlert />
              </span>
            ) : null}
            <span className="typo-caption fu-cat-n">{c.items.length}</span>
          </span>
        </Button>
      </Tooltip>
    );
});
