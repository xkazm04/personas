/**
 * Wire -> view: one pure function from what the IPC returned (or the dev
 * fixture) to the Standup page. Memoised once per data change by the panel,
 * so every row object keeps its identity until its own data moves and the
 * memoised rows skip re-rendering.
 */
import type { ForecastSlot } from '@/lib/bindings/ForecastSlot';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Standup } from '@/lib/bindings/Standup';
import type { StandupEvent } from '@/lib/bindings/StandupEvent';
import type { StandupItem } from '@/lib/bindings/StandupItem';
import type { StandupProjectReport } from '@/lib/bindings/StandupProjectReport';
import { machineView } from './machine';
import { inWindow, pos, windowsFor } from './timeAxis';
import type {
  BlockTone, Counts, EventMark, GroupId, Life, RowGroup, RowState, RowView, SinceLast, StandupView, TickState, Window,
} from './types';

export interface ViewInput {
  standup: Standup | null;
  events: readonly StandupEvent[];
  forecast: readonly ForecastSlot[];
  utilization: readonly HostUtilizationPoint[];
  projectNames: Readonly<Record<string, string>>;
  /**
   * True once the project list has loaded: a card or ask naming a project that
   * is not in `projectNames` is then a deleted project and is not drawn (an
   * armed revision is immutable, so the backend cannot drop it from the plan).
   */
  projectsKnown?: boolean;
  personaNames: Readonly<Record<string, string>>;
  /** Per project, the last standups oldest first; absent = not recorded. */
  history: Readonly<Record<string, TickState[]>>;
  /** itemId -> why the plan refused it (a headless master holds the project). */
  refusals: Readonly<Record<string, string>>;
  nowMs: number;
}

const GROUP_ORDER: readonly GroupId[] = ['decide', 'agents', 'waits', 'blank', 'filler', 'refused'];

export function lifeOf(s: Standup | null): Life {
  if (!s) return 'none';
  if (s.status === 'draft') return 'decide';
  if (s.status === 'armed') return s.report ? 'return' : 'armed';
  return 'ended';
}

/** Where the clock stands against an item's forecast slots, once armed. */
function clockState(slots: readonly ForecastSlot[], nowMs: number): 'running' | 'done' | null {
  if (slots.some((s) => s.startMs <= nowMs && s.endMs > nowMs)) return 'running';
  if (slots.length > 0 && slots.every((s) => s.endMs <= nowMs)) return 'done';
  return null;
}

function itemState(item: StandupItem, slots: readonly ForecastSlot[], armed: boolean, nowMs: number, runningNow: boolean): RowState {
  if (item.kind === 'filler') return (armed && clockState(slots, nowMs)) || 'filler';
  if (item.state === 'skipped') return 'skipped';
  if (item.state === 'proposed') return item.kind === 'direction' && item.proposals.length === 0 ? 'blank' : 'proposed';
  if (!armed) return 'decided';
  if (runningNow) return 'running';
  return clockState(slots, nowMs) ?? 'decided';
}

function blockTone(state: RowState, slot: ForecastSlot, armed: boolean, nowMs: number, filler: boolean): BlockTone {
  if (state === 'proposed' || state === 'blank') return 'proposed';
  if (armed && slot.endMs <= nowMs) return 'done';
  if (armed && slot.startMs <= nowMs) return 'running';
  return filler ? 'filler' : 'decided';
}

function marks(events: readonly StandupEvent[], projectId: string | undefined, w: Window): EventMark[] {
  if (!projectId) return [];
  return events
    .filter((e) => e.projectId === projectId && inWindow(e.at, w))
    .map((e) => ({ id: e.id, kind: e.kind, at: e.at, pos: pos(e.at, w), summary: e.summary }));
}

function groupOf(item: StandupItem, refused: boolean): GroupId {
  if (refused) return 'refused';
  if (item.kind === 'create_agent' || item.kind === 'retune_agent') return 'agents';
  if (item.kind === 'filler') return 'filler';
  return item.proposals.length === 0 ? 'blank' : 'decide';
}

function nameOf(item: StandupItem, input: ViewInput): string {
  if (item.createSpec) return item.createSpec.name;
  const persona = item.retuneSpec?.personaId ?? item.personaId;
  if (item.kind === 'retune_agent' && persona) return input.personaNames[persona] ?? persona;
  return (item.projectId && input.projectNames[item.projectId]) || item.projectId || item.id;
}

