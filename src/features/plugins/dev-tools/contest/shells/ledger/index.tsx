// Pipeline Ledger — the Contest surface as a keyboard-first operator console.
//
// Layers, simplest first:
//   1. the ledger: every contest as one dense row with its stage rail
//      (j/k move, Enter opens the row in place — that row is the detail);
//   2. the review split over the open contest (r), keyed 1-4 / p / Esc;
//   3. setup as a command palette (n); gains and seat stats one tab over (g).
// Focus (`contest/focus.ts`) is the open row: a live notice, a new contest
// or a refine round focusing a contest from outside lands it in the layer
// its phase calls for — review for a contest waiting on review, the open row
// otherwise.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import {
  SegmentedTabs,
  segmentedTabPanelProps,
  type SegmentedTab,
} from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';

import { contestKeyString, focusContest, useContestFocus, type ContestKey } from '../../focus';
import { useContests } from '../../hooks/useContests';
import { CommandSetup } from './CommandSetup';
import { LEDGER_COPY as C, fill } from './copy';
import { ExpandedRow } from './ExpandedRow';
import { GainsBoard } from './GainsBoard';
import { KeyCap, KeyLegend } from './KeyLegend';
import { LedgerTable } from './LedgerTable';
import { isReviewable } from './model/ledgerFacts';
import { moveCursor, type LedgerCommand } from './model/ledgerKeys';
import { orderLedger } from './model/ledgerOrder';
import { ReviewSplit } from './ReviewSplit';
import { useLedgerKeys } from './useLedgerKeys';

type LedgerMode = 'ledger' | 'gains';

const MODE_TABS: SegmentedTab<LedgerMode>[] = [
  { id: 'ledger', label: C.modeLedger, testId: 'ledger-mode-ledger' },
  { id: 'gains', label: C.modeGains, testId: 'ledger-mode-gains' },
];
const TAB_PREFIX = 'contest-ledger-mode';

function keyOf(s: ContestKey): ContestKey {
  return { projectId: s.projectId, contestId: s.contestId };
}

export default function PipelineLedgerShell() {
  const { t, tx } = useTranslation();
  const list = useContests();
  const rows = useMemo(() => orderLedger(list.contests), [list.contests]);
  const focused = useContestFocus((s) => s.focused);
  const focusSeq = useContestFocus((s) => s.focusSeq);

  const [mode, setMode] = useState<LedgerMode>('ledger');
  const [cursor, setCursor] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [ownSeq, setOwnSeq] = useState<number | null>(null);
  const [seenSeq, setSeenSeq] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const focusedKey = focused ? contestKeyString(focused) : null;
  const cur = Math.min(cursor, Math.max(0, rows.length - 1));

  // A focus the shell did not cause (live notice, SetupForm, a refine round,
  // another shell) lands the contest in its relevant layer — once the ledger
  // knows the contest. Adjusting state during render, not in an effect.
  if (focusSeq !== seenSeq) {
    const idx = focusedKey ? rows.findIndex((r) => r.key === focusedKey) : -1;
    const own = focusSeq === ownSeq;
    if (!focusedKey || idx >= 0 || own || !list.isLoading) {
      setSeenSeq(focusSeq);
      if (idx >= 0) setCursor(idx);
      if (!own && focusedKey) {
        setMode('ledger');
        setReviewOpen(idx >= 0 && rows[idx]!.summary.phase === 'review');
      }
      if (!focusedKey) setReviewOpen(false);
    }
  }

  /** Focus from inside the shell: the row opens, no layer jump. */
  const focusOwn = useCallback((key: ContestKey | null) => {
    focusContest(key);
    setOwnSeq(useContestFocus.getState().focusSeq);
  }, []);

  const onCommand = useCallback(
    (cmd: LedgerCommand) => {
      const row = rows[cur];
      switch (cmd.kind) {
        case 'move':
          if (mode === 'ledger') setCursor(moveCursor(cur, cmd.by, rows.length));
          return;
        case 'toggle-row':
          if (row) focusOwn(row.key === focusedKey ? null : keyOf(row.summary));
          return;
        case 'back':
          if (mode === 'gains') setMode('ledger');
          else if (focusedKey) focusOwn(null);
          return;
        case 'open-review':
          if (focusedKey) setReviewOpen(true);
          else if (row && isReviewable(row.summary.phase)) {
            focusOwn(keyOf(row.summary));
            setReviewOpen(true);
          }
          return;
        case 'new-contest':
          setSetupOpen(true);
          return;
        case 'toggle-gains':
          setMode((m) => (m === 'ledger' ? 'gains' : 'ledger'));
          return;
        default:
          return;
      }
    },
    [rows, cur, mode, focusedKey, focusOwn],
  );
  useLedgerKeys(mode, onCommand, !reviewOpen && !setupOpen);

  // Keep the cursor row on screen as j/k walks the ledger.
  useEffect(() => {
    tableRef.current?.querySelector('[data-cursor]')?.scrollIntoView?.({ block: 'nearest' });
  }, [cur]);

  const listError = list.error
    ? tx(t.plugins.contest.load_failed, { message: resolveErrorTranslated(t, extractMessage(list.error)).message })
    : null;

  if (reviewOpen && focused) {
    return (
      <div data-testid="contest-shell-ledger">
        <ReviewSplit contest={focused} onBack={() => setReviewOpen(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="contest-shell-ledger">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs
          tabs={MODE_TABS}
          activeTab={mode}
          onTabChange={setMode}
          idPrefix={TAB_PREFIX}
          ariaLabel={C.modeSwitchLabel}
          fullWidth={false}
          size="sm"
        />
        <span className="typo-caption text-foreground">{fill(C.rowsCount, { count: rows.length })}</span>
        <span className="hidden typo-caption text-foreground md:inline">{C.cursorHint}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<Keyboard className="h-3.5 w-3.5" />}
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((v) => !v)}
          >
            {legendOpen ? C.keysHide : C.keysShow}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setSetupOpen(true)}
            data-testid="ledger-new"
          >
            {C.newEntry} <KeyCap>n</KeyCap>
          </Button>
        </div>
      </div>
      {legendOpen && <KeyLegend />}

      <div
        role="tabpanel"
        id={segmentedTabPanelProps(TAB_PREFIX, mode).id}
        aria-labelledby={segmentedTabPanelProps(TAB_PREFIX, mode)['aria-labelledby']}
        ref={tableRef}
      >
        {mode === 'ledger' ? (
          <LedgerTable
            rows={rows}
            cursor={cur}
            expandedKey={focusedKey}
            onToggle={(i) => {
              setCursor(i);
              const row = rows[i];
              if (row) focusOwn(row.key === focusedKey ? null : keyOf(row.summary));
            }}
            renderExpansion={(row) => <ExpandedRow row={row} onOpenReview={() => setReviewOpen(true)} />}
            isLoading={list.isLoading}
            error={listError}
            onRetry={() => void list.refresh()}
            onNew={() => setSetupOpen(true)}
          />
        ) : (
          <GainsBoard
            contests={list.contests}
            isLoading={list.isLoading}
            error={listError}
            onRetry={() => void list.refresh()}
            onOpen={(g) => {
              focusOwn(keyOf(g.summary));
              setMode('ledger');
            }}
          />
        )}
      </div>

      <CommandSetup open={setupOpen} onClose={() => setSetupOpen(false)} onCreated={() => setSetupOpen(false)} />
    </div>
  );
}
