// The backlog header's Trust popover: the scan autonomy ladder per slice
// (`<category>|<lens>|<risk_class>|<size>`), as the store computes it from its
// own decision history - level L0-L3, agreement over the current window, n,
// and the slice's newest transition. Read-only: levels are earned and lost by
// decisions, never set here.
import { useCallback, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import * as devApi from '@/api/devTools/devTools';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ScanTrustReport } from '@/lib/bindings/ScanTrustReport';
import type { ScanTrustSlice } from '@/lib/bindings/ScanTrustSlice';
import { formatNumeric } from '@/lib/utils/formatters';
import { errMsg } from '@/stores/storeTypes';

const LEVEL_TONE = [
  'text-foreground border-primary/20 bg-primary/5',
  'text-status-info border-status-info/30 bg-status-info/10',
  'text-status-success border-status-success/30 bg-status-success/10',
  'text-role-agent border-role-agent/30 bg-role-agent/10',
];

export function ScanTrustPopover({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ScanTrustReport | null>(null);
  // The rejection VALUE, resolved to product copy at the render site.
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await devApi.getScanTrust(projectId));
    } catch (err) {
      setError(err ?? new Error('scan trust read failed'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        icon={<ShieldCheck className="w-3.5 h-3.5" />}
        loading={loading && open}
        aria-expanded={open}
        onClick={toggle}
      >
        {r.backlog_trust_button}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-96 max-h-96 overflow-y-auto p-3 rounded-card border border-primary/15 bg-background shadow-elevation-3 flex flex-col gap-2">
          <h3 className="typo-heading text-foreground">{r.backlog_trust_title}</h3>
          {error ? (
            <InlineErrorBanner message={resolveErrorTranslated(t, errMsg(error, '')).message} onRetry={() => void load()} />
          ) : report && report.slices.length === 0 ? (
            <p className="typo-body text-foreground">{r.backlog_trust_empty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-primary/10">
              {(report?.slices ?? []).map((s) => <SliceRow key={s.slice} slice={s} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SliceRow({ slice }: { slice: ScanTrustSlice }) {
  const { t, tx, language } = useTranslation();
  const r = t.overview.review;
  const agreement = slice.agreement ?? null;
  return (
    <li className="flex flex-col gap-1 py-2 min-w-0">
      <span className="flex items-center gap-2 min-w-0">
        <span className={`typo-caption rounded-full border px-2 py-0.5 tabular-nums ${LEVEL_TONE[slice.level] ?? LEVEL_TONE[0]}`}>
          {tx(r.backlog_trust_level, { level: slice.level })}
        </span>
        <span className="typo-caption text-foreground truncate min-w-0 flex-1">{slice.slice}</span>
        <span className="typo-caption whitespace-nowrap">
          {tx(r.backlog_trust_ceiling, { ceiling: slice.ceiling })}
        </span>
      </span>
      <span className="typo-caption tabular-nums">
        {agreement === null
          ? r.backlog_trust_no_window
          : tx(r.backlog_trust_agreement, {
              percent: formatNumeric(agreement, 'ratio', { language, precision: 0 }),
              n: slice.n,
            })}
      </span>
      {slice.reason && (
        <span className="flex items-center gap-1.5 typo-caption min-w-0">
          <span className="truncate">{tx(r.backlog_trust_last, { reason: slice.reason })}</span>
          {slice.changedAt && <RelativeTime timestamp={slice.changedAt} className="shrink-0" />}
        </span>
      )}
    </li>
  );
}
