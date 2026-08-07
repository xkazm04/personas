/**
 * The remote-job history: every instruction this device sent to a paired
 * machine, and every one it was asked to run. Selecting a row expands its
 * progress notes and final summary underneath.
 *
 * The table stays live off `network:remote-job-updated` (merged in
 * `remoteJobsSlice`), never a poll — the whole point of the push is that a job
 * running on the other machine advances here without the operator touching
 * anything.
 */
import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, Radio } from 'lucide-react';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusDot } from '@/features/shared/components/display/StatusDot';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { RemoteJobStatus } from '@/lib/bindings/RemoteJobStatus';
import { useRemoteJobs } from '../lib/useRemoteJobs';
import { RemoteJobDetail } from './RemoteJobDetail';
import { RemoteInstructionComposer } from './RemoteInstructionComposer';

/**
 * Status → StatusDot severity. `refused` and `cancelled` are warnings rather
 * than errors: the peer answered, it just answered no.
 */
const STATUS_STATE: Record<RemoteJobStatus, 'live' | 'paused' | 'offline'> = {
  pending: 'paused',
  running: 'live',
  completed: 'live',
  failed: 'offline',
  refused: 'offline',
  cancelled: 'offline',
};

export function RemoteJobsPanel() {
  const { t } = useTranslation();
  const st = t.sharing;
  const jobs = useRemoteJobs();
  const { selectedId, selectedJob, toggleSelected } = jobs;

  const columns: TableColumn<RemoteJob>[] = useMemo(
    () => [
      {
        key: 'device',
        label: st.col_job_device,
        width: 'minmax(140px, 1.2fr)',
        sortable: true,
        sortFn: (a, b) => a.peerDisplayName.localeCompare(b.peerDisplayName),
        render: (row) => (
          <span className="typo-body text-foreground truncate block">{row.peerDisplayName}</span>
        ),
      },
      {
        key: 'direction',
        label: st.col_job_direction,
        width: '150px',
        render: (row) => (
          <span
            className="inline-flex items-center gap-1.5 typo-caption text-foreground"
            data-testid={`remote-job-direction-${row.id}`}
          >
            {row.direction === 'outbound' ? (
              <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
            ) : (
              <ArrowDownLeft className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden />
            )}
            {row.direction === 'outbound' ? st.direction_outbound : st.direction_inbound}
          </span>
        ),
      },
      {
        key: 'instruction',
        label: st.col_job_instruction,
        width: 'minmax(200px, 2.4fr)',
        render: (row) => (
          <span className="typo-caption text-foreground/90 truncate block" title={row.instruction}>
            {row.instruction}
          </span>
        ),
      },
      {
        key: 'status',
        label: st.col_job_status,
        width: '130px',
        render: (row) => {
          const label = tokenLabel(t, 'remote_job', row.status);
          return (
            <StatusDot kind="connection" state={STATUS_STATE[row.status]} label={label}>
              <span className="typo-caption text-foreground">{label}</span>
            </StatusDot>
          );
        },
      },
      {
        key: 'when',
        label: st.col_job_when,
        width: '120px',
        sortable: true,
        sortFn: (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
        render: (row) => <RelativeTime timestamp={row.updatedAt} />,
      },
    ],
    [t, st],
  );

  return (
    <SectionCard
      title={st.remote_jobs_title}
      subtitle={st.remote_jobs_subtitle}
      icon={<Radio className="w-4 h-4 text-cyan-400" />}
      titleClassName="text-primary"
      action={
        <RemoteJobDirectionFilter value={jobs.direction} onChange={jobs.setDirection} />
      }
    >
      <RemoteInstructionComposer />

      <div data-testid="remote-jobs" className="mt-3">
        <UnifiedTable
          columns={columns}
          data={jobs.jobs}
          getRowKey={(row) => row.id}
          isLoading={jobs.isLoading}
          onRowClick={(row) => toggleSelected(row.id)}
          emptyTitle={st.remote_jobs_empty_title}
          emptyDescription={st.remote_jobs_empty_hint}
        />
      </div>

      {selectedJob && selectedId && (
        <RemoteJobDetail
          job={selectedJob}
          notes={jobs.notes}
          notesLoading={jobs.notesLoading}
          notesError={jobs.notesError}
        />
      )}
    </SectionCard>
  );
}

/** Three-way direction filter. Segmented rather than a dropdown: three options. */
function RemoteJobDirectionFilter({
  value,
  onChange,
}: {
  value: 'all' | 'outbound' | 'inbound';
  onChange: (next: 'all' | 'outbound' | 'inbound') => void;
}) {
  const { t } = useTranslation();
  const st = t.sharing;
  const options = [
    { id: 'all' as const, label: st.direction_filter_all },
    { id: 'outbound' as const, label: st.direction_outbound },
    { id: 'inbound' as const, label: st.direction_inbound },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={st.col_job_direction}
      data-testid="remote-jobs-direction-filter"
      className="inline-flex rounded-interactive border border-primary/15 overflow-hidden"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          data-testid={`remote-jobs-direction-${opt.id}`}
          onClick={() => onChange(opt.id)}
          className={`px-2.5 py-1 typo-caption transition-colors focus-ring ${
            value === opt.id
              ? 'bg-primary/15 text-primary'
              : 'text-foreground hover:bg-secondary/50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
