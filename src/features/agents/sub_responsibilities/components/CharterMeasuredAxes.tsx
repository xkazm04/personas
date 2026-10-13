import { useTranslation } from '@/i18n/useTranslation';
import type { ResourceProfile } from '@/lib/bindings/ResourceProfile';
import type { ResponsibilityMeasured } from '@/lib/bindings/ResponsibilityMeasured';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { formatNumeric } from '@/lib/utils/formatters';
import { ResourceBars, useAxisLabels } from '@/features/fleet/monitor/grid/prototype/entry-e/devices/ResourceBars';
import { useProfileLabels } from './charterProfileLabels';

/**
 * What runs of the charter actually took of the machine: CPU, RAM and GPU as
 * the same three bars the Monitor's device plates draw, over how many runs
 * ("learning" until the profile loop has enough of them to act), and - on a
 * profile the loop may not rewrite (pinned, or set by the operator) - a badge
 * naming both values when the measurement maps to different tags.
 *
 * The mapping from shares to tags is the BACKEND's (`measuredMachine` /
 * `measuredGpu`); this card compares tags, it never re-derives them.
 */
export function CharterMeasuredAxes({
  measured,
  stored,
}: {
  measured: ResponsibilityMeasured;
  stored: ResourceProfile | null;
}) {
  const { t, tx, language } = useTranslation();
  const c = t.agents.responsibilities;
  const labels = useProfileLabels();
  const axes = useAxisLabels();
  const runs = measured.resourceRuns;
  const count = formatNumeric(runs, 'count', { language });
  // The profile loop's threshold ships on the payload (backend-owned).
  const required = measured.resourceRunsRequired;
  const learning = runs < required;

  const locked = !!stored && (stored.pinned || stored.source === 'operator');
  const machineOff = measured.measuredMachine !== null && !!stored && measured.measuredMachine !== stored.machine;
  const gpuOff = measured.measuredGpu !== null && !!stored && measured.measuredGpu !== stored.gpu;
  const mismatch = locked && (machineOff || gpuOff);
  const name = (machine: boolean, gpu: boolean, p: { machine: ResourceProfile['machine'] | null; gpu: ResourceProfile['gpu'] | null }) =>
    [machine && p.machine ? labels.machine[p.machine] : null, gpu && p.gpu ? `${c.profile_gpu_label} ${labels.gpu[p.gpu]}` : null]
      .filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-1.5 border-t border-primary/10 pt-1.5" data-testid="resp-profile-axes" data-learning={learning ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="typo-label text-foreground">{c.profile_axes_label}</span>
        <span className="typo-caption text-foreground tabular-nums" data-testid="resp-profile-axes-runs">
          {learning
            ? tx(c.profile_axes_learning, { count, total: formatNumeric(required, 'count', { language }) })
            : tx(c.profile_axes_runs, { count })}
        </span>
        {measured.dominant && (
          <span className="typo-caption text-foreground">{tx(c.profile_axes_dominant, { axis: axes[measured.dominant] })}</span>
        )}
        {mismatch && (
          <span data-testid="resp-profile-axes-mismatch">
            <StatusBadge size="sm" variant="warning">
              {tx(c.profile_axes_mismatch, {
                measured: name(machineOff, gpuOff, { machine: measured.measuredMachine, gpu: measured.measuredGpu }),
                declared: name(machineOff, gpuOff, { machine: stored?.machine ?? null, gpu: stored?.gpu ?? null }),
              })}
            </StatusBadge>
          </span>
        )}
      </div>
      <ResourceBars
        cpu={measured.cpuP95Share}
        ram={measured.ramPeakShare}
        gpu={measured.gpuP95Share}
        dominant={measured.dominant}
        className="max-w-xs"
        testId="resp-profile-axes-bars"
      />
    </div>
  );
}
