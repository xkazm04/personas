import { Button } from '@/features/shared/components/buttons';

interface Props {
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
  onText: string;
  offText: string;
}

/** Bordered label + hint + on/off toggle button — the a11y-axis row pattern. */
export function AppearanceToggleRow({ label, hint, active, onToggle, onText, offText }: Props) {
  return (
    <div className="flex items-start justify-between gap-4 pt-3 mt-1 border-t border-primary/10">
      <div className="flex-1">
        <div className="typo-body text-foreground font-medium">{label}</div>
        <div className="typo-body text-foreground">{hint}</div>
      </div>
      <Button
        variant="ghost"
        onClick={onToggle}
        aria-pressed={active}
        className={`shrink-0 px-4 py-2 rounded-interactive border min-w-[64px] ${
          active
            ? 'border-primary/40 bg-primary/10 text-primary font-medium'
            : 'border-primary/10 hover:border-primary/30 text-foreground'
        }`}
      >
        {active ? onText : offText}
      </Button>
    </div>
  );
}
