// Instruments in layer 2: every pipeline source the page reads, with the time
// it last settled clean or the error it settled with, plus the old status
// ticker's shortcuts. This is the "is this page telling the truth" view.

import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import { ListRow, Rows } from '@/features/shared/components/kit';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusTicker } from '../../../StatusTicker';

export function InstrumentsDetail() {
  const { t, language } = useTranslation();
  const { fetchedAt, errors, total, setOverviewTab } = useOverviewStore(useShallow((s) => ({
    fetchedAt: s.pipelineFetchedAt, errors: s.pipelineErrors, total: s.globalExecutionCounts.total, setOverviewTab: s.setOverviewTab,
  })));
  const sources = [...new Set([...Object.keys(fetchedAt), ...Object.keys(errors)])].sort();
  const stamps = Object.values(fetchedAt).filter(Boolean);
  const last = stamps.length ? new Date(Math.max(...stamps)).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) : '-';
  return (
    <div className="mc-detail-stack">
      <StatusTicker
        pipelineSources={Object.keys(fetchedAt).length}
        pipelineErrors={Object.keys(errors).length}
        totalExecutions={total}
        lastSyncedLabel={last}
        onNavigate={setOverviewTab}
      />
      <Rows count={sources.length} empty={{ title: t.overview.mission_layers.state_pending }} label={t.overview.mission_layers.dim_instruments}>
        {sources.map((src) => (
          <ListRow
            key={src}
            name={src}
            mark={errors[src]
              ? { tone: 'error', label: t.overview.mission_layers.state_failed }
              : { tone: 'success', label: t.overview.mission_layers.state_ok }}
            meta={errors[src] ?? undefined}
            time={fetchedAt[src] ? <RelativeTime timestamp={new Date(fetchedAt[src]!).toISOString()} /> : undefined}
          />
        ))}
      </Rows>
    </div>
  );
}
