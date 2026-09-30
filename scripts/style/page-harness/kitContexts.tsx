/**
 * A synthetic project at the scale the owner named (kit grow-1): 320 contexts in 22 groups, sizes
 * from 64 down to 1, states drawn deterministically. Plus `OverviewDemo`, the reference
 * composition of ContextOverview over it (cards for a small group, a paged table for a large
 * one, a bounded search), used by `kit/specimen` and `kit/overview`. Harness-only fixtures.
 */
/* eslint-disable custom/no-hardcoded-jsx-text -- specimen fixtures in a harness-only view, not product copy */
import { useState, type ReactNode } from 'react';
import {
  ContextCard, ContextCards, ContextOverview, DataTable, KitButton, Meta, UnitStrip,
  type ContextGroup, type ContextGroupState, type TableCol, type TableRow, type Tone, type Glyph,
} from '@/features/shared/components/kit';

export type CtxState = 'crit' | 'warn' | 'setup' | 'unmeasured' | 'ok';
export interface Ctx { id: string; name: string; group: string; state: CtxState; files: number; kpis: number; cost: number }

const MARK: Record<CtxState, { tone: Tone; glyph: Glyph; label: string }> = {
  crit: { tone: 'error', glyph: 'solid', label: 'Off track' },
  warn: { tone: 'warning', glyph: 'solid', label: 'At risk' },
  setup: { tone: 'info', glyph: 'hollow', label: 'Waiting on you' },
  unmeasured: { tone: 'neutral', glyph: 'empty', label: 'Not measured' },
  ok: { tone: 'success', glyph: 'soft', label: 'On track' },
};
const ORDER: CtxState[] = ['crit', 'warn', 'setup', 'unmeasured', 'ok'];
const GROUPS: Array<[string, string, number]> = [
  ['Platform core', 'backend', 64], ['Billing', 'backend', 38], ['Onboarding', 'frontend', 30], ['Search', 'backend', 24],
  ['Notifications', 'backend', 20], ['Admin console', 'frontend', 18], ['Reporting', 'data', 16], ['Auth', 'backend', 14],
  ['Mobile shell', 'mobile', 12], ['Integrations', 'backend', 12], ['Design system', 'frontend', 10], ['Data pipeline', 'data', 9],
  ['Exports', 'data', 8], ['Audit log', 'backend', 8], ['Settings', 'frontend', 7], ['Help center', 'frontend', 6],
  ['Feature flags', 'infra', 6], ['Deploy', 'infra', 5], ['Observability', 'infra', 5], ['Localization', 'frontend', 4],
  ['Legal pages', 'frontend', 3], ['Status page', 'infra', 1],
];
const PARTS = ['api', 'store', 'views', 'jobs', 'cache', 'schema', 'client', 'rules', 'hooks', 'sync', 'queue', 'router', 'forms', 'tests'];

const usd = (v: number) => `$${v.toFixed(2)}`;

function rng(seed: number) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

function build(): Array<ContextGroup<Ctx>> {
  const r = rng(7);
  return GROUPS.map(([name, domain, size], gi) => {
    const contexts: Ctx[] = Array.from({ length: size }, (_, i) => {
      const x = r();
      const state: CtxState = x < 0.08 ? 'crit' : x < 0.2 ? 'warn' : x < 0.3 ? 'setup' : x < 0.42 ? 'unmeasured' : 'ok';
      const part = PARTS[i % PARTS.length]!;
      return { id: `c-${gi}-${i}`, name: `${name} ${part}${i >= PARTS.length ? ` ${Math.floor(i / PARTS.length) + 1}` : ''}`, group: name, state, files: 3 + Math.floor(r() * 40), kpis: Math.floor(r() * 6), cost: Math.round(r() * 400) / 100 };
    });
    const n = (s: CtxState) => contexts.filter((c) => c.state === s).length;
    const states: ContextGroupState[] = ORDER.filter((s) => n(s) > 0).map((s) => ({ n: n(s), tone: MARK[s].tone, glyph: MARK[s].glyph }));
    const worst = ORDER.find((s) => n(s) > 0) ?? 'ok';
    const cost = contexts.reduce((a, c) => a + c.cost, 0);
    return {
      id: `g-${gi}`, name, meta: domain, count: size, mark: MARK[worst], states, contexts,
      figures: [n('crit') + n('warn') || '-', contexts.reduce((a, c) => a + c.kpis, 0), usd(cost)],
    };
  });
}

