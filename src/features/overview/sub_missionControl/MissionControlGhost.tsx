// Mission Control's cold-load placeholder for the Vitals pane.
//
// Why this exists (docs/design/overview-loading.md law 1, §A): the dashboard's
// `isEmpty` is a CLAIM about the data — "you have no personas and no
// executions". Until the pipeline has reported on globalExecutions the surface
// does not know whether that claim is true, and `DashboardEmptyState` asserted
// into that window is a lie the user reads, not a placeholder. So the unknown
// window paints this instead.
//
// It is the §C module-local ghost for a non-tabular region: the REAL pane
// chrome (law 5 — `PaneHeader` renders its real labels, outside any loading
// branch), calm `bg-primary/[0.06]` bars with no pulse, and the entrance delay
// on the placeholder rather than the content (law 3) so a warm visit — where
// the store is already primed and the pipeline's TTL skips the fetch
// entirely — never paints a frame of it.
//
// It covers the VITALS pane only. `MissionStatusMonitor`, the other half of
// that row, owns its own fetch and its own settled empty state, and law 6 ("no
// region waits on another region's fetch") says its placeholder is not this
// region's business — so it keeps rendering live underneath.

import { useTranslation } from '@/i18n/useTranslation';
import { PaneHeader } from './PaneHeader';

const BAR = 'bg-primary/[0.06]';

/** Ring + 2x2 tile + sparkline geometry of `VitalsConsole`. */
const RING_SIZE = 164;

function Bar({ className, delay }: { className: string; delay: number }) {
  return (
    <span
      className={`block rounded-card ${BAR} ${className} animate-fade-in`}
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

export function MissionControlGhost() {
  const { t } = useTranslation();
  return (
    // Same frame, same header, same body geometry as `VitalsConsole`.
    <div
      className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col"
      aria-hidden="true"
    >
      <PaneHeader
        label={t.overview.dashboard.pane_vitals}
        subtitle={t.overview.dashboard.vitals_subtitle_fleet}
      />
      <div className="flex-1 flex flex-col items-center gap-5 px-4 py-6">
        <span
          className="block rounded-full border-[10px] border-primary/[0.06] animate-fade-in"
          style={{ width: RING_SIZE, height: RING_SIZE, animationDelay: '120ms' }}
        />
        <div className="w-full grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-card border border-primary/10 px-2.5 py-2 space-y-2 animate-fade-in"
              style={{ animationDelay: `${155 + i * 35}ms` }}
            >
              <Bar className="h-2.5 w-14" delay={155 + i * 35} />
              <Bar className="h-5 w-10" delay={155 + i * 35} />
            </div>
          ))}
        </div>
        <div className="w-full pt-3 border-t border-primary/10 space-y-1.5">
          <Bar className="h-2.5 w-28" delay={295} />
          <Bar className="h-10 w-full" delay={295} />
        </div>
      </div>
    </div>
  );
}
