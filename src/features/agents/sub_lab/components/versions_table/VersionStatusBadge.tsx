import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { useTranslation } from '@/i18n/useTranslation';
import type { VersionRow } from '../../libs/versionMatrixRows';

/**
 * Primary status mark for a (version, model) row. Priority: active beats
 * archived beats measured beats unmeasured. The baseline marker is shown
 * separately (a star in the Version cell), so it can co-exist with any status.
 */
export function VersionStatusBadge({ row }: { row: VersionRow }) {
  const { t } = useTranslation();
  const lab = t.agents.lab;

  let label: string;
  let state: StateMarkState;
  if (row.isActive) {
    label = lab.vr_status_active;
    state = 'decided';
  } else if (row.isArchived) {
    label = lab.vr_status_archived;
    state = 'skipped';
  } else if (row.rating) {
    label = lab.vr_status_measured;
    state = 'done';
  } else {
    label = lab.vr_status_unmeasured;
    state = 'blank';
  }

  return <StateMark state={state} label={label} />;
}
