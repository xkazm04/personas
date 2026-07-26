import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { TableSkeleton, type TableSkeletonColumn } from '@/features/shared/components/layout/TableSkeleton';

/**
 * Calm, content-shaped placeholders for the Certification Command Center's
 * three data regions (overview grid, run-history table, run detail) — sized
 * to their real geometry so `LoadingReveal` cross-fades rather than resizes.
 * No pulse; static low-contrast bars per the golden loading pattern
 * (`docs/design/overview-loading.md`).
 */

const bar = 'bg-primary/[0.06]';

/** Mirrors `CertOverview`: certified-count caption + a grid of `TeamCertCard`s. */
export function CertOverviewPlaceholder() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className={`w-4 h-4 rounded ${bar}`} />
        <span className={`h-3 w-32 rounded ${bar}`} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-modal border border-primary/10 bg-secondary/20 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full ${bar}`} />
                <span className={`h-3.5 w-24 rounded ${bar}`} />
              </div>
              <span className={`h-4 w-14 rounded-card ${bar}`} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {Array.from({ length: 3 }).map((__, j) => (
                  <span key={j} className={`w-2.5 h-2.5 rounded-full ${bar}`} />
                ))}
              </div>
              <span className={`h-3 w-16 rounded ${bar}`} />
            </div>
            <span className={`block h-1.5 w-full rounded-full ${bar}`} />
            <span className={`block h-3 w-20 rounded ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mirrors `RunHistoryView`'s `UnifiedTable` — team/seed/verdict/score/gates/started columns. */
const RUN_HISTORY_COLUMNS: TableSkeletonColumn[] = [
  { span: 'col-span-3', width: 'w-full max-w-[7rem]' },
  { span: 'col-span-3', width: 'w-full max-w-[8rem]' },
  { span: 'col-span-2', width: 'w-full max-w-[4.5rem]' },
  { span: 'col-span-1', width: 'w-8', alignRight: true },
  { span: 'col-span-1', width: 'w-10' },
  { span: 'col-span-2', width: 'w-full max-w-[3.5rem]' },
];

export function RunHistoryPlaceholder() {
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 overflow-hidden">
      <TableSkeleton columns={RUN_HISTORY_COLUMNS} rows={8} rowPaddingY="py-2.5" calm />
    </div>
  );
}

/** Mirrors `RunDetailView`: back/timestamp row, header, stat chips, section cards. */
export function RunDetailPlaceholder() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="flex items-center justify-between gap-3">
        <span className={`h-7 w-20 rounded-card ${bar}`} />
        <span className={`h-3 w-24 rounded ${bar}`} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center flex-wrap gap-3">
          <span className={`h-5 w-40 rounded ${bar}`} />
          <span className={`h-4 w-16 rounded-card ${bar}`} />
        </div>
        <span className={`block h-3 w-52 rounded ${bar}`} />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col px-3 py-1.5 rounded-card bg-secondary/30 border border-primary/10 min-w-[5rem] gap-1.5">
            <span className={`h-2.5 w-10 rounded ${bar}`} />
            <span className={`h-3.5 w-8 rounded ${bar}`} />
          </div>
        ))}
      </div>

      <div className="rounded-modal border border-primary/10 bg-secondary/20 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-primary/10">
          <span className={`h-3.5 w-32 rounded ${bar}`} />
        </div>
        <ListSkeleton calm rows={4} rowHeight={40} leading={false} className="p-2" />
      </div>

      <div className="rounded-modal border border-primary/10 bg-secondary/20 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-primary/10">
          <span className={`h-3.5 w-40 rounded ${bar}`} />
        </div>
        <div className="p-4">
          <span className={`block h-20 w-full rounded ${bar}`} />
        </div>
      </div>
    </div>
  );
}
