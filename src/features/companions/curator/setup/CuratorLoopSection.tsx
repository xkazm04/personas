/**
 * How the loop itself is shaped: how many terminals she may hold, how many
 * unanswered decisions stop her queueing more, and when she stays quiet.
 *
 * The worker cap is NOT a cap on processes. A dispatcher skill spawns its own
 * pool - `librarian` and `forge` cap at 10, `harvest` at 5, `hygiene` at 6 -
 * so two workers can be many more processes, and the description says so
 * rather than letting the number imply a guarantee it does not make.
 */
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { useTranslation } from '@/i18n/useTranslation';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';
import { formatCount } from '@/lib/utils/formatters';

import { PolicyRow } from './PolicyRow';
import { TodayMeter } from './TodayMeter';
import {
  BACKPRESSURE_MAX,
  CURATOR_BACKPRESSURE_N,
  CURATOR_QUIET_HOURS,
  CURATOR_WORKER_CAP,
  WORKER_CAP_MAX,
} from './curatorPolicyKeys';

export function CuratorLoopSection({ policy, runtime, write }: {
  policy: CuratorPolicy | null;
  runtime: CuratorRuntime | null;
  write: (key: string, value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const s = t.companions.setup;

  return (
    <section className="space-y-2" data-testid="curator-loop">
      <h3 className="typo-title">{s.curator_loop_title}</h3>
      <p className="typo-caption text-foreground opacity-70">{s.curator_loop_desc}</p>

      <PolicyRow
        label={s.curator_worker_cap_label}
        description={s.curator_worker_cap_desc}
        htmlFor="curator-worker-cap"
        control={
          <NumberStepper
            id="curator-worker-cap"
            value={policy?.workerCap ?? null}
            min={1}
            max={WORKER_CAP_MAX}
            ariaLabel={s.curator_worker_cap_label}
            disabled={!policy}
            onChange={() => {
              /* draft only */
            }}
            onCommit={(next) => void write(CURATOR_WORKER_CAP, next === null ? '' : String(next))}
          />
        }
        foot={
          <TodayMeter
            used={runtime ? formatCount(runtime.running, { precision: 0 }) : null}
            cap={policy ? formatCount(policy.workerCap, { precision: 0 }) : null}
          />
        }
      />

      <PolicyRow
        label={s.curator_backpressure_label}
        description={s.curator_backpressure_desc}
        htmlFor="curator-backpressure"
        control={
          <NumberStepper
            id="curator-backpressure"
            value={policy?.backpressureN ?? null}
            min={1}
            max={BACKPRESSURE_MAX}
            ariaLabel={s.curator_backpressure_label}
            disabled={!policy}
            onChange={() => {
              /* draft only */
            }}
            onCommit={(next) => void write(CURATOR_BACKPRESSURE_N, next === null ? '' : String(next))}
          />
        }
      />

      <PolicyRow
        label={s.curator_quiet_hours_label}
        description={s.curator_quiet_hours_desc}
        htmlFor="curator-quiet-hours"
        control={
          <input
            id="curator-quiet-hours"
            type="text"
            className="typo-body w-44 h-8 px-2 rounded-input border border-border bg-secondary/30 text-foreground placeholder:text-foreground placeholder:opacity-40 focus-ring"
            defaultValue={policy?.quietHours ?? ''}
            key={policy?.quietHours ?? 'unread'}
            placeholder={s.curator_quiet_hours_placeholder}
            disabled={!policy}
            aria-label={s.curator_quiet_hours_label}
            data-testid="curator-quiet-hours"
            onBlur={(e) => void write(CURATOR_QUIET_HOURS, e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        }
      />
    </section>
  );
}