export const CONTEXT_GROUPS = build();
export const CONTEXT_TOTAL = CONTEXT_GROUPS.reduce((a, g) => a + g.count, 0);

type Col = 'name' | 'files' | 'kpis' | 'cost';
const COLS: ReadonlyArray<TableCol<Col>> = [
  { key: 'name', label: 'Context', sortable: 'asc' },
  { key: 'files', label: 'Files', num: true, sortable: 'desc', width: '6rem' },
  { key: 'kpis', label: 'KPIs', num: true, sortable: 'desc', width: '6rem' },
  { key: 'cost', label: 'Cost', num: true, sortable: 'desc', width: '7rem' },
];
const tableRow = (c: Ctx, withGroup: boolean): TableRow<Col> => ({
  id: c.id, mark: MARK[c.state],
  cells: {
    name: <span className="k-cell2"><span className="typo-body k-strong k-ellipsis">{c.name}</span><span className="typo-caption k-ellipsis">{withGroup ? `${c.group} · ${MARK[c.state].label}` : MARK[c.state].label}</span></span>,
    files: c.files, kpis: c.kpis || '-', cost: `$${c.cost.toFixed(2)}`,
  },
  sort: { name: c.name, files: c.files, kpis: c.kpis, cost: c.cost },
});

function Table({ contexts, label, withGroup, pager }: { contexts: readonly Ctx[]; label: string; withGroup?: boolean; pager?: ReactNode }) {
  return <DataTable<Col> label={label} cols={COLS} rows={contexts.map((c) => tableRow(c, !!withGroup))} empty={{ title: 'No contexts match' }} pager={pager} />;
}

const PAGE = 20;
function LargeGroup({ g }: { g: ContextGroup<Ctx> }) {
  const [all, setAll] = useState(false);
  const shown = all ? g.contexts : g.contexts.slice(0, PAGE);
  return (
    <Table contexts={shown} label={String(g.name)} pager={g.contexts.length > PAGE && (
      <><span className="typo-caption">{shown.length} of {g.contexts.length}</span><KitButton quiet onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show all'}</KitButton></>
    )} />
  );
}

function Cards({ g }: { g: ContextGroup<Ctx> }) {
  return (
    <ContextCards label={String(g.name)}>
      {g.contexts.map((c, i) => (
        <ContextCard
          key={c.id} title={c.name} meta={<Meta parts={[`${c.files} files`, MARK[c.state].label]} />} mark={MARK[c.state]} onPress={() => {}}
          actions={i % 3 === 0 ? <KitButton quiet onClick={() => {}} stopPropagation>Scan</KitButton> : undefined}
          figures={<><span className="typo-data k-regular">{c.kpis} KPIs</span><span className="typo-data k-regular k-quiet">{usd(c.cost)}</span><UnitStrip size="s" label={`${c.kpis} KPIs`} segments={[{ n: c.kpis, tone: MARK[c.state].tone }]} /></>}
        />
      ))}
    </ContextCards>
  );
}

/** ContextOverview over the 320-context project; `initialOpen` / `initialQuery` pin a level for a shot. */
export function OverviewDemo({ initialOpen = null, initialQuery = '' }: { initialOpen?: string | null; initialQuery?: string }) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [query, setQuery] = useState(initialQuery);
  return (
    <ContextOverview<Ctx>
      label="Contexts" rootLabel="All contexts" groups={CONTEXT_GROUPS} open={open} onOpen={setOpen} query={query} onQuery={setQuery}
      searchPlaceholder={`Search ${CONTEXT_TOTAL} contexts`}
      match={(c, q) => c.name.toLowerCase().includes(q.toLowerCase())}
      unitLabel={(g) => `${g.count} contexts`}
      legend={(q) => (q === 1 ? '1 square = 1 context, coloured by state' : `1 square = ${q} contexts, coloured by state`)}
      figureHeads={['At risk', 'KPIs', 'Cost']}
      empty={{ title: 'No contexts yet' }}
      renderGroup={(g, level) => (level === 'cards' ? <Cards g={g} /> : <LargeGroup g={g} />)}
      renderMatches={(m, total) => (
        <Table contexts={m} label="Matches" withGroup pager={total > m.length && <span className="typo-caption">{m.length} of {total} matches shown; refine the search</span>} />
      )}
    />
  );
}
