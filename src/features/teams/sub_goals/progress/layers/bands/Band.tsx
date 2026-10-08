/**
 * One BAND: a milestone (or the project's unassigned goals) as a wide strip.
 *
 *   [ name / objective / status + target ] [ segment per goal ......... ] [ 42% ]
 *
 * The whole band is a door to L2: a ghost Button stretched under the content
 * takes every click that lands outside a segment (the "stretched link"
 * pattern - one real control, no nested buttons, keyboard reachable). The
 * header and the percent let the pointer through to it; the segments sit
 * above it and open L2 with their goal selected.
 */
import type { ReactNode } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { useI18nStore } from '@/stores/i18nStore';

import { BandSegments } from './BandSegments';
import { formatPct } from './bandsModel';

export const BAND_HEAD_W = 260;

export interface BandProps {
  testId: string;
  title: string;
  subtitle?: string | null;
  /** The status pill / target line under the title. */
  meta?: ReactNode;
  goals: readonly DevGoal[];
  /** `null` - no goal is bound: say so, never 0%. */
  progress: number | null;
  doneCount: number;
  /** The unassigned band draws dashed: it is a remainder, not a cut. */
  dashed?: boolean;
  onOpen: () => void;
  onOpenGoal: (goalId: string) => void;
}

export function Band({ testId, title, subtitle, meta, goals, progress, doneCount, dashed, onOpen, onOpenGoal }: BandProps) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const language = useI18nStore((s) => s.language);
  const complete = progress === 100;

  return (
    <div
      data-testid={testId}
      className={[
        'relative flex items-stretch min-h-[60px] rounded-card border transition-colors',
        dashed
          ? 'border-dashed border-primary/20 bg-secondary/10'
          : 'border-primary/10 bg-gradient-to-r from-card/70 to-card/30 hover:border-primary/25',
      ].join(' ')}
    >
      <Button
        variant="ghost"
        aria-label={tx(dl.layers_open_milestone, { milestone: title })}
        data-testid={`${testId}-open`}
        onClick={onOpen}
        className="absolute inset-0 w-full h-full"
      />

      <div
        className="pointer-events-none relative shrink-0 flex flex-col justify-center gap-1 px-4 py-2.5 border-r border-primary/10 min-w-0"
        style={{ width: BAND_HEAD_W }}
      >
        <span className="typo-heading text-foreground truncate">{title}</span>
        {subtitle && <span className="typo-caption truncate">{subtitle}</span>}
        {meta}
      </div>

      <div className="pointer-events-none relative flex-1 min-w-0 flex items-center px-3 py-3">
        <BandSegments goals={goals} testId={testId} onOpenGoal={onOpenGoal} />
      </div>

      <div className="pointer-events-none relative shrink-0 w-32 flex flex-col items-end justify-center px-4 py-2">
        {progress === null ? (
          <span className="typo-caption text-foreground text-right" data-testid={`${testId}-no-goals`}>
            {dl.layers_no_goals}
          </span>
        ) : (
          <>
            <span
              className={`typo-data-lg leading-none ${complete ? 'text-status-success' : 'text-foreground'}`}
              data-testid={`${testId}-pct`}
            >
              {formatPct(progress, language)}
            </span>
            <span className="typo-caption tabular-nums mt-1">
              {tx(dl.layers_goals_done, { done: doneCount, total: goals.length })}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
