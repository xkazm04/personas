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
  query: string;
  onQuery: (value: string) => void;
  onHelp: () => void;
}

export function TopBar({
  model,
  waiting,
  docketOpen,
  onToggleDocket,
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
      {/* With no projection there is no run id, no scan clock and no commit
          the plan was made against - so the meta row carries the one true
          sentence rather than three empty ones. */}
      <div className="cb-meta typo-caption">
        {model.planRunId === null ? (
          <span data-cb-tip={w.meta_unrun_tip}>{w.meta_unrun}</span>
        ) : (
          <>
            <span>{model.planRunId}</span>
            <span>{tx(w.scan_at, { at: utcStamp(model.scanGeneratedAt) })}</span>
            <span data-cb-tip={w.head_projection_tip}>
              {model.registryHeadSha
                ? tx(w.head_projection, { sha: model.registryHeadSha })
                : w.head_projection_unknown}
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
