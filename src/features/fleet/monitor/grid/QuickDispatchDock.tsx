// QuickDispatchDock — Activity's composer, as the "Launch Rail".
//
// Conversations has `ConversationComposer` pinned under its stream: the surface
// you are reading and the place you act on it are one column. Activity had no
// such place — dispatching a session meant summoning the Quick Dispatch overlay
// over the top of the board you were reading, or leaving for the Fleet page.
// This is that composer, in the same position, for the Activity board.
//
// IT IS THE SAME CONSOLE, not a second one. The brain is `useQuickDispatchController`,
// and the leaf pieces — chips, the reserved meta line, the typeahead panel, the
// skill picker — are the overlay's own, so the `@project` / `/skill` grammar,
// the headless fallback and the ARIA combobox contract cannot drift between the
// two hosts. What is re-authored here is the SHELL.
//
// ## Three shells, one console (2026-10-06)
//
// This file is now the HOST. Everything the dock knows lives in
// `dock/useDockConsole.ts`; everything it paints lives in `dock/`, as three
// shells behind a persisted switch (`dockVariant.ts`, the same shape as the
// board's own `boardVariant.ts` — a frozen tuple, one guard, an unknown stored
// value reading as the default). The operator picks a winner and the losers get
// deleted; until then a variant may change only the ARRANGEMENT, never the
// dispatch path, the estimate or the Athena grant.
//
// All three obey the same four shape rules the operator set:
//   · ONE row holds the objective and the dispatch button, and nothing else.
//   · A TOOLBAR above it carries every toggle and every parameter (model,
//     effort, Athena, background, project, skill).
//   · Every button is the shared `Button`.
//   · No control splits its icon and its label across two lines — the launch
//     used to stack its arrow over its word, and that is what ended it.
//
// They differ in where the READOUT goes:
//   · rail    — readings on their own manifest line, above the toolbar.
//   · console — controls first; the readings drop to the line above the field.
//   · ribbon  — toolbar on top, readings in a FOOTER under the command row.
//
// ## Why there is a readout at all (the Launch Rail, 2026-09-21)
//
// The shell won a blind design contest against five other redesigns — three
// from a second model family — and the owner picked it over the host's own
// top-ranked entry. What it was picked FOR is the readout: firing an agent at a
// real repository is a pre-flight act, not a form submission, so the console
// answers three questions before the operator commits.
//
//   · WHERE this lands — the absolute target path.
//   · WHAT IT COSTS — `≈ $` and `~ min`, recomputed live as the objective, the
//     model and the effort change (`dockEstimate.ts`). The rates are real
//     published prices; the token volume is a heuristic, and the gauge says so
//     in its tooltip rather than posing as a quote.
//   · IS IT READY — STANDBY flips to ARMED, and the rail above quickens.
//   · WHERE IN THE LINE — added 2026-10-05, because the operator believed a
//     manual dispatch "always goes to last queue position" and the dock said
//     nothing either way. It does go to the tail WHEN IT QUEUES
//     (`queue.rs::enqueue_into` ranks at `max + 1`), but under the cap the
//     admission door starts it at once, ahead of whatever is waiting, and
//     calls that a backfill. `dockLanding.ts` holds what this reading is
//     allowed to claim; read it before changing a word of the pill.
//
// None of the three variants may drop one of those four. That is why they
// render `DockReadout` rather than re-authoring the pills.
//
// ## And one control that is not a reading: the Athena grant
//
// `DockAthenaToggle` arms Athena's hold BEFORE the launch, and the grant is
// written onto whatever the dispatch becomes — a started session or a queued
// row. The watcher and the reason it is a watcher are in `dockAthenaGrant.ts`.
// If the dispatch lands and the grant does not, that is TOLD: a running session
// the operator believes Athena owns is the one state this feature must never
// produce quietly.
//
// The resting row was the one dimension the Launch Rail scored worst on, and
// the fix came from a rival entry the owner also saw: permanent chrome must pay
// rent. Collapsed, the row carries the live fleet tally (how many sessions need
// you, how many are working) instead of restating a placeholder. It is shared
// by all three variants — the variants are about the CONSOLE, and a resting row
// that changed shape with the stored variant would be three different front
// doors to one room.
//
// ## What lags, and what never does (2026-10-06)
//
// This is a text field at the BOTTOM OF A LIVE BOARD. Two things re-render it
// that have nothing to do with each other: the operator's keystrokes, and the
// fleet underneath it changing. Everything it paints apart from the field
// itself is a derived READING, so those readings are taken off the urgent frame
// with `useDeferredValue` in `useDockConsole`. **THE CARET IS NEVER DEFERRED.**
// The full derivation is in that file's header.
//
// ## The anti-shake contract — unchanged, and non-negotiable in all three
//
// The dock sits at the BOTTOM of a live board: if its outer height moves as the
// operator types, the board above it moves too. So every volatile panel
// (suggestions, skill picker, both preset menus) renders absolutely at
// `bottom-full`, out of document flow, opening UPWARD — hosted ONCE here by
// `DockPanels`, so no shell can put one in its own column — and every in-flow
// row has a reserved literal height, with the objective field growing INSIDE a
// fixed deck and then scrolling. `QuickDispatchDock.test.tsx` measures the row
// class list across collapsed / typed / typeahead-open / long-objective FOR
// EACH VARIANT; the heights differ between variants and are identical within
// one, which is the property that matters.
//
// The dock is the console and the dispatch mechanism, nothing else. Its content
// is capped at 800px and centred, so on a wide window the composer stays a
// readable column instead of a full-width strip.

