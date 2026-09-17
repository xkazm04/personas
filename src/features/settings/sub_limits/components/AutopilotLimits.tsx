// AutopilotLimits — the Limits page's Autopilot section: the pacing toggle
// and the six bounded numbers the attention loop's dispatch budget is
// computed from. The switch itself lives on the Activity board (GridHeader);
// this is where the operator decides what the switch means.
//
// Each stepper is its own `useAppSetting` with its own Set button, the shape
// the concurrency and roster rows above it already have — a value is not
// written until the operator commits it, so a half-typed "8" on the way to
// "80" never paces the fleet.

import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { setAppSetting } from '@/api/system/settings';
import { toastCatch } from '@/lib/silentCatch';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import Button from '@/features/shared/components/buttons/Button';
import {
  AUTOPILOT_BOUNDS,
  AUTOPILOT_PACING_DEFAULT,
  AUTOPILOT_PACING_KEY,
  isWithin,
  type AutopilotBound,
  type AutopilotBoundId,
} from '../autopilotBounds';

function isBool(value: string): boolean {
  return value === 'true' || value === 'false';
}

/** One bounded setting with its own Set button. Exported for the Limits
 *  page's Fleet concurrency row, which is the same shape over a different key. */
export function BoundRow({
  bound, label, ariaLabel, unit, testId,
}: {
  bound: AutopilotBound;
  label: string;
  ariaLabel: string;
  unit: string;
  testId?: string;
}) {
  const { t, tx } = useTranslation();
  const s = t.settings.limits;
  const setting = useAppSetting(bound.key, String(bound.defaultValue), (v) => isWithin(bound, v));
  const dirty = !setting.saved && setting.loaded;
  const n = Number(setting.value);
  const shown = Number.isFinite(n) ? n : bound.defaultValue;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId ?? `autopilot-bound-${bound.key}`}>
      <span className="typo-body text-foreground w-44 flex-shrink-0">{label}</span>
      <NumberStepper
        value={shown}
        onChange={(v) => setting.setValue(v == null ? String(bound.defaultValue) : String(v))}
        min={bound.min}
        max={bound.max}
        step={bound.step}
        ariaLabel={ariaLabel}
        className="w-32"
      />
      <span className="typo-caption text-foreground">{unit}</span>
      <Button
        variant="primary"
        size="sm"
        onClick={() => void setting.save()}
        disabled={!dirty || !isWithin(bound, setting.value)}
        icon={setting.saved && !dirty ? <Check size={12} /> : undefined}
      >
        {setting.saved && !dirty ? s.saved : s.set}
      </Button>
      <span className="typo-caption text-foreground">{tx(s.autopilot_range, { min: bound.min, max: bound.max })}</span>
      {setting.error && <span className="typo-caption text-red-400">{setting.error}</span>}
    </div>
  );
}

export function AutopilotLimits() {
  const { t } = useTranslation();
  const s = t.settings.limits;
  const pacing = useAppSetting(AUTOPILOT_PACING_KEY, String(AUTOPILOT_PACING_DEFAULT), isBool);
  const pacingOn = pacing.value === 'true';

  const rows: Array<{ id: AutopilotBoundId; label: string; aria: string; unit: string }> = [
    { id: 'parallel', label: s.autopilot_parallel_label, aria: s.autopilot_parallel_aria, unit: '' },
    { id: 'target', label: s.autopilot_target_label, aria: s.autopilot_target_aria, unit: s.autopilot_target_unit },
    { id: 'stop', label: s.autopilot_stop_label, aria: s.autopilot_stop_aria, unit: s.autopilot_stop_unit },
    { id: 'margin', label: s.autopilot_margin_label, aria: s.autopilot_margin_aria, unit: s.autopilot_margin_unit },
    { id: 'memoryStop', label: s.autopilot_memory_stop_label, aria: s.autopilot_memory_stop_aria, unit: s.autopilot_memory_stop_unit },
    { id: 'memoryPerAgent', label: s.autopilot_memory_per_agent_label, aria: s.autopilot_memory_per_agent_aria, unit: s.autopilot_memory_per_agent_unit },
  ];

  return (
    <div className="space-y-3">
      <p className="typo-body text-foreground">{s.autopilot_hint}</p>
      <div className="flex items-start gap-3">
        <AccessibleToggle
          checked={pacingOn}
          onChange={() => {
            // A toggle is its own commit — there is no half-typed state to
            // hold back, so it writes directly rather than through the
            // hook's render-latched `save`.
            const next = pacingOn ? 'false' : 'true';
            setAppSetting(AUTOPILOT_PACING_KEY, next)
              .then(() => pacing.setValue(next))
              .catch(toastCatch('settings/AutopilotLimits:pacing', s.autopilot_pacing_label));
          }}
          label={s.autopilot_pacing_label}
          size="sm"
          disabled={!pacing.loaded}
          data-testid="autopilot-pacing-toggle"
        />
        <div className="min-w-0">
          <div className="typo-body text-foreground">{s.autopilot_pacing_label}</div>
          <p className="typo-caption text-foreground">{s.autopilot_pacing_hint}</p>
          {pacing.error && <span className="typo-caption text-red-400">{pacing.error}</span>}
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <BoundRow key={r.id} bound={AUTOPILOT_BOUNDS[r.id]} label={r.label} ariaLabel={r.aria} unit={r.unit} />
        ))}
      </div>
      <p className="typo-caption text-foreground">{s.autopilot_note}</p>
    </div>
  );
}

export default AutopilotLimits;
