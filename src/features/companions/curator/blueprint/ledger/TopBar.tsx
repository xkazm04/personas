/**
 * The bar the page wears: what this plan IS, and the two ways out of it.
 *
 * Two affordances the prototype had are deliberately absent, because the
 * commands behind them are not:
 *
 * - The "all 471" toggle. `curator_plan_current` carries an item for every
 *   subject that SCORES and a per-bundle count for every subject that does
 *   not; there is no third list of the whole corpus to switch to, so a toggle
 *   would be a button that re-drew the same rows.
 * - The theme switch. The app owns the theme, and a page that re-set it would
 *   be a second place the operator's choice lives.
 */
import Button from '@/features/shared/components/buttons/Button';

import type { BlueprintModel } from '../model/types';
import { utcStamp } from '../format';
import { useWords } from '../words';

interface TopBarProps {
  model: BlueprintModel;
  waiting: number;
  docketOpen: boolean;
  onToggleDocket: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
  query: string;
  onQuery: (value: string) => void;
  onHelp: () => void;
}

export function TopBar({
  model,
  waiting,
  docketOpen,
  onToggleDocket,
  queueOpen,
  onToggleQueue,
  query,
  onQuery,
  onHelp,
}: TopBarProps) {
  const { w, tx } = useWords();
  return (
    <header className="cb-top">
      <div className="cb-mark">
        <b className="typo-title-lg">{w.title}</b>
        <i className="typo-eyebrow cb-dim">{w.subtitle}</i>
      </div>
      {/* WHAT A PERSON READS, AND NOTHING A MACHINE READS.

          This row used to print the plan run's UUID and the registry's HEAD
          sha beside the clock. Neither is something anybody reads off a
          header: one is a primary key and the other is forty hex characters,
          and between them they took the width that the two facts a reader
          DOES need were competing for - when the scan was taken, and that what
          they are looking at is a projection rather than live truth.

          Both survive, on demand, in the clock's own tip. A reader chasing a
          run or a commit has somewhere to go; a reader reading the page is not
          made to step over them first.

          With no projection at all there is no run, no clock and no commit, so
          the row carries the one true sentence rather than two empty ones. */}
      <div className="cb-meta typo-caption">
        {model.planRunId === null ? (
          <span data-cb-tip={w.meta_unrun_tip}>{w.meta_unrun}</span>
        ) : (
          <>
            <span
              data-role="cb-scan"
              data-cb-tip={
                model.registryHeadSha
                  ? tx(w.scan_tip, { run: model.planRunId, sha: model.registryHeadSha })
                  : tx(w.scan_tip_no_head, { run: model.planRunId })
              }
            >
              {tx(w.scan_at, { at: utcStamp(model.scanGeneratedAt) })}
            </span>
            <span data-role="cb-projection" data-cb-tip={w.head_projection_tip}>
              {w.projection_note}
            </span>
          </>
        )}
      </div>
      <div className="cb-sp" />
      <input
        className="cb-find typo-caption"
        type="search"
        value={query}
        placeholder={w.find_placeholder}
        aria-label={w.find_label}
        autoComplete="off"
        spellCheck={false}
        data-role="cb-find"
        onChange={(e) => {
          onQuery(e.target.value);
        }}
      />
      {/* The app's Button, wearing `cb-keep` so the page's element reset leaves
          it alone: the focus ring, the press response, the hover surface and
          the coarse-pointer target are the app's, not two more hand-rolled
          copies of them. `aria-pressed` is what the drawer toggle needs and
          what the bespoke pair only mimicked with a background colour. */}
      <Button
        variant={docketOpen ? 'secondary' : 'ghost'}
        size="sm"
        className="cb-keep cb-tbtn"
        aria-pressed={docketOpen}
        data-role="cb-docket-toggle"
        data-cb-tip={w.docket_button_tip}
        onClick={onToggleDocket}
      >
        <kbd>D</kbd>
        {w.docket_button}
        <span className={`cb-pill typo-label${waiting ? '' : ' cb-zero'}`}>{waiting}</span>
      </Button>
      {/* The queue's toggle, beside the docket's, because they are the two
          drawers of the same surface. It carries NO count pill: the docket's
          waiting figure is measured from entries this page already holds,
          while the queue lives behind a door that may not have answered - and
          on this page an unread queue and an empty one must never wear the
          same mark. The count lives inside the lane, where it can say which
          it is. */}
      <Button
        variant={queueOpen ? 'secondary' : 'ghost'}
        size="sm"
        className="cb-keep cb-tbtn"
        aria-pressed={queueOpen}
        data-role="cb-queue-toggle"
        data-cb-tip={w.console.lane_note}
        onClick={onToggleQueue}
      >
        <kbd>Q</kbd>
        {w.console.lane_title}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="cb-keep cb-tbtn"
        aria-label={w.help_button_label}
        data-cb-tip={w.help_button_tip}
        onClick={onHelp}
      >
        <kbd>?</kbd>
      </Button>
    </header>
  );
}