import { useCallback, useState } from 'react';
import { Terminal } from 'lucide-react';

import { DockConsoleShell } from './dock/DockConsoleShell';
import { DockPanels } from './dock/DockPanels';
import { DOCK_COLUMN } from './dock/DockParts';
import { DockRail } from './dock/DockRail';
import { DockRibbon } from './dock/DockRibbon';
import { useDockConsole } from './dock/useDockConsole';
import { readDockVariant, writeDockVariant, type DockVariant } from './dockVariant';

const SHELLS: Record<DockVariant, typeof DockRail> = {
  rail: DockRail,
  console: DockConsoleShell,
  ribbon: DockRibbon,
};

export function QuickDispatchDock() {
  const d = useDockConsole();
  const { c, tally } = d;
  const [variant, setVariantState] = useState<DockVariant>(readDockVariant);
  const setVariant = useCallback((v: DockVariant) => {
    setVariantState(v);
    writeDockVariant(v);
  }, []);

  if (!d.expanded) {
    return (
      <div className="relative flex-shrink-0 border-t border-border bg-foreground/[0.015]">
        <span className="dock-rail pointer-events-none absolute inset-x-0 -top-px z-[4] h-px overflow-hidden" aria-hidden />
        <button
          type="button"
          onClick={d.expand}
          data-testid="quick-dispatch-dock-expand"
          className="group block w-full text-left transition-colors hover:bg-secondary/30"
        >
          <span className={`${DOCK_COLUMN} flex h-9 items-center gap-2 px-3`}>
            <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />
            <span className="dock-caret h-3.5 w-[7px] flex-shrink-0 rounded-[1px] bg-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted transition-colors group-hover:text-foreground">
              {c.quickT.placeholder}
            </span>
            {/* The rent this row pays: what the fleet is doing right now. */}
            <span className="flex flex-shrink-0 items-center gap-2.5" data-testid="quick-dispatch-dock-tally">
              {tally.needsYou > 0 && (
                <span className="typo-label flex items-center gap-1 text-role-highlight">
                  <span className="h-1.5 w-1.5 rounded-full bg-role-highlight" aria-hidden />
                  {c.tx(c.quickT.rest_tally_needs_you, { count: tally.needsYou })}
                </span>
              )}
              {tally.working > 0 && (
                <span className="typo-label flex items-center gap-1 text-status-info">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-info" aria-hidden />
                  {c.tx(c.quickT.rest_tally_working, { count: tally.working })}
                </span>
              )}
            </span>
            <span className="typo-label flex-shrink-0 text-muted transition-colors group-hover:text-primary">
              {c.quickT.title}
            </span>
          </span>
        </button>
      </div>
    );
  }

  const Shell = SHELLS[variant];

  return (
    <div
      className="relative flex-shrink-0 border-t border-border bg-foreground/[0.015]"
      data-testid="quick-dispatch-dock"
      data-dock-variant={variant}
      onKeyDown={(e) => {
        // Escape collapses the dock rather than closing anything global — the
        // controller's own Escape handling (strip the open typeahead token)
        // runs first, in the capture phase, so the first press never collapses
        // a console the operator was mid-token in.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          d.collapse();
        }
      }}
    >
      {/* The rail — a light travelling the dock's own top hairline, quicker
          once the console is armed. Absolutely placed on the border itself, so
          it occupies no height. */}
      <span
        className={`dock-rail pointer-events-none absolute inset-x-0 -top-px z-[4] h-px overflow-hidden ${
          d.armed ? 'dock-rail-armed' : ''
        }`}
        aria-hidden
      />

      <div ref={c.cardRef} className={`${DOCK_COLUMN} dock-instrument-grid relative pb-2`}>
        <DockPanels console={d} />
        <Shell console={d} variant={variant} onVariantChange={setVariant} />
      </div>
    </div>
  );
}

export default QuickDispatchDock;
