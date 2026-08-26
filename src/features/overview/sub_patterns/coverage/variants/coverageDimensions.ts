// Shared dimension model for the Coverage lane variants (registry-coverage
// prototype, 2026-08-26). Collapses each of a project's four dimensions —
// registry presence, extraction, applied, freshness — to ONE tone + ONE short
// label + ONE detail, so every variant draws from the same judgement and
// differs only in how it symbolises it. Doctrine preserved from
// coverageModel: absence is `muted` (no signal), never a good zero.

import type { LucideIcon } from 'lucide-react';
import { Clock, Library, Pickaxe, Puzzle } from 'lucide-react';
import type { Translations } from '@/i18n/generated/types';
import type { TileView } from '../coverageModel';

export type DimTone = 'success' | 'info' | 'warning' | 'error' | 'muted';
export type DimKey = 'registry' | 'extracted' | 'applied' | 'freshness';

export interface DimReading {
  key: DimKey;
  icon: LucideIcon;
  label: string;
  tone: DimTone;
  /** Short state word (the chip text). */
  state: string;
  /** One-line supporting detail. */
  detail: string;
}

export const DIM_KEYS: DimKey[] = ['registry', 'extracted', 'applied', 'freshness'];

export const TONE_TEXT: Record<DimTone, string> = {
  success: 'text-status-success',
  info: 'text-status-info',
  warning: 'text-status-warning',
  error: 'text-status-error',
  muted: 'text-foreground/50',
};
export const TONE_BG: Record<DimTone, string> = {
  success: 'bg-status-success',
  info: 'bg-status-info',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  muted: 'bg-foreground/25',
};
export const TONE_CHIP: Record<DimTone, string> = {
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  info: 'border-status-info/30 bg-status-info/10 text-status-info',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  error: 'border-status-error/30 bg-status-error/10 text-status-error',
  muted: 'border-border/60 bg-secondary/40 text-foreground/60',
};

export type ChipTone = DimTone;

/** Worst tone across a project's dimensions — drives the project-level accent. */
export function worstTone(readings: DimReading[]): DimTone {
  const rank: Record<DimTone, number> = { error: 0, warning: 1, muted: 2, info: 3, success: 4 };
  return readings.reduce<DimTone>((w, r) => (rank[r.tone] < rank[w] ? r.tone : w), 'success');
}

export function readDimensions(view: TileView, t: Translations, tx: (s: string, v: Record<string, string | number>) => string): DimReading[] {
  const tc = t.overview.registry_coverage;
  const { tile, harvest, practices } = view;

  const registry: DimReading = tile.presence.inRegistry
    ? { key: 'registry', icon: Library, label: tc.dim_registry, tone: 'success', state: tc.state_in_registry, detail: tile.presence.domains.join(' · ') || tc.state_in_registry }
    : { key: 'registry', icon: Library, label: tc.dim_registry, tone: 'error', state: tc.state_not_in_registry, detail: tc.state_no_signal };

  const harvestEver = harvest !== null && harvest.scopesHarvested > 0;
  const extracted: DimReading = tile.presence.forgedFrom
    ? { key: 'extracted', icon: Pickaxe, label: tc.dim_extracted, tone: 'info', state: tc.state_forged, detail: tc.forged_detail }
    : harvestEver
      ? { key: 'extracted', icon: Pickaxe, label: tc.dim_extracted, tone: 'success', state: tc.state_harvested, detail: tx(tc.harvest_detail, { items: harvest.itemsFound, scopes: harvest.scopesHarvested }) }
      : harvest === null
        ? { key: 'extracted', icon: Pickaxe, label: tc.dim_extracted, tone: 'muted', state: tc.state_no_signal, detail: tc.state_no_signal }
        : { key: 'extracted', icon: Pickaxe, label: tc.dim_extracted, tone: 'muted', state: tc.state_never, detail: tc.never_harvested };

  const map = tile.applied.registryMap;
  const neverMapped = map !== null && !map.exists;
  const appliedDetail = [
    tx(tc.skills_detail_row, { count: tile.applied.skillsAdopted }),
    map === null ? tc.map_no_signal : map.exists ? tx(tc.map_counts, { conformant: map.conformant, deviation: map.deviation, unknown: map.unknown }) : tc.map_never,
    practices !== null ? tx(tc.practices_detail, { adopted: practices.adopted, diverged: practices.diverged }) : tc.practices_no_signal,
  ].join(' · ');
  const applied: DimReading = neverMapped
    ? { key: 'applied', icon: Puzzle, label: tc.dim_applied, tone: 'error', state: tc.state_never_mapped, detail: appliedDetail }
    : view.appliedSignal
      ? { key: 'applied', icon: Puzzle, label: tc.dim_applied, tone: 'success', state: tc.state_applied, detail: appliedDetail }
      : { key: 'applied', icon: Puzzle, label: tc.dim_applied, tone: 'muted', state: tc.state_no_signal, detail: appliedDetail };

  const freshness: DimReading =
    view.freshness === 'never'
      ? { key: 'freshness', icon: Clock, label: tc.dim_freshness, tone: 'muted', state: tc.state_never, detail: tc.state_never }
      : view.freshness === 'behind'
        ? { key: 'freshness', icon: Clock, label: tc.dim_freshness, tone: 'warning', state: tc.state_behind, detail: tc.clock_registry }
        : view.freshnessSignal
          ? { key: 'freshness', icon: Clock, label: tc.dim_freshness, tone: 'success', state: tc.state_synced, detail: tc.clock_project }
          : { key: 'freshness', icon: Clock, label: tc.dim_freshness, tone: 'muted', state: tc.state_no_signal, detail: tc.state_no_signal };

  return [registry, extracted, applied, freshness];
}
