/**
 * Small parts of the BANDS L1: the status/target line under a milestone's
 * name, the ghost bands shown while the lanes load, and the add-milestone row.
 */
import { CalendarClock, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useI18nStore } from '@/stores/i18nStore';

import { useProgressView } from '../../canvasHost';
import type { MilestoneLane } from '../../milestoneOps';
import { milestoneMeta } from '../milestoneMeta';
import { BAND_HEAD_W } from './Band';
import { formatTarget } from './bandsModel';

/** Status pill (the milestone vocabulary's one tone) + the target date. */
export function MilestoneMetaLine({ lane }: { lane: MilestoneLane }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const language = useI18nStore((s) => s.language);
  const meta = milestoneMeta(dl, lane.status);
  const target = formatTarget(lane.targetDate, language);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border typo-caption ${meta.tone.text} ${meta.tone.bg} ${meta.tone.border}`}
        data-status={meta.status}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${meta.tone.icon}`} aria-hidden="true" />
        {meta.label}
      </span>
      {target && (
        <span className="inline-flex items-center gap-1 typo-caption tabular-nums truncate">
          <CalendarClock className="w-3 h-3 shrink-0" aria-hidden="true" />
          {tx(dl.layers_target, { date: target })}
        </span>
      )}
    </div>
  );
}

const GHOST_BANDS = 3;

/** The lanes are on their way: calm placeholder bands at the bands' own geometry. */
export function GhostBands() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label={t.plugins.dev_lifecycle.layers_loading} data-testid="layers-bands-ghost">
      {Array.from({ length: GHOST_BANDS }, (_, i) => {
        const delay = { animationDelay: `${150 + i * 35}ms` };
        return (
          <div key={i} className="flex items-stretch min-h-[60px] rounded-card border border-primary/5" aria-hidden="true">
            <div className="shrink-0 flex flex-col justify-center gap-2 px-4 border-r border-primary/5" style={{ width: BAND_HEAD_W }}>
              <span className="block h-3.5 w-36 rounded-input bg-primary/[0.06] animate-fade-in" style={delay} />
              <span className="block h-2.5 w-20 rounded-input bg-primary/[0.06] animate-fade-in" style={delay} />
            </div>
            <div className="flex-1 flex items-center gap-1 px-3">
              {Array.from({ length: 4 + i }, (__, s) => (
                <span key={s} className="block flex-1 h-[34px] rounded-input bg-primary/[0.05] animate-fade-in" style={delay} />
              ))}
            </div>
            <div className="shrink-0 w-32" />
          </div>
        );
      })}
    </div>
  );
}

/** The non-right-click route to a new milestone, as a full-width quiet row. */
export function AddMilestoneRow({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { canvas } = useProgressView();
  return (
    <Button
      variant="ghost"
      block
      icon={<Plus className="w-4 h-4" />}
      loading={canvas.busy}
      disabled={canvas.busy}
      onClick={() => canvas.startCreateMilestone(projectId)}
      data-testid="layers-bands-add-milestone"
      className="border border-dashed border-primary/20 hover:border-primary/40 py-3 typo-body"
    >
      {t.plugins.dev_lifecycle.layers_add_milestone}
    </Button>
  );
}
