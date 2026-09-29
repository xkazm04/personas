/**
 * The interim journey: the "Before the task" and "After the task" lanes on one
 * track, joined by a single path line through every node. A node is the step's
 * glyph inside a shape whose border encodes its strongest binding state (shape
 * AND colour, see journeyStyles), with up to eight evidence dots under it,
 * newest on the right. Keyboard: the track is one tab stop; arrow keys, Home
 * and End move along the nodes; Enter opens the step.
 *
 * TEMPORARY: the lifecycle-nextgen contest winner replaces this view. The
 * model (journeyModel) and data hook (useLifecycleSnapshot) stay.
 */
import { useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

import type { JourneyLanes, JourneyNode } from './journeyModel';
import { bindingStateLabel, outcomeLabel, stepGlyph, stepLabel } from './journeyLabels';
import { OUTCOME_DOT, STATE_SHAPE, STATE_TEXT } from './journeyStyles';

interface JourneyTrackProps {
  lanes: JourneyLanes;
  onOpen: (node: JourneyNode) => void;
}

export function JourneyTrack({ lanes, onOpen }: JourneyTrackProps) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const order = [...lanes.before, ...lanes.after];
  const [focusIndex, setFocusIndex] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(order.length - 1, next));
    setFocusIndex(clamped);
    refs.current[clamped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: focusIndex + 1, ArrowDown: focusIndex + 1,
      ArrowLeft: focusIndex - 1, ArrowUp: focusIndex - 1,
      Home: 0, End: order.length - 1,
    };
    const next = keys[e.key];
    if (next === undefined) return;
    e.preventDefault();
    move(next);
  };

  const renderLane = (title: string, nodes: JourneyNode[], offset: number, testId: string) => (
    <div role="group" aria-label={title} className="flex flex-col gap-3 shrink-0" data-testid={testId}>
      <span className="typo-card-label text-foreground px-1 h-5 whitespace-nowrap">{title}</span>
      <ol className="flex items-start gap-2">
        {nodes.map((node, i) => {
          const index = offset + i;
          const label = stepLabel(dl, node.id, node.label);
          const Glyph = stepGlyph(node.id);
          return (
            <li key={node.id} className="w-20 flex flex-col items-center gap-2">
              {/* Opaque backing so the path line never shows through the tinted node. */}
              <span className="relative z-10 rounded-modal bg-background">
                <Button
                  ref={(el) => { refs.current[index] = el; }}
                  variant="ghost"
                  size="icon-lg"
                  tabIndex={index === focusIndex ? 0 : -1}
                  onFocus={() => setFocusIndex(index)}
                  onClick={() => onOpen(node)}
                  aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, node.strongestState) })}
                  data-testid={`lc-node-${node.id}`}
                  data-state={node.strongestState}
                  className={STATE_SHAPE[node.strongestState]}
                  icon={<Glyph className={`w-5 h-5 ${STATE_TEXT[node.strongestState]}`} aria-hidden />}
                />
              </span>
              <span className="typo-caption text-foreground text-center truncate max-w-full">{label}</span>
              <Dots node={node} />
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={dl.lc_journey_label}
        onKeyDown={onKeyDown}
        className="relative flex w-max mx-auto items-start gap-8 px-2"
        data-testid="lc-journey-track"
      >
        {/* The single path line through every node centre: lane title (h-5, 20px) + gap-3 (12px) + half a node (icon-lg, 22px) = 54px. */}
        <span aria-hidden className="absolute left-12 right-12 top-[3.375rem] h-px bg-primary/25" />
        {renderLane(dl.lc_lane_before, lanes.before, 0, 'lc-lane-before')}
        {renderLane(dl.lc_lane_after, lanes.after, lanes.before.length, 'lc-lane-after')}
      </div>
    </div>
  );
}

function Dots({ node }: { node: JourneyNode }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  if (node.dots.length === 0) return <span className="h-1.5" aria-hidden />;
  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <span role="img" aria-label={summary} className="flex items-center gap-1" data-testid={`lc-dots-${node.id}`}>
      {node.dots.map((d) => (
        <span
          key={`${d.sourceKind}:${d.sourceRef}`}
          data-outcome={d.outcome}
          className={`w-1.5 h-1.5 rounded-full ${OUTCOME_DOT[d.outcome]}`}
        />
      ))}
    </span>
  );
}
