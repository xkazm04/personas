// Soundings — the small marks every level shares: the status mark (hue from
// --status-*, AND a shape, so status never rests on hue alone), the progress
// ladder, the release tide, and the two waterline glyphs.
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { DimNode, DimStatus, IslandShip } from '../lib/types';
import type { StationMark } from './soundingsModel';

/** Status -> the token the mark paints with (the card and ladder read it as --c). */
export const STATUS_COLOR: Record<DimStatus | StationMark, string> = {
  solid: 'var(--sd-solid)',
  calm: 'var(--sd-solid)',
  partial: 'var(--sd-partial)',
  risk: 'var(--sd-risk)',
  alert: 'var(--sd-alert)',
  absent: 'var(--sd-absent)',
  unknown: 'var(--sd-unknown)',
};

export function StatusMark({ status, className, style }: { status: DimStatus | StationMark; className?: string; style?: CSSProperties }) {
  return <i className={className ? `sd-mk ${className}` : 'sd-mk'} data-s={status} style={style} aria-hidden />;
}

/** The inline ladder on a frame: one pip per step, or a yes / partly / no disc. */
export function Ladder({ node }: { node: DimNode }) {
  const { t, tx } = useTranslation();
  if (!node.steps) {
    const on = node.status === 'solid';
    const half = node.status === 'partial';
    const label = on ? t.mastermind.soundings_yes : half ? t.mastermind.soundings_partly : t.mastermind.soundings_no;
    return (
      <span className="sd-lad" role="img" aria-label={label}>
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
          <circle cx="7.5" cy="7.5" r="6.2" fill={on ? 'var(--c)' : 'none'} stroke="var(--c)" strokeWidth="1.4" strokeDasharray={half ? '3 2.2' : undefined} />
          {(on || half) && (
            <path d="M4.4 7.7l2.1 2.1 4-4.4" fill="none" stroke={on ? 'var(--background)' : 'var(--c)'} strokeWidth={on ? 1.8 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </span>
    );
  }
  return (
    <span className="sd-lad" role="img" aria-label={tx(t.mastermind.soundings_steps_aria, { reached: node.reached, steps: node.steps })}>
      {Array.from({ length: node.steps }, (_, k) => <i key={k} className={k < node.reached ? 'sd-on' : undefined} />)}
    </span>
  );
}

/** The release as a tide gauge: shipped milestones filled, the next one outlined
 *  (hatched when it is late). */
export function Tide({ ship, className }: { ship: IslandShip; className?: string }) {
  const total = Math.max(ship.total, 1);
  return (
    <span className={className ? `sd-tide ${className}` : 'sd-tide'} aria-hidden>
      {Array.from({ length: total }, (_, k) => {
        let cls: string | undefined;
        if (k < ship.shipped) cls = 'sd-on';
        else if (k === ship.shipped) cls = ship.late ? 'sd-late' : 'sd-next';
        return <i key={k} className={cls} />;
      })}
    </span>
  );
}

/** A lilac flag: an agent waits for the owner's input. */
export function FlagGlyph() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" aria-hidden>
      <path d="M1.5 12.5V1" stroke="var(--sd-lilac)" strokeWidth="1.4" />
      <path d="M2 1.2h7.5L7.4 4l2.1 2.8H2z" fill="var(--sd-lilac)" />
    </svg>
  );
}

/** Two swells: the release is past its target. */
export function TideGlyph() {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden>
      <path d="M1 3.5q2-2 4 0t4 0M1 7.5q2-2 4 0t4 0" fill="none" stroke="var(--sd-risk)" strokeWidth="1.2" />
    </svg>
  );
}

/** The dock's sonar: three rings, the outer two sweep while Athena is steering. */
export function SonarGlyph() {
  return (
    <svg className="sd-sonar" viewBox="0 0 18 18" aria-hidden>
      <circle className="sd-c1" cx="9" cy="9" r="2" />
      <circle className="sd-c2" cx="9" cy="9" r="5" />
      <circle className="sd-c3" cx="9" cy="9" r="8" />
    </svg>
  );
}

/** Passport tool strings name their parts with dashes ("GitHub Actions — 17
 *  gates"); the chart shows them with a middle dot, like every other pair. */
export function toolText(s: string | null | undefined): string {
  return s ? s.replace(/\s*[—–]\s*/g, ' · ') : '';
}
