import { useEffect, useState } from 'react';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';

interface FleetMinutesFieldProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** Receives the settled value (blur, Enter, released stepper), never a keystroke. */
  onCommit: (minutes: number) => void;
  /** Kept on the field's wrapper: tours and tests anchor on it. */
  testId: string;
}

/**
 * A labelled minutes field for the Fleet policy cards: the shared NumberStepper
 * between its label and unit. It edits a local draft and hands the store only a
 * settled value, because every store write here is also an IPC push to the Rust
 * ticker; the bare number input it replaces pushed once per keystroke.
 */
export function FleetMinutesField({ label, unit, value, min, max, disabled, onCommit, testId }: FleetMinutesFieldProps) {
  const [draft, setDraft] = useState<number>(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <span className="typo-body text-foreground">{label}</span>
      <NumberStepper
        value={draft}
        onChange={(v) => setDraft(v ?? min)}
        onCommit={(v) => onCommit(v ?? min)}
        min={min}
        max={max}
        disabled={disabled}
        ariaLabel={label}
        className="w-28"
      />
      <span className="typo-body text-foreground">{unit}</span>
    </div>
  );
}
