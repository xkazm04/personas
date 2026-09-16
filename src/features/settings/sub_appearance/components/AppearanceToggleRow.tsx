import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';

interface Props {
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
}

/** Bordered label + hint + switch — the a11y-axis row pattern. Uses the same
 *  switch as every other settings row (SettingRow / AccessibleToggle). */
export function AppearanceToggleRow({ label, hint, active, onToggle }: Props) {
  return (
    <div className="flex items-center justify-between gap-4 pt-3 mt-1 border-t border-primary/10">
      <div className="flex-1 min-w-0">
        <div className="typo-title">{label}</div>
        <div className="typo-body typo-weight-light text-foreground/90">{hint}</div>
      </div>
      <AccessibleToggle checked={active} onChange={onToggle} label={label} className="shrink-0" />
    </div>
  );
}
