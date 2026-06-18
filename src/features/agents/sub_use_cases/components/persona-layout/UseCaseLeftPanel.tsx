import type { ReactNode } from 'react';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import { PetalRow } from '@/features/shared/glyph/persona-layout/PetalRow';
import type { PersonaSigilSummaryEntry } from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import { useTranslation } from '@/i18n/useTranslation';
import { getDimLabels } from '../recipes-prototype/shared/displayUseCase';

interface UseCaseLeftPanelProps {
  /** Per-dimension petal state for the active capability (resolved/filling = touched). */
  petalStates?: Partial<Record<GlyphDimension, PetalState>>;
  /** The dim whose editor is currently open (ring highlight). */
  activeDim: GlyphDimension | null;
  /** Per-dim resolved value (label + value node) — drives each row's info box. */
  summaryEntries: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>>;
  /** Click a petal → open that dim's editor (mirrors a hero-petal click). */
  onSelectDim: (dim: GlyphDimension) => void;
}

const isLit = (s: PetalState | undefined) => s === 'resolved' || s === 'filling';

/**
 * View-mode left rail — migrated (2026-06-18) to the template-adoption "Petals"
 * pattern via the shared `PetalRow`: one row per glyph dimension showing the
 * active capability's state (lit icon + status pip) and its resolved value
 * inline (connector icons for Apps, channel list for Messages, "Activated" for
 * Memory/Review…), each row clickable to open that dim's editor. Replaces the
 * former Connections / Messages cards + value-summary stack.
 */
export function UseCaseLeftPanel({ petalStates, activeDim, summaryEntries, onSelectDim }: UseCaseLeftPanelProps) {
  const { t } = useTranslation();
  const dimLabels = getDimLabels(t) as Record<string, string>;
  const covered = GLYPH_DIMENSIONS.filter((d) => isLit(petalStates?.[d])).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex w-full items-center justify-between px-0.5">
        <span className="typo-label uppercase tracking-[0.2em] text-foreground">
          {t.agents.use_cases.petals_label}
        </span>
        <span className="typo-caption tabular-nums">
          {covered}/{GLYPH_DIMENSIONS.length}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {GLYPH_DIMENSIONS.map((dim) => {
          const entry = summaryEntries[dim];
          const label = dimLabels[dim] ?? dim;
          const valueIsString = typeof entry?.value === 'string';
          const info: ReactNode =
            entry?.value != null ? (
              valueIsString ? (
                <span className="typo-caption truncate text-foreground">{entry.value as string}</span>
              ) : (
                entry.value
              )
            ) : null;
          const tooltip = entry
            ? valueIsString
              ? `${entry.label} — ${entry.value as string}`
              : entry.label
            : label;
          return (
            <PetalRow
              key={dim}
              dim={dim}
              state={petalStates?.[dim] ?? 'idle'}
              active={activeDim === dim}
              info={info}
              tooltip={tooltip}
              ariaLabel={entry?.label ?? label}
              onSelect={onSelectDim}
            />
          );
        })}
      </div>
    </div>
  );
}
