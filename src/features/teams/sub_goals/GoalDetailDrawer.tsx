/**
 * GoalDetailDrawer - the focused detail surface for a single goal.
 *
 * Composes the goal's hybrid progress nudge (resolve_goal_progress ->
 * accept/edit; never silent), the unified checklist (ad-hoc items, sub-goals and
 * linked team-assignment steps, with inline intervention on awaiting_review),
 * the verification gate, and the live activity feed (dev_goal_signals, incl. the
 * team_* signals the orchestrator writes).
 *
 * 2026-10-05 - SHELL ONLY. The data moved to `goalDetail/useGoalDetail` behind a
 * context and the sections became blocks, so a layout is a small file that
 * arranges blocks.
 *
 * 2026-10-06 - LEDGER WON, AND THE STYLING IS THE QUESTION NOW.
 *
 * The layout contest is settled: Ledger is the layout (owner's call), and
 * Column, Dossier and Brief are gone. The remaining complaint was that the modal
 * "is very inconsistent from Personas app" - which measurement bore out. Across
 * the 103 files that use `BaseModal` there are 40 DISTINCT `panelClassName`
 * strings, two radii (`rounded-2xl` at 42 sites against the `rounded-card` token
 * at 9), three paddings and 13 widths. There was no modal standard; there were
 * forty.
 *
 * So `shared/components/modals/ModalShell` now owns the modal INTERIOR -
 * surface, radius and elevation tokens, the header and its type tiers, the one
 * scroll region, section rhythm, the footer bar - and this drawer is the first
 * surface to use it. The switcher below picks the SKIN, which is the three
 * styling approaches over the one winning layout:
 *
 *   FLAT       the app's dominant look made canonical - one hairline, the radius
 *              token, a single surface, uppercase caption section heads. The
 *              closest match to the rest of the app, and the default.
 *   RAISED     layered surfaces - a tinted header band, content on inset panels
 *              so each section reads as its own card, larger title, looser
 *              rhythm. Closest to the Overview and Factory surfaces.
 *   EDITORIAL  typographic - almost no chrome, hierarchy from the type scale and
 *              whitespace alone, one rule under the title, body held to a
 *              reading measure. Closest to the docs surfaces.
 *
 * The switcher is dev-only, declared as a named constant rather than an
 * `import.meta.env.DEV` gate inside the JSX, and session-scoped: it exists to
 * pick a winner, and a Web Storage call for a prototype toggle would add a
 * storage site the golden path then has to route somewhere.
 */
import { useState } from 'react';

import { Segmented } from '@/features/shared/components/kit';
import type { ModalSkin } from '@/features/shared/components/modals/ModalShell';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { GoalDetailProvider } from './goalDetail/context';
import { useGoalDetail } from './goalDetail/useGoalDetail';
import { LedgerLayout } from './goalDetail/variants/LedgerLayout';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  goalId: string | null;
  /** Opens the GoalEditorModal in edit mode for this goal. */
  onEdit: (goal: DevGoal) => void;
  /** Fallback goal object for goals NOT in the active-project store (e.g. the
   *  cross-project channel sidebar). Used when the store lookup misses. */
  goalFallback?: DevGoal | null;
}

/** See the header: a build-flag decision taken at the point of rendering cannot
 *  be enumerated or reviewed; a named constant can be grepped. */
const SHOW_SKIN_SWITCHER = import.meta.env.DEV;

const SKINS: Array<{ v: ModalSkin; label: string }> = [
  { v: 'flat', label: 'Flat' },
  { v: 'raised', label: 'Raised' },
  { v: 'editorial', label: 'Editorial' },
];

const DEFAULT_SKIN: ModalSkin = 'flat';

export function GoalDetailDrawer({ isOpen, onClose, goalId, onEdit, goalFallback = null }: Props) {
  const model = useGoalDetail({ isOpen, goalId, onEdit, onClose, goalFallback });
  const [skin, setSkin] = useState<ModalSkin>(DEFAULT_SKIN);

  // The one early return, so no layout has to carry the guard.
  if (!model.goal) return null;

  return (
    <GoalDetailProvider model={model}>
      <LedgerLayout skin={skin} isOpen={isOpen} />
      {SHOW_SKIN_SWITCHER && isOpen && (
        // Fixed, bottom-centre, OUTSIDE the panel. Inside it the chooser became
        // part of the composition being judged, and in the editorial skin -
        // whose whole argument is "almost no chrome" - a control bar at the end
        // of the body was the loudest thing on the surface.
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9100] flex items-center gap-2 rounded-pill border border-primary/20 bg-background/95 px-3 py-1.5 shadow-elevation-3">
          <span className="typo-caption text-foreground">Skin</span>
          <Segmented label="Goal detail modal skin" value={skin} onChange={setSkin} options={SKINS} />
        </div>
      )}
    </GoalDetailProvider>
  );
}
