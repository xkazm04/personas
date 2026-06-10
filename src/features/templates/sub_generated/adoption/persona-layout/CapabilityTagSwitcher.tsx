/**
 * Adoption capability switcher — a row of name tags (no sigil images), each
 * showing an "answered / total" count coloured by state, with that
 * capability's own question-progress stepper underneath and an inline
 * include/skip power toggle. This is the SINGLE capability control in
 * adoption: it replaces both the old sigil-tab strip and the separate bottom
 * UseCaseRow list — selecting a tag drives the active capability, the power
 * toggle includes/skips it, and the active tag's description renders below
 * the strip (see PersonaLayoutAdoption).
 *
 * Adoption-specific (View mode keeps the sigil-based CapabilityTabBar).
 */
import { Power } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export type CapabilitySegmentState = 'answered' | 'blocked' | 'pending';

export interface CapabilityTagItem {
  id: string;
  title: string;
  answered: number;
  total: number;
  blocked: number;
  /** Whether the capability is included in the persona being adopted. */
  enabled: boolean;
  /** One entry per question, in order — drives the stepper bars. */
  segments: CapabilitySegmentState[];
}

interface CapabilityTagSwitcherProps {
  items: CapabilityTagItem[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
  /** Toggle a capability's include/skip state (the power button). */
  onToggleEnabled: (id: string) => void;
}

function countColor(item: CapabilityTagItem): string {
  if (item.total === 0) return 'text-foreground/40';
  if (item.blocked > 0) return 'text-status-error';
  if (item.answered >= item.total) return 'text-status-success';
  return 'text-status-warning';
}

function segmentClass(state: CapabilitySegmentState): string {
  switch (state) {
    case 'answered':
      return 'bg-status-success/70';
    case 'blocked':
      return 'bg-status-error/60';
    default:
      return 'bg-foreground/[0.15]';
  }
}

export function CapabilityTagSwitcher({
  items,
  activeId,
  onActiveChange,
  onToggleEnabled,
}: CapabilityTagSwitcherProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={t.templates.adopt_modal.capabilities_aria}
      className="flex items-stretch gap-2 overflow-x-auto scrollbar-thin py-1"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const off = !item.enabled;
        return (
          <div
            key={item.id}
            className={`group shrink-0 flex flex-col gap-1.5 px-3 py-2 rounded-card border transition-all min-w-[8.5rem] max-w-[16rem] ${
              isActive
                ? 'border-primary/45 bg-primary/10 shadow-elevation-1'
                : 'border-card-border/40 bg-secondary/15 hover:border-card-border/70'
            } ${off ? 'opacity-55' : ''}`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onActiveChange(item.id)}
                title={item.title}
                className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
              >
                <span
                  className={`flex-1 min-w-0 truncate typo-caption ${
                    isActive ? 'text-foreground font-medium' : 'text-foreground'
                  } ${off ? 'line-through decoration-foreground/40' : ''}`}
                >
                  {item.title}
                </span>
                <span className={`typo-caption font-mono tabular-nums shrink-0 ${countColor(item)}`}>
                  {item.answered}/{item.total}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEnabled(item.id);
                }}
                aria-pressed={item.enabled}
                title={off ? t.templates.adopt_modal.capability_include : t.templates.adopt_modal.capability_skip}
                aria-label={off ? t.templates.adopt_modal.capability_include : t.templates.adopt_modal.capability_skip}
                className={`shrink-0 p-1 rounded-full border transition-colors cursor-pointer ${
                  item.enabled
                    ? 'border-status-success/40 text-status-success hover:bg-status-success/10'
                    : 'border-card-border/50 text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5'
                }`}
              >
                <Power className="w-3 h-3" />
              </button>
            </div>
            {/* Per-capability question stepper — reflects this capability's
                individual progress (answered / blocked / pending). */}
            <span className="flex items-center gap-0.5">
              {item.segments.length === 0 ? (
                <span className="h-1 flex-1 rounded-full bg-foreground/[0.08]" />
              ) : (
                item.segments.map((seg, i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${segmentClass(seg)}`}
                  />
                ))
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
