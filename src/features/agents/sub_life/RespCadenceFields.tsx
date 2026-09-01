import { useTranslation } from '@/i18n/useTranslation';
import type { ResponsibilityCadence } from '@/lib/bindings/ResponsibilityCadence';
import type { ResponsibilityTenure } from '@/lib/bindings/ResponsibilityTenure';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

interface RespCadenceFieldsProps {
  cadence: ResponsibilityCadence;
  budgetMonthlyUsd: number | undefined;
  tenure?: ResponsibilityTenure;
  onCadence: (c: ResponsibilityCadence) => void;
  onBudget: (v: number | undefined) => void;
}

/** Cadence (attention loop switch + tempo), budget, and read-mostly tenure. */
export function RespCadenceFields({
  cadence,
  budgetMonthlyUsd,
  tenure,
  onCadence,
  onBudget,
}: RespCadenceFieldsProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  // The interval fields are plain JSON numbers end to end — the Rust i64s
  // carry `#[ts(type = "number")]` pins (persisted-model-struct), so no
  // bigint coercion exists between the wire and this form.
  const asNumber = (v: number | undefined): number | null => (v == null ? null : v);

  return (
    <div className="space-y-3" data-testid="life-resp-cadence">
      <div className="flex items-center justify-between">
        <span className="typo-title">{life.resp_cadence_enabled}</span>
        <AccessibleToggle
          checked={cadence.attentionEnabled}
          onChange={() => onCadence({ ...cadence, attentionEnabled: !cadence.attentionEnabled })}
          label={life.resp_cadence_enabled}
          data-testid="life-resp-cadence-toggle"
        />
      </div>
      {cadence.attentionEnabled && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="typo-label text-foreground/85 mb-1">{life.resp_cadence_interval}</p>
            <NumberStepper
              value={asNumber(cadence.intervalMinutes)}
              onChange={(v) =>
                onCadence({ ...cadence, intervalMinutes: v == null ? undefined : Math.max(1, Math.round(v)) })
              }
              min={1}
              allowEmpty
            />
          </div>
          <div>
            <p className="typo-label text-foreground/85 mb-1">{life.resp_cadence_max_runs}</p>
            <NumberStepper
              value={asNumber(cadence.maxRunsPerDay)}
              onChange={(v) =>
                onCadence({ ...cadence, maxRunsPerDay: v == null ? undefined : Math.max(1, Math.round(v)) })
              }
              min={1}
              allowEmpty
            />
          </div>
          <div>
            <p className="typo-label text-foreground/85 mb-1">{life.resp_cadence_quiet}</p>
            <input
              value={cadence.quietHours ?? ''}
              onChange={(e) => onCadence({ ...cadence, quietHours: e.target.value || undefined })}
              className={INPUT_FIELD}
              data-testid="life-resp-cadence-quiet"
            />
          </div>
        </div>
      )}

      <div className="max-w-[14rem]">
        <p className="typo-label text-foreground/85 mb-1">{life.resp_budget_label}</p>
        <NumberStepper
          value={budgetMonthlyUsd ?? null}
          onChange={(v) => onBudget(v ?? undefined)}
          min={0}
          step={1}
          allowEmpty
          prefix="$"
        />
      </div>

      {tenure && (tenure.hiredAt || tenure.probationEndsAt) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 typo-caption" data-testid="life-resp-tenure">
          {tenure.hiredAt && (
            <span>
              {life.resp_tenure_hired}: <AbsoluteTime timestamp={tenure.hiredAt} />
            </span>
          )}
          {tenure.probationEndsAt && (
            <span>
              {life.resp_tenure_probation}: <AbsoluteTime timestamp={tenure.probationEndsAt} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
