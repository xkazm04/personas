/**
 * Fusion · one managed category on the rail, in Filament's slim language: a
 * circle in the category's own ink with its glyph inside, ringed by its
 * items' states as arcs (working, waits on you, stuck, idle - each arc as long
 * as its share), its count beneath. A corner badge carries the urgent state
 * as a SHAPE too: a raised hand when something in it waits on you, a stop
 * sign when something is stuck. A category with nothing in it is quiet: its
 * icon only, no zero pill. Pressing it (click, Enter, Space) unfolds the
 * category's panel beside the rail. When the rail reads out loud (hover or
 * keyboard focus anywhere on it) the circle grows in place and its name and
 * its count by state stand beside it; that label replaces the old tooltip.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { forwardRef } from 'react';
import { Hand, OctagonAlert } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { FUSION_COPY as F } from './copy';
import { STATE_INK, STATE_ORDER, type ManagedCategory } from './useManaged';

/** The id of a category's unfolded panel: the circle's `aria-controls` points at it. */
export const panelId = (key: string) => `fu-panel-${key}`;
/** Three characters at most, so a count never outgrows its pill or the glass. */
export const countText = (n: number) => (n > 99 ? '99+' : String(n));

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

/** "1 waits · 1 stuck · 2 working": the ring's arcs, in words, for the rail's label. */
export function countsLine(c: ManagedCategory): string {
  const parts = STATE_ORDER.filter((s) => c.counts[s] > 0).map((s) => `${c.counts[s]} ${F.stateShort[s]}`);
  return parts.length ? parts.join(' · ') : F.catQuiet;
}

export const CategoryCircle = forwardRef<
  HTMLButtonElement,
  { category: ManagedCategory; open: boolean; onToggle: () => void; onKeyToggle: () => void }
>(function CategoryCircle({ category: c, open, onToggle, onKeyToggle }, ref) {
    const Icon = c.icon;
    const quiet = c.items.length === 0;
    return (
      <Button
        ref={ref}
        variant="ghost"
        className={`fu-cat${quiet ? ' is-quiet' : ''}${open ? ' is-open' : ''}`}
        style={{ ['--ink' as string]: c.ink }}
        // A keyboard press (detail 0) hands the panel focus; a click leaves it on the circle.
        onClick={(e) => (e.detail === 0 ? onKeyToggle() : onToggle())}
        aria-expanded={open}
        aria-controls={open ? panelId(c.key) : undefined}
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
          {!quiet && <span className="typo-caption fu-cat-n">{countText(c.items.length)}</span>}
        </span>
        <span className="fu-tag is-two" aria-hidden>
          <span className="typo-label fu-tag-main">{c.label}</span>
          <span className="typo-label fu-tag-meta">{countsLine(c)}</span>
        </span>
      </Button>
    );
});
