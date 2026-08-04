// The milestone header's two operator-owned surfaces:
//
//  · ShipGoalField — the `goal` column, finally editable. It existed in the
//    schema and the API since the layer shipped, but the only writer was the
//    onboarding seed, so every milestone but the seeded one showed its name in
//    place of an objective.
//
//  · ShipDualitySummary — agreement and DISAGREEMENT counts across the core
//    cut. Disagreement is the headline: it is the one number here that asks for
//    a human look. It is REPORTING ONLY. The ship button is gated by the exit
//    criteria (shipVerdict) and by nothing else; no count on this strip can
//    open or close it, and the strip says so.
import { useEffect, useState, type ReactNode } from 'react';
import { Pencil, Scale, TriangleAlert } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { INK } from '../../passport/passportInk';
import type { DualitySummary } from './shipDuality';

export function ShipGoalField({ name, goal, editable, onSave }: {
  name: string;
  goal: string | null;
  editable: boolean;
  onSave: (goal: string) => void;
}) {
  const { t, tx } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal ?? '');
  useEffect(() => { setDraft(goal ?? ''); }, [goal]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (goal ?? '')) onSave(next);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(goal ?? ''); setEditing(false); }
        }}
        placeholder={t.ship.goal_placeholder}
        aria-label={tx(t.ship.goal_edit_aria, { name })}
        className="w-full min-w-0 rounded-input border border-foreground/[0.14] bg-transparent px-2 py-1 typo-title-lg text-foreground/95 placeholder:text-foreground/30 focus-ring"
        data-testid="ship-milestone-goal"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-2 min-w-0 text-left rounded-interactive px-1 -mx-1 py-0.5 transition-colors hover:bg-foreground/[0.04] focus-ring disabled:pointer-events-none"
      aria-label={tx(t.ship.goal_edit_aria, { name })}
      data-testid="ship-milestone-goal"
    >
      <span className={`typo-title-lg truncate ${goal ? '' : 'text-foreground/45'}`}>
        {goal && goal.trim() !== '' ? goal : t.ship.goal_empty}
      </span>
      {editable && (
        <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" aria-hidden />
      )}
    </button>
  );
}

function Count({ hue, children }: { hue: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 typo-caption tabular-nums shrink-0" style={{ color: hue }}>
      {children}
    </span>
  );
}

export function ShipDualitySummary({ duality }: { duality: DualitySummary }) {
  const { t, tx } = useTranslation();
  const total = duality.rated + duality.unrated;
  if (total === 0) return null;

  return (
    <div
      className="flex items-center gap-3 flex-wrap mt-2 rounded-card border border-foreground/[0.07] px-2.5 py-1.5"
      style={{ background: 'rgba(148,163,184,.03)' }}
      data-testid="ship-duality-summary"
    >
      <Tooltip content={t.ship.duality_advisory} placement="top">
        <span className="inline-flex items-center gap-1.5 typo-caption shrink-0 cursor-help decoration-dotted underline underline-offset-4 decoration-foreground/25">
          <Scale className="w-3.5 h-3.5" aria-hidden />
          {t.ship.duality_title}
        </span>
      </Tooltip>
      {duality.disagree > 0 ? (
        <Tooltip content={tx(t.ship.duality_conflict_names, { names: duality.conflicts.map((c) => c.name).join(', ') })} placement="top">
          <span className="inline-flex items-center gap-1 typo-caption tabular-nums shrink-0 cursor-help" style={{ color: INK.violet }}>
            <TriangleAlert className="w-3 h-3" aria-hidden />
            {tx(t.ship.duality_disagree, { count: duality.disagree })}
          </span>
        </Tooltip>
      ) : (
        <Count hue={INK.emerald}>{t.ship.duality_no_disagreement}</Count>
      )}
      <Count hue={INK.emerald}>{tx(t.ship.duality_agree, { count: duality.agree })}</Count>
      {duality.unrated > 0 && (
        <Count hue="var(--muted-foreground)">{tx(t.ship.duality_unrated, { count: duality.unrated })}</Count>
      )}
    </div>
  );
}
