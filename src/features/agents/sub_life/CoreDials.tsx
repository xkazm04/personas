import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaCore } from '@/lib/bindings/PersonaCore';
import { Slider } from '@/features/shared/components/forms/Slider';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { CONFLICT_STYLES } from './coreProfile';

interface CoreDialsProps {
  core: PersonaCore;
  onChange: (patch: Partial<PersonaCore>) => void;
}

interface DialProps {
  label: string;
  poleLow: string;
  poleHigh: string;
  value: number;
  onChange: (v: number) => void;
  testId: string;
}

function Dial({ label, poleLow, poleHigh, value, onChange, testId }: DialProps) {
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="typo-title">{label}</span>
        <Numeric value={value} precision={2} className="typo-data" />
      </div>
      <Slider
        value={value}
        min={0}
        max={1}
        step={0.05}
        ariaLabel={label}
        formatValue={(v) => v.toFixed(2)}
        // onChange keeps the controlled thumb tracking the drag; the draft is
        // local state, so per-tick updates are cheap. No IPC fires until the
        // explicit Save button, which is what onCommit exists to protect.
        onChange={onChange}
        onCommit={onChange}
      />
      <div className="flex justify-between mt-0.5">
        {/* muted-ok: slider pole micro-labels (structural chrome under the track), not body copy */}
        <span className="typo-label text-muted-foreground">{poleLow}</span>
        {/* muted-ok: slider pole micro-labels (structural chrome under the track), not body copy */}
        <span className="typo-label text-muted-foreground">{poleHigh}</span>
      </div>
    </div>
  );
}

/** The three 0..1 character dials plus the conflict-style vocabulary select. */
export function CoreDials({ core, onChange }: CoreDialsProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const styleLabels: Record<string, string> = {
    challenger: life.conflict_challenger,
    harmonizer: life.conflict_harmonizer,
    analyst: life.conflict_analyst,
    pragmatist: life.conflict_pragmatist,
  };
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Dial
        label={life.core_dial_risk}
        poleLow={life.core_dial_risk_low}
        poleHigh={life.core_dial_risk_high}
        value={core.riskTolerance}
        onChange={(v) => onChange({ riskTolerance: v })}
        testId="life-core-dial-risk"
      />
      <Dial
        label={life.core_dial_speed}
        poleLow={life.core_dial_speed_low}
        poleHigh={life.core_dial_speed_high}
        value={core.speedVsQuality}
        onChange={(v) => onChange({ speedVsQuality: v })}
        testId="life-core-dial-speed"
      />
      <Dial
        label={life.core_dial_deference}
        poleLow={life.core_dial_deference_low}
        poleHigh={life.core_dial_deference_high}
        value={core.deference}
        onChange={(v) => onChange({ deference: v })}
        testId="life-core-dial-deference"
      />
      <div data-testid="life-core-conflict-style">
        <p className="typo-title mb-1">{life.core_conflict_style}</p>
        <ThemedSelect
          filterable
          hideSearch
          options={CONFLICT_STYLES.map((s) => ({ value: s, label: styleLabels[s] ?? s }))}
          value={core.conflictStyle}
          onValueChange={(v) => onChange({ conflictStyle: v })}
          aria-label={life.core_conflict_style}
        />
      </div>
    </div>
  );
}
