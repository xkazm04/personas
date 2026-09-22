// One companion's column: a full-height door whose status lamp is the light
// the illustration already carries. The ring, the count, the state word and
// the wake line are all drawn around that one point, 58% down the column, so
// the three columns read as three lamps before a word is read.
import { ArrowRight } from 'lucide-react';
import { forwardRef, type PointerEvent } from 'react';

import { HeartRing } from './HeartRing';
import type { CompanionColumnView } from './landingModel';

export interface CompanionColumnProps {
  view: CompanionColumnView;
  onOpen: (view: CompanionColumnView) => void;
  onFocus: (index: number) => void;
}

/** The lamp follows the pointer, so hovering a column lifts its own colour. */
function trackLamp(event: PointerEvent<HTMLButtonElement>): void {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--hl-px', `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty('--hl-py', `${event.clientY - box.top}px`);
}

export const CompanionColumn = forwardRef<HTMLButtonElement, CompanionColumnProps>(
  function CompanionColumn({ view, onOpen, onFocus }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="hl-col"
        data-role="column"
        data-id={view.id}
        data-state={view.state}
        data-working={view.working ? '1' : '0'}
        data-testid={`companion-column-${view.id}`}
        aria-label={view.ariaLabel}
        onClick={() => onOpen(view)}
        onFocus={() => onFocus(view.index - 1)}
        onPointerMove={trackLamp}
      >
        <img className="hl-portrait" data-role="portrait" src={view.portraitSrc} alt="" draggable={false} />
        <span className="hl-cold" />
        <span className="hl-hatch" />
        <span className="hl-scrim" />
        <span className="hl-lamp" />

        <HeartRing id={view.id} spec={view.ring} beads={view.beads} lit={view.state === 'active'} />

        <span className="hl-count" data-role="facts" aria-hidden="true">
          {view.count ? (
            <>
              <b>{view.count.value}</b>
              <span>{view.count.label}</span>
            </>
          ) : null}
        </span>

        <span className="hl-key" aria-hidden="true">
          <kbd>{view.index}</kbd>
        </span>
        <span className="hl-word" data-role="state" aria-hidden="true">
          <i />
          {view.stateWord}
        </span>

        <span className="hl-copy">
          <span className="hl-name" data-role="name">
            {view.name}
          </span>
          <span className="hl-title" data-role="title">
            {view.title}
          </span>
          <span className="hl-tag" data-role="tagline">
            {view.tagline}
          </span>
          {view.blockerLine ? (
            <span className="hl-wake" data-role="blocker">
              {view.blockerLine}
              <ArrowRight size={14} strokeWidth={1.6} aria-hidden="true" />
            </span>
          ) : (
            <span className="hl-open" data-role="open">
              {view.openLine}
              <ArrowRight size={14} strokeWidth={1.6} aria-hidden="true" />
            </span>
          )}
        </span>
      </button>
    );
  },
);

/** The same column frame with no art and no words yet: the cold-load ghost. */
export function CompanionColumnGhost({ id, index }: { id: string; index: number }) {
  return (
    <div className="hl-col" data-role="column" data-id={id} data-state="loading" aria-hidden="true">
      <span className="hl-scrim" />
      <span className="hl-ghost hl-ghost-ring" />
      <span className="hl-ghost hl-ghost-name" />
      <span className="hl-ghost hl-ghost-title" />
      <span className="hl-key">
        <kbd>{index}</kbd>
      </span>
    </div>
  );
}
