// THE PROJECT CARD, three ways.
//
// Round 1 drew projects with the kit's `Tile` and the owner's verdict was that
// the cards were the weakness — a generic container with "N personas" under it
// says almost nothing a fleet operator needs. These are drawn components
// instead: the point of each is its SHAPE, which is what doctrine 6c means by a
// figure, and what the kit explicitly does not govern.
//
// What all three carry, and none of them spell out in words:
//   · the project's name, never truncated to one unreadable line
//   · its DOMINANT STATE as the card's own background tone and edge
//   · its crew, drawn one mark per persona in that persona's state colour
//   · what it owes a human, as three sigils that only appear when non-zero:
//     reviews (a decision waiting), warnings (something broke), messages
//     (something unread)
//
// They differ in what they put first:
//   PLATE   identity   — a nameplate with a state rail; the project is a place
//   GAUGE   mix        — the state distribution drawn across the whole card
//   SIGNAL  urgency    — dark glass; a card lights only when it needs you

import { memo, type ComponentType } from 'react';
import { ClipboardCheck, MessageSquare, TriangleAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import type { FollowUps, ProjectUnit } from './useFleetLayers';
import './casesCards.css';

/** Nothing bound, nothing owed. Drawn as a name and little else — see the
 *  `[data-quiet]` block in the stylesheet for why that matters on this fleet. */
export function isQuiet(unit: ProjectUnit): boolean {
  return unit.personas === 0 && unit.followUps.total === 0;
}

export interface ProjectCardProps {
  unit: ProjectUnit;
  onOpen: (projectId: string) => void;
}

export type ProjectCardComponent = ComponentType<ProjectCardProps>;

/** The crew: one mark per persona, in that persona's state colour, worst
 *  first. Capped so a 40-agent project stays a shape rather than a wall; the
 *  remainder is said once, in figures. */
const CREW_CAP = 28;

function Crew({ states, label }: { states: Record<SquareState, number>; label: string }) {
  const marks: SquareState[] = [];
  for (const s of SQUARE_STATE_ORDER) {
    for (let i = 0; i < states[s] && marks.length < CREW_CAP; i += 1) marks.push(s);
  }
  const total = SQUARE_STATE_ORDER.reduce((n, s) => n + states[s], 0);
  const rest = total - marks.length;
  return (
    <span className="pc__crew" role="img" aria-label={label}>
      {marks.map((s, i) => <span key={i} className="pc__cell" data-s={s} aria-hidden />)}
      {rest > 0 && (
        <span className="typo-caption text-foreground" aria-hidden>+<Numeric value={rest} /></span>
      )}
    </span>
  );
}

/** The three kinds of follow-up, drawn. A zero is absent rather than printed:
 *  an empty row is the fastest way to read "nothing here wants me". */
function FollowUpSigils({ ups, labels }: { ups: FollowUps; labels: Record<string, string> }) {
  if (ups.total === 0) return null;
  const items = [
    { k: 'reviews' as const, n: ups.reviews, Icon: ClipboardCheck },
    { k: 'warnings' as const, n: ups.warnings, Icon: TriangleAlert },
    { k: 'messages' as const, n: ups.messages, Icon: MessageSquare },
  ].filter((i) => i.n > 0);
  return (
    <span className="pc__ups">
      {items.map(({ k, n, Icon }) => (
        <span key={k} className={`pc__up pc__up--${k} typo-caption`}>
          <Icon aria-hidden />
          <span className="tabular-nums"><Numeric value={n} /></span>
          <span className="sr-only">{labels[k]}</span>
        </span>
      ))}
    </span>
  );
}

function useCardLabels() {
  const { t, tx } = useTranslation();
  return {
    labels: {
      reviews: t.monitor.conv_tab_reviews,
      warnings: t.monitor.grid_state_failed,
      messages: t.monitor.grid_rail_tab_messages,
    },
    crewLabel: (u: ProjectUnit) => tx(t.monitor.layers_crew_aria, {
      running: u.states.running, attention: u.states.attention,
      failed: u.states.failed, idle: u.states.idle,
    }),
    openLabel: (u: ProjectUnit) => tx(t.monitor.layers_open_aria, { project: u.name }),
  };
}

/**
 * The press target. The card is a FIGURE, so the button is a stretched overlay
 * rather than the card's own element — the same shape the kit's own `ListRow`
 * uses (`.k-row__press::after { inset: 0 }`), and the reason the WHOLE card is
 * pressable here where the kit's `Tile` made only its title pressable.
 */
function CardPress({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onPress}
      aria-label={label}
      data-testid="cases-tile-press"
      className="pc__press"
    />
  );
}

/* -------------------------------------------------------------------------- */

export const PlateCard: ProjectCardComponent = memo(function PlateCard({ unit, onOpen }: ProjectCardProps) {
  const { labels, crewLabel, openLabel } = useCardLabels();
  return (
    <div
      className="pc pc--plate"
      data-state={unit.dominant}
      data-quiet={isQuiet(unit) || undefined}
      data-testid="cases-tile"
    >
      <CardPress label={openLabel(unit)} onPress={() => onOpen(unit.projectId)} />
      <span className="pc__name typo-title">{unit.name}</span>
      <Crew states={unit.states} label={crewLabel(unit)} />
      <span className="pc__foot">
        <FollowUpSigils ups={unit.followUps} labels={labels} />
      </span>
    </div>
  );
});

export const GaugeCard: ProjectCardComponent = memo(function GaugeCard({ unit, onOpen }: ProjectCardProps) {
  const { labels, crewLabel, openLabel } = useCardLabels();
  const total = SQUARE_STATE_ORDER.reduce((n, s) => n + unit.states[s], 0);
  return (
    <div
      className="pc pc--gauge"
      data-state={unit.dominant}
      data-quiet={isQuiet(unit) || undefined}
      data-testid="cases-tile"
    >
      <CardPress label={openLabel(unit)} onPress={() => onOpen(unit.projectId)} />
      <span className="pc__scale">
        <span className="pc__name typo-title">{unit.name}</span>
        <FollowUpSigils ups={unit.followUps} labels={labels} />
      </span>
      {total > 0 && (
        <span className="pc__meter" role="img" aria-label={crewLabel(unit)}>
          {SQUARE_STATE_ORDER.filter((s) => unit.states[s] > 0).map((s) => (
            <span
              key={s}
              className="pc__seg"
              data-s={s}
              style={{ flexGrow: unit.states[s] }}
              aria-hidden
            />
          ))}
        </span>
      )}
    </div>
  );
});

export const SignalCard: ProjectCardComponent = memo(function SignalCard({ unit, onOpen }: ProjectCardProps) {
  const { labels, crewLabel, openLabel } = useCardLabels();
  const lit = unit.followUps.total > 0;
  return (
    <div
      className="pc pc--signal"
      data-state={unit.dominant}
      data-quiet={isQuiet(unit) || undefined}
      data-lit={lit}
      data-testid="cases-tile"
    >
      <CardPress label={openLabel(unit)} onPress={() => onOpen(unit.projectId)} />
      {!lit && unit.states.running > 0 && <span className="pc__tick" aria-hidden />}
      <span className="pc__body">
        <span className="pc__name typo-title">{unit.name}</span>
        <Crew states={unit.states} label={crewLabel(unit)} />
        <FollowUpSigils ups={unit.followUps} labels={labels} />
      </span>
      <span className="pc__total">
        <span className="typo-hero tabular-nums"><Numeric value={unit.followUps.total} /></span>
      </span>
    </div>
  );
});
