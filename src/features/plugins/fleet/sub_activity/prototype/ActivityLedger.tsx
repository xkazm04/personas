/**
 * Gate K prototype: Fleet Activity composed from the A/1 "Ledger" kit
 * (`src/features/shared/components/kit-proto/ledger/`), ported from the style-kit
 * contest entry claude-opus_xhigh/variant-1 surface 2.
 *
 * Three sections on one grid: Totals (the stat strip), Sessions (state filter +
 * search over a sortable ledger, the selected row's folio beside it) and Tools.
 * Real rows, real search, real refresh. The row's state, title and reason come
 * from the live registry (`fleetSessions`), which the variant joined the same
 * way; a transcript with no registry row reads "Gone". The first row is selected
 * on arrival and its folio open, as in the variant. Click selects; Enter or the
 * folio's Open action calls `onOpen` (live session, or the insights modal).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LedgerKit, Section, ChipRow } from '@/features/shared/components/kit-proto/ledger';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { ActivityKitProps } from './kitProto';
import { toLedgerSession, sortSessions, toolTotals, type LedgerState, type SortKey } from './ledger/ledgerModel';
import { LedgerTotals } from './ledger/LedgerTotals';
import { LedgerSessions } from './ledger/LedgerSessions';
import { useLedgerKeys } from './ledger/useLedgerKeys';

export default function ActivityLedger(props: ActivityKitProps) {
  const { rows, filtered, loading, onRefresh, onOpen } = props;
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const sessions = useSystemStore((st) => st.fleetSessions);
  const [state, setState] = useState<LedgerState | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lastMs', dir: -1 });
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  // The row's state lives in the registry. The Fleet page keeps it live; a cold
  // mount (the page harness, a deep link) pulls one snapshot so rows are not all "Gone".
  useEffect(() => {
    if (useSystemStore.getState().fleetSessions.length === 0) {
      useSystemStore.getState().fleetRefresh().catch(silentCatch('ActivityLedger:fleetRefresh'));
    }
  }, []);

  const byId = useMemo(() => new Map(sessions.filter((s) => s.claudeSessionId).map((s) => [s.claudeSessionId!, s])), [sessions]);
  const all = useMemo(() => rows.map((r) => toLedgerSession(r, byId)), [rows, byId]);
  const visible = useMemo(() => {
    const keys = new Set(filtered.map((r) => r.path));
    const list = all.filter((s) => keys.has(s.key) && (state === 'all' || s.state === state));
    return sortSessions(list, sort.key, sort.dir);
  }, [all, filtered, state, sort]);
  const tools = useMemo(() => toolTotals(all), [all]);

  // Arrival selects the first row, as the variant does, so the folio shows a session at once.
  useEffect(() => {
    if (sel === null && visible[0] && open) setSel(visible[0].key);
  }, [sel, visible, open]);
  const selected = all.find((s) => s.key === sel) ?? null;

  const move = useLedgerKeys({
    visible, sel, searchRef,
    select: (key) => { setSel(key); setOpen(true); },
    openRow: () => { if (selected) onOpen(selected.row); },
    back: () => { if (open && sel) setOpen(false); else if (sel) setSel(null); },
  });

  const refresh = () => {
    onRefresh();
    useSystemStore.getState().fleetRefresh().catch(silentCatch('ActivityLedger:fleetRefresh'));
  };
  const toolMax = tools[0]?.count ?? 1;
  const toolCalls = tools.reduce((a, x) => a + x.count, 0);

  return (
    <LedgerKit density="compact" data-testid="kit-proto-ledger">
      <Section id="fa-window" eyebrow={`1 / 3 · ${f.activity_eyebrow_window}`} title={f.activity_sec_totals}>
        <LedgerTotals all={all} sessions={sessions} loading={loading && rows.length === 0} />
      </Section>
      <LedgerSessions
        {...props}
        all={all}
        visible={visible}
        state={state}
        setState={setState}
        sort={sort}
        setSort={setSort}
        selected={open ? selected : null}
        onSelect={(key) => { setSel(key); setOpen(true); }}
        onClose={() => setOpen(false)}
        onRefresh={refresh}
        searchRef={searchRef}
        onSearchDown={() => move(1)}
      />
      <Section
        id="fa-tools"
        eyebrow={`3 / 3 · ${f.activity_eyebrow_all}`}
        title={t.common.tools}
        count={(
          <>
            <Numeric value={tools.length} unit="count" /> {t.common.tools.toLowerCase()}
            <span className="dot">·</span>
            <Numeric value={toolCalls} unit="count" /> {f.activity_tile_tool_calls.toLowerCase()}
          </>
        )}
      >
        <div className="lgk-pad-top">
          <ChipRow chips={tools.map((x) => ({ name: x.name, count: <Numeric value={x.count} unit="count" />, share: x.count / toolMax }))} />
        </div>
      </Section>
    </LedgerKit>
  );
}
