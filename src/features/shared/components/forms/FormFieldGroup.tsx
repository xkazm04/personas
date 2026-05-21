import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Badge } from '@/features/shared/components/display/Badge';

/* FormFieldGroup — collapsible section header for long forms.
 *
 * Tames the cognitive cliff in CredentialDesignModal, PersonaEditor settings,
 * RecipePlayground, and the OnboardingWizard. Wraps a slice of related fields
 * in a quiet card with a chevron header, optional completion meter, and a
 * subtle pulse when the meter ticks up.
 *
 * Composition: pass FormFields as children. For progressive disclosure of
 * dependent fields, mount/unmount the dependent FormField conditionally —
 * the parent's `dependsOn` is evaluated by the consuming component, not this
 * primitive (kept simple; the Collapse animation handles the transition).
 */

export interface FormFieldGroupProps {
  /** Visible group label (typo-caption tier in the rendered header). */
  label: string;
  /** Subtle hint shown beneath the label when collapsed (e.g. "Advanced"). */
  hint?: string;
  /** Whether the section is expanded on first mount. */
  defaultOpen?: boolean;
  /** Controlled open state — pair with `onOpenChange` for external control. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** When set, renders a `count/total` completion badge in the header. */
  completionCount?: number;
  completionTotal?: number;
  /** Group children — FormField (or any) elements that compose the section. */
  children: ReactNode;
  className?: string;
  /** Optional render-prop for an icon on the left of the header. */
  icon?: ReactNode;
}

export function FormFieldGroup({
  label,
  hint,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  completionCount,
  completionTotal,
  children,
  className = '',
  icon,
}: FormFieldGroupProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // Pulse the completion badge when it ticks up. Captures the previous value
  // and triggers a one-shot animation class via key remount.
  const prevCountRef = useRef(completionCount);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (
      typeof completionCount === 'number' &&
      typeof prevCountRef.current === 'number' &&
      completionCount > prevCountRef.current
    ) {
      setPulseKey((k) => k + 1);
    }
    prevCountRef.current = completionCount;
  }, [completionCount]);

  const showBadge =
    typeof completionCount === 'number' && typeof completionTotal === 'number' && completionTotal > 0;
  const isComplete = showBadge && completionCount! >= completionTotal!;
  const badgeVariant = isComplete ? 'emerald' : 'neutral';

  // Default child count derivation — useful as a fallback when consumer
  // doesn't explicitly track completion. Each direct child counts as a slot;
  // the consumer can override by passing completionCount/Total explicitly.
  const childCount = Children.toArray(children).filter(isValidElement).length;
  const totalForDisplay = completionTotal ?? childCount;
  const countForDisplay = completionCount ?? childCount;

  return (
    <section
      className={`bg-secondary/[0.04] rounded-card border border-card-border ${className}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left focus-ring rounded-card transition-colors hover:bg-secondary/[0.06]"
      >
        {icon && <span className="flex-shrink-0 text-foreground">{icon}</span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-caption uppercase tracking-wider text-foreground font-semibold">
              {label}
            </span>
            {showBadge && (
              <Badge
                key={pulseKey}
                variant={badgeVariant}
                size="xs"
                shape="pill"
                className={pulseKey > 0 ? 'animate-success-pop' : undefined}
              >
                {countForDisplay}/{totalForDisplay}
              </Badge>
            )}
          </div>
          {hint && !open && (
            <p className="typo-caption text-foreground mt-0.5 truncate">{hint}</p>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-foreground flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <Collapse open={open} duration={220}>
        <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>
      </Collapse>
    </section>
  );
}
