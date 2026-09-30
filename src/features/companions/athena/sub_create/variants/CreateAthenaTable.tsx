import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateAthenaVariantProps } from '../engine/createAthenaTypes';
import { useLineDone } from '../shared/useLineDone';
import { TableDock } from './table/TableDock';
import { TableKeysSheet } from './table/TableKeysSheet';
import { TablePresence } from './table/TablePresence';
import { TableRail } from './table/TableRail';
import { TableStyleCard } from './table/TableStyleCard';
import { TableThread } from './table/TableThread';
import { useTableFacts } from './table/useTableFacts';
import { useTableKeys } from './table/useTableKeys';
import './table/table.css';

/**
 * Create Athena - "Table" shell, ported from the contest winner "Across the
 * Table" (athena-voice-studio-ui B/1, owner's pick 2026-09-30). The
 * conversation owns the page: her lines and the live card sit in the thread,
 * answered steps fold into receipts with "change"; the path flanks it on the
 * left and her card writes itself on the right. Same engine as Stage; Stage
 * stays the default until the owner accepts this port.
 * Plan: docs/concepts/athena-voice-studio-v2.md.
 */
export default function CreateAthenaTable({ engine }: CreateAthenaVariantProps) {
  const facts = useTableFacts();
  const [keysOpen, setKeysOpen] = useState(false);
  const [lineDone, markDone] = useLineDone(engine.line.id, engine.line.text);
  const openKeys = useCallback(() => setKeysOpen(true), []);
  const keys = useTableKeys(engine, openKeys, lineDone);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={root}
      className="athena-table"
      tabIndex={-1}
      onKeyDown={keysOpen ? undefined : keys.onKeyDown}
      onKeyUp={keysOpen ? undefined : keys.onKeyUp}
      data-testid="create-athena-table"
      data-step={engine.stepId}
    >
      <div className="tb-frame">
        <TableRail engine={engine} onOpenKeys={openKeys} />
        <main className="tb-centre">
          <TablePresence engine={engine} typing={!lineDone} />
          <TableThread engine={engine} facts={facts} lineDone={lineDone} onLineDone={markDone} />
          <TableDock engine={engine} lineDone={lineDone} />
        </main>
        <TableStyleCard engine={engine} facts={facts} />
      </div>
      <TableKeysSheet open={keysOpen} onClose={() => setKeysOpen(false)} />
    </div>
  );
}
