// ReloginStatus — the words beside a plan's name while it is being signed in
// again: the step of a running run, the reason a human is needed, and the brief
// "Signed in again". Words, never an icon (the row carries no status glyphs).
// A needs-you reason is shown HERE and on the orb: never as a toast.

import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { reloginReasonLabel, reloginStepLabel, type ReloginView } from './reloginModel';

// The words say what to DO, so they keep their width (up to two thirds of the slot)
// and the account name, which has a tooltip, gives way first.
const CHIP = 'max-w-[65%] flex-shrink-0 truncate whitespace-nowrap typo-caption';

export function ReloginStatus({ view }: { view: ReloginView }) {
  const { t } = useTranslation();
  if (view.kind === 'running') {
    return (
      <span role="status" className={`${CHIP} text-status-info`} data-testid="fleet-usage-relogin-step" data-step={view.step ?? 'opening_profile'}>
        {reloginStepLabel(t, view.step)}
      </span>
    );
  }
  if (view.kind === 'needs_you') {
    const label = reloginReasonLabel(t, view.reason);
    return (
      <Tooltip content={label}>
        <span className={`${CHIP} text-status-warning`} data-testid="fleet-usage-relogin-reason" data-reason={view.reason}>
          {label}
        </span>
      </Tooltip>
    );
  }
  if (view.kind === 'done') {
    return (
      <span role="status" className={`${CHIP} text-status-success`} data-testid="fleet-usage-relogin-done">
        {t.monitor.usage_relogin_done}
      </span>
    );
  }
  return null;
}
