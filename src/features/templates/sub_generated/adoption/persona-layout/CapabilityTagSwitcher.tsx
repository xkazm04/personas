/**
 * Adoption capability switcher — a row of name tags (no sigil images), each
 * showing an "answered / total" count coloured by state, with that
 * capability's own question-progress stepper underneath. Replaces the
 * sigil-tab strip + the single consolidated stepper that used to sit above
 * the glyph: per-capability state now lives in each tag.
 *
 * Adoption-specific (View mode keeps the sigil-based CapabilityTabBar).
 */

export type CapabilitySegmentState = 'answered' | 'blocked' | 'pending';

export interface CapabilityTagItem {
  id: string;
  title: string;
  answered: number;
  total: number;
  blocked: number;
  /** One entry per question, in order — drives the stepper bars. */
  segments: CapabilitySegmentState[];
}

interface CapabilityTagSwitcherProps {
  items: CapabilityTagItem[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
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

export function CapabilityTagSwitcher({ items, activeId, onActiveChange }: CapabilityTagSwitcherProps) {
  if (items.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Capabilities"
      className="flex items-stretch gap-2 overflow-x-auto scrollbar-thin py-1"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onActiveChange(item.id)}
            title={item.title}
            className={`group shrink-0 flex flex-col gap-1.5 px-3 py-2 rounded-card border transition-all cursor-pointer min-w-[8rem] max-w-[16rem] ${
              isActive
                ? 'border-primary/45 bg-primary/10 shadow-elevation-1'
                : 'border-card-border/40 bg-secondary/15 hover:bg-secondary/30 hover:border-card-border/70'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                className={`flex-1 min-w-0 truncate typo-caption text-left ${
                  isActive ? 'text-foreground font-medium' : 'text-foreground'
                }`}
              >
                {item.title}
              </span>
              <span className={`typo-caption font-mono tabular-nums shrink-0 ${countColor(item)}`}>
                {item.answered}/{item.total}
              </span>
            </span>
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
          </button>
        );
      })}
    </div>
  );
}
