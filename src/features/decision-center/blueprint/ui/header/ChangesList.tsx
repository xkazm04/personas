import { forwardRef } from 'react';
import { useSheet } from '../../controller/SheetContext';
import type { Change } from '../../model/changes';
import { useRunWords } from '../rail/panels/AgentsDetail';
import { Press } from '../Press';
import { statusWord } from '../StatusChip';

/** One entry in words: "Approved: <title>", "Run failed: <phase> · <lenses>", "New readings (3): <feature> · <lens>". */
export function useChangeWords(): (c: Change) => string {
  const s = useSheet();
  const { B, tx } = s.text;
  const W = useRunWords();
  return (c) => {
    switch (c.kind) {
      case 'status': return tx(B.change_status, { status: statusWord(B, c.to), title: c.title });
      case 'proposed': return tx(B.change_proposed, { title: c.title });
      case 'run': {
        const what = `${W.phase(c.phase)} · ${W.lenses(c.lenses)}`;
        return c.from === null && c.to === 'running' ? tx(B.change_run_started, { what }) : tx(B.change_run_ended, { status: W.status(c.to), what });
      }
      case 'readings': return tx(B.change_readings, { count: c.count, feature: s.plan.L.TILE[c.fid]?.f.name ?? c.fid, lens: s.plan.LENS[c.lens]?.name ?? c.lens });
    }
  };
}

interface Props {
  entries: readonly Change[];
  /** Pressing an entry goes to what it names; the list closes. */
  onGo: (c: Change) => void;
  id: string;
}

/** The list the chip opens: the entries newest first, each a menu item that goes to what it names. */
export const ChangesList = forwardRef<HTMLDivElement, Props & { style: React.CSSProperties; onKeyDown: React.KeyboardEventHandler }>(
  function ChangesList({ entries, onGo, id, style, onKeyDown }, ref) {
    const s = useSheet();
    const { B } = s.text;
    const words = useChangeWords();
    return (
      <div ref={ref} id={id} className="bp-chglist" role="menu" aria-label={B.changes_head} style={style} onKeyDown={onKeyDown} data-testid="blueprint-changes-list">
        <div className="chg-h">{B.changes_head}</div>
        {entries.map((c) => (
          <Press key={c.key} tone="chg-it" role="menuitem" tabIndex={-1} onClick={() => onGo(c)} data-kind={c.kind} data-change={c.key}>
            {words(c)}
          </Press>
        ))}
      </div>
    );
  },
);
