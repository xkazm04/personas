import { ChevronRight, Eye, PackageCheck, Scale, Zap } from 'lucide-react';
import type { ComponentType } from 'react';
import { ACTIVITY_KINDS, type ActivityKind, type RecipeActivity } from '@/lib/personas/recipeV3';

export interface ActivitySequenceProps {
  /**
   * The coarse sequence, 3 to 8 items. Rendered in the order given, exactly as
   * given: this component never sorts, filters, groups or truncates.
   */
  activities: RecipeActivity[];
  /**
   * Translated names for the four kinds, rendered `sr-only` inside each chip.
   * The glyph and the tint are decorative, so without this a screen reader hears
   * only the label and loses the kind entirely. Optional because this is a
   * catalog primitive and must not reach into any feature's translation section:
   * the caller owns the strings. Omit it and the kind is simply not announced.
   */
  kindLabels?: Record<ActivityKind, string>;
  /** `sm` for a dense card, `md` for a section of its own. Defaults to `sm`. */
  size?: 'sm' | 'md';
  className?: string;
}

/** Kind to tint. Four distinct hues, ordered passive to done, none of them error red. */
const KIND_TINT: Record<ActivityKind, string> = {
  observe: 'text-status-neutral bg-status-neutral/10 border-status-neutral/30',
  decide: 'text-status-info bg-status-info/10 border-status-info/30',
  act: 'text-status-warning bg-status-warning/10 border-status-warning/30',
  deliver: 'text-status-success bg-status-success/10 border-status-success/30',
};

/** Kind to glyph. Decorative: the kind is also announced in the chip's title text. */
const KIND_ICON: Record<ActivityKind, ComponentType<{ className?: string }>> = {
  observe: Eye,
  decide: Scale,
  act: Zap,
  deliver: PackageCheck,
};

/**
 * `RecipeActivity.kind` is typed as plain `string` on the binding (ts-rs cannot
 * carry Rust's closed enum across the wire as a TS union), but every activity
 * this component ever sees came through `readV3Fields`, which already validated
 * `kind` against `ACTIVITY_KINDS`. This narrows it back for the tint/icon maps
 * below without asserting past unvalidated data.
 */
const isActivityKind = (kind: string): kind is ActivityKind =>
  ACTIVITY_KINDS.includes(kind as ActivityKind);

/**
 * @catalog Linear, branch-free chip sequence for a recipe's 3-8 activities, each tinted and glyphed by its kind (observe / decide / act / deliver).
 *
 * Purely presentational: it takes a list and draws it. There are deliberately no
 * branches, no edges, no decision nodes and no conditions, because the Recipe v3
 * contract forbids them - a sequence that needs a branch is a runbook, and a
 * runbook is not a recipe. The predecessor field this replaced (`useCaseFlow`)
 * was a node and edge graph, and the drift back toward one starts with a
 * component that can draw an edge.
 *
 * Renders `null` for an empty list rather than an empty rail: a charter minted
 * before v3 has no activities at all, and a fabricated empty diagram claims a
 * shape the charter does not have. Callers pass `spec.activities` straight from
 * `readV3Fields`, which already returns `undefined` when there is nothing real.
 *
 * The chips wrap. Long sequences flow onto a second row rather than scrolling or
 * eliding, so no step is ever hidden from a reader who is trying to see the shape.
 */
export function ActivitySequence({
  activities,
  kindLabels,
  size = 'sm',
  className = '',
}: ActivitySequenceProps) {
  if (!activities.length) return null;

  const chip = size === 'sm' ? 'px-2 py-1 gap-1.5' : 'px-2.5 py-1.5 gap-2';
  const icon = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const label = size === 'sm' ? 'typo-caption' : 'typo-label';

  return (
    <ol
      className={`flex flex-wrap items-center gap-1.5 list-none m-0 p-0 ${className}`.trim()}
      data-testid="activity-seq"
    >
      {activities.map((activity, i) => {
        const kind = isActivityKind(activity.kind) ? activity.kind : undefined;
        const Icon = kind ? KIND_ICON[kind] : Eye;
        return (
          <li key={activity.id} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && (
              <ChevronRight
                aria-hidden
                className="w-3 h-3 text-status-neutral shrink-0"
              />
            )}
            <span
              className={`inline-flex items-center rounded-interactive border ${chip} ${kind ? KIND_TINT[kind] : KIND_TINT.observe}`}
              data-testid={`activity-seq-${activity.id}`}
              data-kind={activity.kind}
            >
              <Icon aria-hidden className={`${icon} shrink-0`} />
              {kindLabels && kind && <span className="sr-only">{`${kindLabels[kind]}: `}</span>}
              <span className={`${label} text-foreground truncate max-w-[24ch]`}>{activity.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default ActivitySequence;
