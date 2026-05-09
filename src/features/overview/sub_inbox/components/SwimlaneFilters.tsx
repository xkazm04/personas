/**
 * SwimlaneFilters — segmented control for the four temporal lanes.
 * Each chip shows its label + count badge; the active chip gets the primary
 * tint, inactive ones a muted secondary surface.
 */
import { useTranslation } from '@/i18n/useTranslation';
import type { SwimlaneId, SwimlaneBuckets } from '../libs/swimlane';

interface Props {
  active: SwimlaneId;
  buckets: SwimlaneBuckets;
  onChange: (next: SwimlaneId) => void;
}

const LANES: SwimlaneId[] = ['today', 'week', 'snoozed', 'resolved'];

export function SwimlaneFilters({ active, buckets, onChange }: Props) {
  const { t } = useTranslation();
  const r = t.overview.inbox_triage;
  const labels: Record<SwimlaneId, string> = {
    today: r.lane_today,
    week: r.lane_week,
    snoozed: r.lane_snoozed,
    resolved: r.lane_resolved,
  };

  return (
    <div role="tablist" aria-label={r.swimlanes_aria} className="flex items-center gap-1.5 flex-wrap">
      {LANES.map((id) => {
        const isActive = id === active;
        const count = buckets[id].length;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-card typo-label transition-colors border ${
              isActive
                ? 'bg-primary/15 border-primary/30 text-foreground'
                : 'border-primary/10 text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
            }`}
          >
            <span>{labels[id]}</span>
            <span
              className={`typo-code text-[10px] px-1.5 py-0.5 rounded-md ${
                isActive ? 'bg-primary/25 text-foreground' : 'bg-secondary/40 text-foreground/70'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