function itemRow(item: StandupItem, input: ViewInput, ctx: RowContext): RowView {
  const slots = input.forecast.filter((s) => s.itemId === item.id);
  const refusal = input.refusals[item.id];
  const report = item.projectId ? ctx.report.get(item.projectId) : undefined;
  const runningNow = ctx.armed && item.kind === 'direction' && (report?.running ?? 0) > 0;
  const state: RowState = refusal ? 'refused' : itemState(item, slots, ctx.armed, input.nowMs, runningNow);
  const filler = item.kind === 'filler';
  return {
    key: item.id,
    kind: filler ? 'filler' : item.kind === 'direction' ? 'direction' : 'agent',
    group: groupOf(item, Boolean(refusal)),
    itemId: item.id,
    projectId: item.projectId,
    name: nameOf(item, input),
    state,
    headline: item.chosen ?? '',
    evidence: item.evidence || item.createSpec?.charter || item.retuneSpec?.note || '',
    proposals: item.proposals,
    chosenIndex: item.state === 'accepted' ? item.proposals.findIndex((p) => p.text === item.chosen) : -1,
    history: (item.kind !== 'create_agent' && item.kind !== 'retune_agent' && item.projectId && input.history[item.projectId]) || null,
    pastMarks: marks(input.events, item.projectId, ctx.past),
    nightMarks: marks(input.events, item.projectId, ctx.night),
    moved: report?.moved.length ?? 0,
    blocks: slots.map((s) => ({
      id: `${s.itemId}:${s.startMs}`, start: pos(s.startMs, ctx.night), end: pos(s.endMs, ctx.night),
      tone: blockTone(state, s, ctx.armed, input.nowMs, filler),
    })),
    refusal,
    agentVerb: item.kind === 'create_agent' ? 'create' : item.kind === 'retune_agent' ? 'retune' : undefined,
  };
}

interface RowContext {
  armed: boolean;
  past: Window;
  night: Window;
  report: Map<string, StandupProjectReport>;
}

/** One "waits for you" row per parked ask, bound to its project's direction item (for Talk it through). */
function holdRows(s: Standup, input: ViewInput, ctx: RowContext): RowView[] {
  return (s.report?.projects ?? []).filter((p) => live(p.projectId, input)).flatMap((p) => p.parked.map((ask): RowView => {
    const item = s.plan.items.find((i) => i.projectId === p.projectId && i.kind === 'direction');
    return {
      key: `ask:${ask.eventId}`, kind: 'hold', group: 'waits', itemId: item?.id, projectId: p.projectId,
      name: input.projectNames[p.projectId] ?? p.projectId, state: 'waits', headline: ask.summary,
      evidence: p.nextDecide ?? '', proposals: [], chosenIndex: -1, history: null,
      pastMarks: [], nightMarks: marks(input.events, p.projectId, ctx.night), moved: 0, blocks: [], ask,
    };
  }));
}

function sinceLast(s: Standup): SinceLast | null {
  const r = s.report;
  if (!r) return null;
  return {
    sinceMs: r.sinceMs,
    moved: r.projects.reduce((n, p) => n + p.moved.length, 0),
    projects: r.projects.filter((p) => p.moved.length > 0).length,
    parked: r.projects.reduce((n, p) => n + p.parked.length, 0),
    running: r.projects.reduce((n, p) => n + p.running, 0),
    created: r.createdAgents.map((a) => a.name),
  };
}

function countsOf(rows: readonly RowView[]): Counts {
  const c: Counts = { waits: 0, proposed: 0, decided: 0, running: 0, refused: 0 };
  for (const r of rows) {
    if (r.state === 'waits') c.waits++;
    else if (r.state === 'proposed') c.proposed++;
    else if (r.state === 'refused') c.refused++;
    else if (r.state === 'running') { c.running++; if (r.kind !== 'filler') c.decided++; }
    else if ((r.state === 'decided' || r.state === 'done') && r.kind !== 'filler') c.decided++;
  }
  return c;
}

/** Is this project still registered (or is the list not known yet, or is there no project)? */
function live(projectId: string | undefined, input: ViewInput): boolean {
  return !input.projectsKnown || !projectId || projectId in input.projectNames;
}

export function buildView(input: ViewInput): StandupView {
  const s = input.standup;
  const { past, night } = windowsFor(input.nowMs, s?.armedAt);
  const ctx: RowContext = { armed: s?.status === 'armed', past, night, report: new Map((s?.report?.projects ?? []).map((p) => [p.projectId, p])) };
  const itemRows = (s?.plan.items ?? []).filter((i) => live(i.projectId, input)).sort((a, b) => a.priority - b.priority).map((i) => itemRow(i, input, ctx));
  const all = [...itemRows, ...(s ? holdRows(s, input, ctx) : [])];
  const groups: RowGroup[] = GROUP_ORDER.map((id) => ({ id, rows: all.filter((r) => r.group === id) })).filter((g) => g.rows.length > 0);
  const planned = itemRows.filter((r) => r.kind === 'direction' && ['decided', 'running', 'done'].includes(r.state));
  const stateOf = new Map(itemRows.map((r) => [r.itemId, r]));
  return {
    id: s?.id ?? null,
    status: s?.status ?? 'none',
    life: lifeOf(s),
    revision: s?.revision ?? 0,
    nowMs: input.nowMs,
    past,
    night,
    groups,
    rows: groups.flatMap((g) => g.rows),
    counts: countsOf(all),
    machine: machineView(input.utilization, input.forecast, (slot) => {
      const row = stateOf.get(slot.itemId);
      return row ? blockTone(row.state, slot, ctx.armed, input.nowMs, row.kind === 'filler') : 'filler';
    }, past, night),
    sinceLast: s ? sinceLast(s) : null,
    plannedDirections: planned.length,
    plannedRuns: input.forecast.filter((f) => planned.some((r) => r.itemId === f.itemId)).length,
  };
}
