// Soundings L2 — what BOTH cards share: the contract with the page, the words,
// and the comparison strip they both end in.
//
// Split out of SoundingsCard.tsx 2026-10-06 (341 lines, two large components
// and four hooks in one file).
import { useTranslation } from '@/i18n/useTranslation';

import type { DimNode, IslandEdge } from '../lib/types';
import { compareY, stationCentre, type Box, type ChartGeo } from './soundingsGeometry';
import { StatusMark } from './soundingsParts';
import type { Band, Station } from './soundingsModel';

export type Anchor = { clientX: number; clientY: number };

/** The doors out of the chart. Every one of these is the page's own handler:
 *  the card never navigates by itself. */
export interface CardHandlers {
  onImprove: (node: DimNode, anchor: Anchor) => void;
  onCompare: (station: number) => void;
  onFollow: (station: number, edge: IslandEdge) => void;
  onSession: (sessionId: string) => void;
  onPersonas: (anchor: Anchor) => void;
  onRunners: (anchor: Anchor) => void;
  onShip: () => void;
  onFactory: () => void;
  onDispatch: () => void;
  onTerminal: () => void;
  canTerminal: boolean;
}

export const anchorOf = (e: React.MouseEvent<HTMLElement>): Anchor => {
  const r = e.currentTarget.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.bottom };
};

export function useBandWords() {
  const { t } = useTranslation();
  const m = t.mastermind;
  return {
    name: [m.soundings_band_surface, m.soundings_band_shallows, m.soundings_band_midwater, m.soundings_band_deep] as const,
    mean: [m.soundings_band_surface_mean, m.soundings_band_shallows_mean, m.soundings_band_midwater_mean, m.soundings_band_deep_mean] as const,
  };
}

export function useStatusWord() {
  const { t } = useTranslation();
  const m = t.mastermind;
  return (s: DimNode['status']): string =>
    ({ solid: m.legend_solid, partial: m.legend_partial, risk: m.legend_risk, alert: m.legend_alert, absent: m.legend_absent, unknown: m.legend_unknown })[s];
}

export function useActionWord() {
  const { t } = useTranslation();
  const m = t.mastermind;
  return (a: NonNullable<DimNode['action']>): string =>
    ({
      deploy: m.soundings_action_deploy,
      standards: m.soundings_action_standards,
      ideas: m.soundings_action_ideas,
      goals: m.soundings_action_goals,
      kpi: m.soundings_action_kpi,
      'stack-list': m.soundings_action_stack_list,
      'skills-run': m.soundings_action_skills_run,
    })[a];
}

/** The same reading, or the same project, across the whole portfolio - drawn at
 *  the SAME horizontal positions as the chart's stations, so "where does this
 *  sit" is answered in the geometry the owner already knows. */
export function CompareStrip({ stations, g, card, me, label, markFor, related, onPick }: {
  stations: readonly Station[];
  g: ChartGeo;
  card: Box;
  me: number;
  label: string;
  markFor: (s: Station) => { status: Parameters<typeof StatusMark>[0]['status']; band: Band } | null;
  related?: ReadonlySet<number>;
  onPick: (i: number) => void;
}) {
  return (
    <div className="sd-c-cmp">
      <div className="sd-cmp-sea" aria-hidden />
      <span className="sd-cmp-lab typo-label">{label}</span>
      <div className="sd-cmp-wl" style={{ top: compareY(0) + 13 }} aria-hidden />
      {stations.map((s) => {
        const m = markFor(s);
        if (!m) return null;
        const cls = ['sd-cmp-m', s.index === me ? 'sd-me' : '', related?.has(s.index) ? 'sd-rel' : ''].filter(Boolean).join(' ');
        return (
          <button
            key={s.island.slug}
            type="button"
            className={cls}
            style={{ left: Math.round(stationCentre(g, s.index) - card.x) }}
            aria-label={s.island.name}
            onClick={(e) => { e.stopPropagation(); onPick(s.index); }}
          >
            <StatusMark status={m.status} style={{ top: compareY(m.band) - 2 }} />
            <span className="sd-ct">{s.island.name}</span>
          </button>
        );
      })}
    </div>
  );
}
