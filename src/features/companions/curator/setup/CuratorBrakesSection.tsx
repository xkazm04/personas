/**
 * The brakes - and they are the reason this page exists.
 *
 * Her standing instruction is that she NEVER IDLES: on an empty queue she
 * re-runs the projection and keeps going. So the daily budget, the daily run
 * cap and the daily commit cap are not configuration. They are the only three
 * things that ever stop her, and until this section shipped not one of them
 * could be read or set from the app at all.
 *
 * Each is nullable, and clearing the field writes a BLANK - which the Rust
 * validator accepts and reads back as "no ceiling declared". That is a
 * different statement from zero, and the meter under each control says which
 * one is true.
 */
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { useTranslation } from '@/i18n/useTranslation';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';
import { formatCount, formatNumeric } from '@/lib/utils/formatters';

import { PolicyRow } from './PolicyRow';
import { TodayMeter } from './TodayMeter';
import {
  CURATOR_DAILY_BUDGET_USD,
  CURATOR_DAILY_COMMIT_CAP,
  CURATOR_DAILY_RUN_CAP,
} from './curatorPolicyKeys';

/** A committed cap, as the settings door takes it. `null` writes a blank. */
function capValue(next: number | null): string {
  return next === null ? '' : String(next);
}

export function CuratorBrakesSection({ policy, runtime, write }: {
  policy: CuratorPolicy | null;
  runtime: CuratorRuntime | null;
  write: (key: string, value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const s = t.companions.setup;

  return (
    <section className="space-y-2" data-testid="curator-brakes">
      <h3 className="typo-title">{s.curator_brakes_title}</h3>
      <p className="typo-caption text-foreground opacity-70">{s.curator_brakes_desc}</p>

      <PolicyRow
        label={s.curator_budget_label}
        description={s.curator_budget_desc}
        htmlFor="curator-budget"
        control={
          <NumberStepper
            id="curator-budget"
            value={policy?.dailyBudgetUsd ?? null}
            allowEmpty
            min={0}
            step={0.5}
            prefix="$"
            placeholder={s.curator_no_cap}
            ariaLabel={s.curator_budget_label}
            disabled={!policy}
            onChange={() => {
              /* draft only - the write happens on commit, not per keystroke */
            }}
            onCommit={(next) => void write(CURATOR_DAILY_BUDGET_USD, capValue(next))}
          />
        }
        foot={
          <TodayMeter
            used={runtime ? formatNumeric(runtime.spentTodayUsd, 'usd') : null}
            cap={
              policy?.dailyBudgetUsd == null ? null : formatNumeric(policy.dailyBudgetUsd, 'usd')
            }
          />
        }
      />

      <PolicyRow
        label={s.curator_run_cap_label}
        description={s.curator_run_cap_desc}
        htmlFor="curator-run-cap"
        control={
          <NumberStepper
            id="curator-run-cap"
            value={policy?.dailyRunCap ?? null}
            allowEmpty
            min={0}
            placeholder={s.curator_no_cap}
            ariaLabel={s.curator_run_cap_label}
            disabled={!policy}
            onChange={() => {
              /* draft only */
            }}
            onCommit={(next) => void write(CURATOR_DAILY_RUN_CAP, capValue(next))}
          />
        }
        foot={
          <TodayMeter
            used={runtime ? formatCount(runtime.runsToday, { precision: 0 }) : null}
            cap={policy?.dailyRunCap == null ? null : formatCount(policy.dailyRunCap, { precision: 0 })}
          />
        }
      />

      <PolicyRow
        label={s.curator_commit_cap_label}
        description={s.curator_commit_cap_desc}
        htmlFor="curator-commit-cap"
        control={
          <NumberStepper
            id="curator-commit-cap"
            value={policy?.dailyCommitCap ?? null}
            allowEmpty
            min={0}
            placeholder={s.curator_no_cap}
            ariaLabel={s.curator_commit_cap_label}
            disabled={!policy}
            onChange={() => {
              /* draft only */
            }}
            onCommit={(next) => void write(CURATOR_DAILY_COMMIT_CAP, capValue(next))}
          />
        }
        foot={
          <TodayMeter
            used={runtime ? formatCount(runtime.commitsToday, { precision: 0 }) : null}
            cap={
              policy?.dailyCommitCap == null
                ? null
                : formatCount(policy.dailyCommitCap, { precision: 0 })
            }
          />
        }
      />
    </section>
  );
}
