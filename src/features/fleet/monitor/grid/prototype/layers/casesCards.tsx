// PLATE — the project as a nameplate.
//
// Round 2 drew three cards and the owner kept this one; Gauge and Signal are
// gone. Round 3 reshaped it to a strict TWO ROWS — the name, then the crew —
// with what the project owes a human lifted out of the flow entirely and
// parked in the top-right corner, so a card's height never depends on how much
// is wrong with it and a wall of them keeps one rhythm.
//
// THE SIGILS ARE DOORS, not badges. Pressing one lands in the thing that
// resolves it rather than in another layer that lists it:
//   warnings -> the failed persona itself, opened at its activity
//   reviews  -> that project's decisions, in the dock, ready to triage
//   messages -> that project's unread reports, in the dock
// They sit above the card's own press target, so the corner resolves and the
// rest of the card opens the project.
//
// It is a FIGURE, not kit structure (doctrine 6c): colour is a token or a
// color-mix over one, and the shape is the point.

import { memo, type ComponentType } from 'react';
import { ClipboardCheck, MessageSquare, TriangleAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import type { FollowUps, ProjectUnit } from './useFleetLayers';
import './casesCards.css';

/** The three kinds of follow-up a project can owe, and what resolves each. */
export type FollowUpKind = 'reviews' | 'warnings' | 'messages';

export interface ProjectCardProps {
  unit: ProjectUnit;
  onOpen: (projectId: string) => void;
  /** Take me to the thing that resolves this, not to a list of it. */
  onResolve: (unit: ProjectUnit, kind: FollowUpKind) => void;
}

export type ProjectCardComponent = ComponentType<ProjectCardProps>;

/** Nothing bound, nothing owed — drawn as a name and little else. */
export function isQuiet(unit: ProjectUnit): boolean {
  return unit.personas === 0 && unit.followUps.total === 0;
}

/** One mark per persona in that persona's state colour, worst first. Capped so
 *  a 40-agent project stays a shape; the remainder is said once, in figures. */
const CREW_CAP = 26;

function Crew({ states, label }: { states: Record<SquareState, number>; label: string }) {
  const marks: SquareState[] = [];
  for (const s of SQUARE_STATE_ORDER) {
    for (let i = 0; i < states[s] && marks.length < CREW_CAP; i += 1) marks.push(s);
  }
  const rest = SQUARE_STATE_ORDER.reduce((n, s) => n + states[s], 0) - marks.length;
  if (marks.length === 0) return null;
  return (
    <span className="pc__crew" role="img" aria-label={label}>
      {marks.map((s, i) => <span key={i} className="pc__cell" data-s={s} aria-hidden />)}
      {rest > 0 && <span className="pc__rest typo-caption" aria-hidden>+<Numeric value={rest} /></span>}
    </span>
  );
}

const SIGIL = {
  warnings: TriangleAlert,
  reviews: ClipboardCheck,
  messages: MessageSquare,
} as const;

/** The corner. Each sigil is its own button because each resolves a different
 *  thing; one combined "12 things" chip would have to be opened before it could
 *  be acted on, which is the nested layer this round exists to remove. */
function FollowUpCorner({
  ups, labels, onPick,
}: {
  ups: FollowUps;
  labels: Record<FollowUpKind, string>;
  onPick: (kind: FollowUpKind) => void;
}) {
  if (ups.total === 0) return null;
  const items: Array<{ k: FollowUpKind; n: number }> = [
    { k: 'warnings', n: ups.warnings },
    { k: 'reviews', n: ups.reviews },
    { k: 'messages', n: ups.messages },
  ];
  return (
    <span className="pc__corner">
      {items.filter((i) => i.n > 0).map(({ k, n }) => {
        const Icon = SIGIL[k];
        return (
          <Button
            key={k}
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); onPick(k); }}
            aria-label={labels[k]}
            data-testid={`plate-sigil-${k}`}
            className={`pc__up pc__up--${k} typo-caption`}
          >
            <span className="pc__up-in">
              <Icon aria-hidden />
              <span className="tabular-nums"><Numeric value={n} /></span>
            </span>
          </Button>
        );
      })}
    </span>
  );
}

export const PlateCard: ProjectCardComponent = memo(function PlateCard({
  unit, onOpen, onResolve,
}: ProjectCardProps) {
  const { t, tx } = useTranslation();
  const labels: Record<FollowUpKind, string> = {
    reviews: tx(t.monitor.layers_resolve_reviews, { count: unit.followUps.reviews }),
    warnings: tx(t.monitor.layers_resolve_warnings, { count: unit.followUps.warnings }),
    messages: tx(t.monitor.layers_resolve_messages, { count: unit.followUps.messages }),
  };
  const crewLabel = tx(t.monitor.layers_crew_aria, {
    running: unit.states.running, attention: unit.states.attention,
    failed: unit.states.failed, idle: unit.states.idle,
  });

  return (
    <div
      className="pc pc--plate"
      data-state={unit.dominant}
      data-quiet={isQuiet(unit) || undefined}
      data-testid="cases-tile"
    >
      {/* The card's own press target, under the corner. */}
      <Button
        variant="ghost"
        onClick={() => onOpen(unit.projectId)}
        aria-label={tx(t.monitor.layers_open_aria, { project: unit.name })}
        data-testid="cases-tile-press"
        className="pc__press"
      />
      <span className="pc__name typo-title">{unit.name}</span>
      <Crew states={unit.states} label={crewLabel} />
      <FollowUpCorner ups={unit.followUps} labels={labels} onPick={(k) => onResolve(unit, k)} />
    </div>
  );
});
