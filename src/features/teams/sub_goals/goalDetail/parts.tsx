// Small shared pieces the blocks compose from.
//
// Moved out of `GoalDetailDrawer` 2026-10-05.
//
// 2026-10-06: `Section` lost its `tone`. The prop let a layout pick a DIFFERENT
// LABEL FONT for a leading section than for a railed one, which is how one modal
// ended up with five section-heading treatments. Emphasis belongs to the
// column - its width, its position, the rail's rule - not to two fonts for the
// same kind of thing. Every head is `MODAL_SECTION_HEAD` (`typo-eyebrow`), the
// repo's canonical tracked-uppercase section head.
import type { ReactNode } from 'react';
import { ArrowRight, Target, Trash2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { MODAL_SECTION_HEAD } from '@/features/shared/components/modals';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';

import { GoalStatusBadge } from '../GoalStatusBadge';

/** Neutral chip for team-side statuses (queued/running/awaiting_review/…). */
export const TEAM_CHIP = 'text-foreground border-primary/15 bg-primary/5';

export function Section({ icon: Icon, label, children, flush = false }: {
  icon: typeof Target;
  label: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={flush ? '' : 'pt-3 mt-3 border-t border-primary/10'}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <h3 className={MODAL_SECTION_HEAD}>{label}</h3>
      </div>
      {children}
    </div>
  );
}

/** One dependency kind (Depends on / Follows): linked-goal rows + an add picker. */
export function DepGroup({
  label, rows, goalById, candidates, addPlaceholder, emptyLabel, onAdd, onRemove,
}: {
  label: string;
  rows: DevGoalDependency[];
  goalById: Map<string, DevGoal>;
  candidates: DevGoal[];
  addPlaceholder: string;
  emptyLabel: string;
  onAdd: (dependsOnId: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      {/* Was `tracking-[0.16em]` - 0.02em away from its own neighbour, for no
          reason anyone could have stated. One token now. */}
      <p className={`${MODAL_SECTION_HEAD} mb-1`}>{label}</p>
      {rows.length > 0 ? (
        <ul className="space-y-1 mb-1.5">
          {rows.map((d) => {
            const linked = goalById.get(d.depends_on_id);
            return (
              <li key={d.id} className="group flex items-center gap-2 typo-body">
                <ArrowRight className="w-3.5 h-3.5 text-foreground shrink-0" />
                <span className="flex-1 text-foreground truncate">{linked?.title ?? d.depends_on_id}</span>
                {linked && <GoalStatusBadge status={linked.status} />}
                {/* The kit control, not a hand-rolled one. It was hand-rolled
                    in the drawer, and splitting the drawer across files would
                    otherwise have entered a second file into the census's
                    raw-control rule for the very same markup. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${t.common.delete}: ${linked?.title ?? d.depends_on_id}`}
                  onClick={() => onRemove(d.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-status-error"
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="typo-caption text-foreground italic mb-1.5">{emptyLabel}</p>
      )}
      {candidates.length > 0 && (
        <ThemedSelect value="" onValueChange={(v) => { if (v) onAdd(v); }}>
          <option value="">{addPlaceholder}</option>
          {candidates.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </ThemedSelect>
      )}
    </div>
  );
}
