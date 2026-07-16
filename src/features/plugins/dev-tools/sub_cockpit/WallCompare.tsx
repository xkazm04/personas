// WALL — "Compare" (R7 winner; R8 absorbed Passport readability; R9 adds the
// OVERVIEW GRID + REAL DISPATCH).
//
// R9.1 — two views of the same wall, morphing into each other:
//   • Grid (overview) — 3 columns of passport COVERS (title, health counts,
//     the two readiness axes, blockers digest): the "majority of projects on
//     first sight" layer.
//   • Table (compare) — the full row-aligned dimension comparison.
//   The covers carry framer-motion layoutIds, so switching views RECOMPOSES:
//   each cover morphs from its grid tile into its table column (and back);
//   the table body fades in under them. Sorting animates in grid view too.
//
// R9.2 — the popover's follow-up actions are REAL now: "Queue Claude task" /
//   "Wire connector" / "Write config" dispatch a Fleet terminal seeded with a
//   preset prompt (see wallDispatch.ts for the impact analysis). One task =
//   one live terminal: while a session with this dispatch key is alive the
//   button is replaced by "View in Fleet →" and re-dispatch is refused until
//   that terminal is killed.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowUpRight, BadgeCheck, CheckCircle2, Lock, PlugZap, Settings2, TerminalSquare, X } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';
import { SECTIONS, type CellValue } from '@/features/teams/sub_factory/passport/passportRows';

import { InkCellValue, InkTabs, NEON, SETUP_BLUE, anchorTip, inkKindOf } from './cockpitGlyphs';
import { listSessions } from '@/api/fleet/fleet';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { dispatchKey, dispatchToFleet } from './wallDispatch';
import { HeaderStatband } from './wallHeaders';
import {
  IMPROVE_ACTION_LABEL, ROW_META, WALL, sortWall, wallHealth,
  type WallEntry, type WallRowMeta, type WallSort,
} from './wallMock';

const SORT_TABS: Array<{ id: WallSort; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'automation', label: 'Automation' },
  { id: 'production', label: 'Production' },
  { id: 'gap', label: 'Gap' },
];

type WallView = 'grid' | 'table';
const VIEW_TABS: Array<{ id: WallView; label: string }> = [
  { id: 'table', label: 'Compare' },
  { id: 'grid', label: 'Overview' },
];


const bodySections = SECTIONS.map((s) => ({ ...s, rows: s.rows.filter((r) => !r.headline) }));

function worstHue(entry: WallEntry): string {
  const health = wallHealth(entry.project);
  if (health.crit > 0) return NEON.red;
  if (health.warn > 0) return NEON.amber;
  if (health.total === 0) return SETUP_BLUE;
  return NEON.emerald;
}

// -- the upgrade popover — now a real dispatcher ---------------------------------

interface ImproveState {
  projectId: string;
  projectName: string;
  rowKey: string;
  rowLabel: string;
  value: CellValue;
  meta: WallRowMeta;
  rect: DOMRect;
}

/** Which ladder step the cell currently sits on. */
function reachedStep(value: CellValue, ladder: string[]): number {
  const steps = ladder.length - 1;
  if (value.kind === 'ordinal') return Math.round(value.pos * steps);
  if (value.kind === 'present') return value.label ? steps : 0;
  if (value.kind === 'bool') return value.on ? steps : 0;
  return 0;
}

// R17 — fleet-state exchange: one poll covers every dispatch key on the wall.
const FLEET_STATE_HUE: Record<string, string> = {
  spawning: NEON.violet, running: NEON.violet, awaiting_input: NEON.amber,
  idle: NEON.teal, stale: 'rgba(148,163,184,.6)', hibernated: 'rgba(148,163,184,.45)',
};

export interface FleetLink { id: string; state: FleetSessionState }

function useFleetDispatchStates(): Map<string, FleetLink> {
  const [map, setMap] = useState<Map<string, FleetLink>>(new Map());
  useEffect(() => {
    let alive = true;
    const poll = () => {
      listSessions()
        .then((snap) => {
          if (!alive) return;
          const m = new Map<string, FleetLink>();
          for (const sess of snap.sessions) {
            if (sess.name && sess.name.startsWith('cockpit:') && sess.state !== 'exited') {
              m.set(sess.name, { id: sess.id, state: sess.state });
            }
          }
          setMap(m);
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return map;
}

// The two-step pair->verify catalog (mock; null = no catalog connectors yet).
const CATALOG: Record<string, string[] | null> = {
  persistence: ['PostgreSQL', 'MongoDB', 'SQLite'],
  hosting: ['Vercel', 'Fly.io', 'Railway'],
  auth: null,
  memory: null,
  errors: ['Sentry', 'Better Stack'],
  logs: ['Better Stack', 'Axiom'],
  metrics: ['Prometheus', 'Grafana Cloud'],
  tracing: ['Langfuse', 'OpenTelemetry'],
  llmtracking: ['LightTrack', 'Langfuse', 'Helicone'],
};

/** One short sentence: current state + what the next step achieves. */
function stateSummary(st: ImproveState, ladder: string[] | undefined, reached: number): string {
  const v = st.value;
  const cur =
    ladder ? ladder[reached]
    : v.kind === 'bool' ? (v.on ? 'yes' : 'no')
    : v.kind === 'present' ? (v.label ?? 'not wired')
    : v.kind === 'chips' ? (v.items.length ? v.items.join(', ') : 'none')
    : '';
  const next = ladder && reached < ladder.length - 1 ? ladder[reached + 1] : null;
  const SPECIFIC: Record<string, string> = {
    aiflow: v.kind === 'bool' && v.on
      ? 'Agents already commit here — the scan found AI-authored changes; codifying an agent lane in CI is the next step.'
      : 'No AI in the workflow yet — a dispatch adds the agent lane (CLAUDE.md conventions + a CI hook).',
    memory: 'Persistent agent memory lets follow-up sessions reuse decisions instead of rediscovering them.',
    selfverify: 'Each locally-runnable gate (build/test/lint/types) shortens the agent loop before a push.',
    instructions: 'Agent instructions anchor every dispatch — richer files mean fewer wrong turns.',
    skills: 'Reusable skills let dispatches standardize recurring work instead of improvising it.',
  };
  if (SPECIFIC[st.rowKey]) return SPECIFIC[st.rowKey]!;
  if (next) return `Currently at “${cur}” — the selected steps move it toward “${next}”.`;
  return `Currently at “${cur}” — the top of this ladder.`;
}

type PairState = { connector: string; status: 'unverified' | 'verifying' };

/** R17 — the setup popover: state summary, scope sidebar (locked implemented
 *  steps), custom dispatch instructions, two-step pair->verify for connector
 *  rows, and the live fleet link when a terminal already owns the task. */
function SetupPopover({ st, pair, onPair, fleet, onClose }: {
  st: ImproveState;
  pair: PairState | null;
  onPair: (p: PairState) => void;
  fleet: FleetLink | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = dispatchKey(st.projectId, st.rowKey);
  const ladder = st.meta.ladder;
  const isConnector = st.meta.improve === 'connector';
  const reached = ladder ? reachedStep(st.value, ladder) : 0;
  const wired = isConnector && st.value.kind === 'present' && Boolean(st.value.label);

  const [scope, setScope] = useState<Set<number>>(() => new Set(ladder && reached < ladder.length - 1 ? [reached + 1] : []));
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);

  const W = 360; // R17: +20% over the previous 300px
  const estH = 200 + (ladder ? ladder.length * 26 : 40);
  const { left, top } = anchorTip(st.rect, W, estH);

  const dispatch = useCallback((prompt: string) => {
    setBusy(true);
    dispatchToFleet(key, prompt)
      .then(() => {
        setBusy(false);
        if (isConnector) {
          onPair({ connector: pair?.connector ?? (st.value.kind === 'present' ? st.value.label ?? 'connector' : 'connector'), status: 'verifying' });
        }
      })
      .catch((e) => { setBusy(false); toastCatch('wall dispatch')(e); });
  }, [key, isConnector, onPair, pair, st.value]);

  const scopeList = ladder ? [...scope].sort((a, b) => a - b).map((i) => ladder[i]).join(', ') : '';
  const basePrompt = `[Personas Cockpit dispatch — prototype] Project “${st.projectName}” (mock). Task: raise “${st.rowLabel}”.` +
    (scopeList ? ` Scope (user-selected steps): ${scopeList}.` : '') +
    (instruction.trim() ? ` Additional instructions: ${instruction.trim()}.` : '') +
    ' Do NOT run commands or modify files; reply with a plan and wait.';
  const verifyPrompt = `[Personas Cockpit dispatch — prototype] Project “${st.projectName}” (mock). Verify the “${pair?.connector ?? ''}” connector for “${st.rowLabel}”: confirm it is wired (or wire it) and report evidence.` +
    (instruction.trim() ? ` Additional instructions: ${instruction.trim()}.` : '') +
    ' Do NOT run commands or modify files; reply with a plan and wait.';

  const fleetHue = fleet ? (FLEET_STATE_HUE[fleet.state] ?? NEON.violet) : null;

  return createPortal(
    <div
      ref={ref}
      data-testid="wall-setup-popover"
      className="fixed z-50 rounded-xl overflow-hidden"
      style={{
        left, top, width: W,
        background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
        border: '1px solid rgba(148,163,184,.25)',
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
    >
      <div className="px-4 pt-3 pb-1.5 flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">{st.projectName}</div>
          <div className="typo-body font-semibold text-foreground mt-0.5">{st.rowLabel}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/45 hover:text-foreground hover:bg-foreground/[0.06] transition-colors focus-ring">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="px-4 pb-2 typo-caption text-foreground/60" data-testid="setup-summary">
        {isConnector && wired
          ? `“${st.value.kind === 'present' ? st.value.label : ''}” is wired — dispatch only to re-verify.`
          : stateSummary(st, ladder, reached)}
      </p>

      {isConnector ? (
        <div className="px-4 pb-3" data-testid="setup-two-step">
          {wired || pair ? (
            <div className="flex items-center gap-1.5 mb-2">
              <BadgeCheck className="w-3.5 h-3.5" style={{ color: pair?.status === 'verifying' ? NEON.violet : wired ? NEON.emerald : NEON.amber }} aria-hidden />
              <span className="typo-caption font-medium" style={{ color: pair?.status === 'verifying' ? NEON.violet : wired ? NEON.emerald : NEON.amber }}>
                {wired ? 'wired' : pair?.status === 'verifying' ? `verifying — ${pair?.connector}` : `unverified — ${pair?.connector}`}
              </span>
            </div>
          ) : CATALOG[st.rowKey] ? (
            <div className="mb-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 block mb-1.5">1 · Pair a connector from the catalog</span>
              <span className="flex flex-wrap gap-1.5">
                {(CATALOG[st.rowKey] ?? []).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onPair({ connector: c, status: 'unverified' })}
                    className="inline-flex items-center gap-1 rounded-card px-2 py-0.5 typo-caption transition-colors hover:bg-foreground/[0.06] focus-ring"
                    style={{ color: NEON.teal, border: `1px solid ${NEON.teal}44` }}
                    data-testid={`pair-${c}`}
                  >
                    <PlugZap className="w-3 h-3" aria-hidden />{c}
                  </button>
                ))}
              </span>
            </div>
          ) : (
            <p className="typo-caption mb-2" style={{ color: SETUP_BLUE }}>No catalog connectors for this slot yet — coming later.</p>
          )}

          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="Additional instructions for the dispatch…"
            className="w-full bg-transparent border rounded-input px-2 py-1 typo-caption text-foreground focus-ring resize-none mb-2"
            style={{ borderColor: 'rgba(148,163,184,.25)' }}
            data-testid="setup-instruction"
          />

          {fleet ? (
            <FleetRow fleet={fleet} hue={fleetHue!} onClose={onClose} />
          ) : (
            <button
              type="button"
              disabled={busy || (!wired && !pair)}
              onClick={() => dispatch(verifyPrompt)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-card px-3 py-2 typo-caption font-semibold transition-colors focus-ring hover:bg-foreground/[0.05] disabled:opacity-40"
              style={{ color: NEON.teal, border: `1px solid ${NEON.teal}55` }}
              data-testid="setup-verify-dispatch"
            >
              2 · {busy ? 'Dispatching…' : wired ? 'Dispatch to re-verify' : 'Dispatch to wire & verify'}
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <div className="flex px-4 pb-3 gap-3">
          {ladder && (
            <div className="w-[132px] shrink-0 border-r border-foreground/[0.08] pr-2.5" data-testid="setup-scope">
              <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 block mb-1.5">Scope</span>
              <ol className="space-y-1">
                {ladder.map((name, i) => {
                  const locked = i <= reached;
                  const on = scope.has(i);
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => setScope((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                        className="flex items-center gap-1.5 w-full text-left disabled:cursor-default focus-ring rounded-interactive"
                        title={locked ? 'Already implemented — locked' : on ? 'In scope — click to exclude' : 'Click to include in the dispatch scope'}
                        data-testid={`scope-${i}`}
                      >
                        {locked
                          ? <Lock className="w-2.5 h-2.5 shrink-0 text-foreground/30" aria-hidden />
                          : <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={on ? { background: NEON.teal } : { border: '1px solid rgba(148,163,184,.45)' }} />}
                        <span className={`text-[10.5px] truncate ${locked ? 'text-foreground/35' : on ? 'text-foreground/90 font-medium' : 'text-foreground/55'}`}>{name}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="Additional instructions for the dispatch…"
              className="w-full bg-transparent border rounded-input px-2 py-1 typo-caption text-foreground focus-ring resize-none mb-2"
              style={{ borderColor: 'rgba(148,163,184,.25)' }}
              data-testid="setup-instruction"
            />
            {fleet ? (
              <FleetRow fleet={fleet} hue={fleetHue!} onClose={onClose} />
            ) : (
              <button
                type="button"
                disabled={busy || (ladder != null && scope.size === 0)}
                onClick={() => dispatch(basePrompt)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-card px-3 py-2 typo-caption font-semibold transition-colors focus-ring hover:bg-foreground/[0.05] disabled:opacity-40"
                style={{ color: NEON.teal, border: `1px solid ${NEON.teal}55` }}
                data-testid="setup-dispatch"
              >
                {busy ? 'Dispatching…' : st.meta.improve ? IMPROVE_ACTION_LABEL[st.meta.improve] : 'Queue'}
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function FleetRow({ fleet, hue, onClose }: { fleet: FleetLink; hue: string; onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={() => { onClose(); useSystemStore.getState().setDevToolsTab('fleet'); }}
      className="w-full inline-flex items-center justify-center gap-1.5 rounded-card px-3 py-2 typo-caption font-semibold transition-colors focus-ring hover:bg-foreground/[0.05]"
      style={{ color: hue, border: `1px solid ${hue}55` }}
      data-testid="setup-fleet-link"
    >
      <TerminalSquare className={`w-3.5 h-3.5 ${fleet.state === 'running' || fleet.state === 'spawning' ? 'animate-pulse' : ''}`} aria-hidden />
      In Fleet — {String(fleet.state).replace('_', ' ')}
      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
    </button>
  );
}

// -- covers (R16: the compact header-card variants replace the axis-bar cover;
//    the metadata the bars carried lives in the Compare rows below) ---------------

function CoverBody({ entry, onOpen }: { entry: WallEntry; onOpen: (id: string) => void }) {
  return <HeaderStatband entry={entry} onOpen={onOpen} />;
}

// -- the wall ------------------------------------------------------------------------

export default function WallCompare({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<WallView>('table');
  const [sort, setSort] = useState<WallSort>('name');
  const [improve, setImprove] = useState<ImproveState | null>(null);
  const [pairs, setPairs] = useState<Record<string, PairState>>({});
  const fleetMap = useFleetDispatchStates();
  const entries = useMemo(() => sortWall(WALL, sort), [sort]);
  const cols = { gridTemplateColumns: `170px repeat(${entries.length}, minmax(250px, 1fr))` };
  const rail = 'sticky left-0 z-10 bg-background';
  const coverMotion = (id: string) =>
    reduce ? {} : { layoutId: `wall-cover-${id}`, layout: true as const, transition: { duration: 0.35, ease: [0.32, 0.72, 0.24, 1] as const } };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-8" data-testid="wall-compare">
      <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
        <InkTabs tabs={VIEW_TABS} active={view} onChange={setView} label="View" />
        <InkTabs tabs={SORT_TABS} active={sort} onChange={setSort} label="Sort" />
      </div>

      <LayoutGroup>
        {view === 'grid' ? (
          // -- OVERVIEW: 3-column cover grid — majority of projects on first sight --
          <div className="grid grid-cols-3 gap-3" data-testid="wall-grid">
            {entries.map((e) => {
              const worst = worstHue(e);
              const blockers = [...e.passport.productionReadiness.blockers, ...e.passport.automationReadiness.blockers];
              return (
                <motion.div
                  key={e.project.id}
                  {...coverMotion(e.project.id)}
                  data-testid={`wall-tile-${e.project.id}`}
                  className="rounded-xl p-4 min-w-0"
                  style={{
                    border: '1px solid rgba(148,163,184,.14)',
                    borderTop: `2px solid ${worst}55`,
                    background: 'rgba(148,163,184,.025)',
                  }}
                >
                  <CoverBody entry={e} onOpen={onOpenProject} />
                  <div className="mt-3 pt-2.5 border-t border-dashed border-foreground/10">
                    {blockers.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 typo-caption" style={{ color: NEON.emerald }}>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Ready — no blockers
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 typo-caption" style={{ color: NEON.red }} title={blockers.join(' · ')}>
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                        {blockers.length} blocker{blockers.length > 1 ? 's' : ''}
                        <span className="text-foreground/45 truncate font-normal">— {blockers[0]}</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          // -- COMPARE: the full row-aligned dimension table --
          <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(148,163,184,.14)', background: 'rgba(148,163,184,.025)' }}>
            <div className="grid min-w-fit" style={cols}>
              <div className={`${rail} border-b border-foreground/10`} />
              {entries.map((e) => (
                <motion.div
                  key={e.project.id}
                  {...coverMotion(e.project.id)}
                  className="px-4 py-3.5 border-b border-foreground/10 min-w-0"
                  style={{ borderTop: `2px solid ${worstHue(e)}55` }}
                >
                  <CoverBody entry={e} onOpen={onOpenProject} />
                </motion.div>
              ))}

              {/* body fades in under the morphing covers; its inner grid repeats
                  the SAME column template as the outer, so rails align. */}
              <motion.div
                style={{ gridColumn: '1 / -1' }}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: reduce ? 0 : 0.12 }}
              >
                <div className="grid" style={cols}>
                  {bodySections.map((section) => (
                    <Fragment key={section.key}>
                      <div className="col-span-full px-4 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-foreground/50 bg-foreground/[0.03] border-b border-foreground/[0.06]">
                        {section.label}
                      </div>
                      {section.rows.map((row) => {
                        const meta = ROW_META[row.key];
                        return (
                          <Fragment key={row.key}>
                            <div className={`${rail} px-4 py-2.5 border-b border-foreground/[0.05]`}>
                              <span className="typo-caption text-foreground/65">{row.label}</span>
                            </div>
                            {entries.map((e) => {
                              const value = row.get(e.passport);
                              const kind = inkKindOf(value);
                              const recede = kind === 'good' || kind === 'info';
                              const cell = <InkCellValue value={value} ladder={meta?.ladder} />;
                              return (
                                <div key={e.project.id} className={`border-b border-foreground/[0.05] min-w-0 ${recede ? 'opacity-45' : ''}`}>
                                  {meta?.improve ? (
                                    <button
                                      type="button"
                                      data-testid={`improve-${row.key}-${e.project.id}`}
                                      onClick={(ev) =>
                                        setImprove({
                                          projectId: e.project.id,
                                          projectName: e.project.name,
                                          rowKey: row.key,
                                          rowLabel: row.label,
                                          value,
                                          meta,
                                          rect: ev.currentTarget.getBoundingClientRect(),
                                        })
                                      }
                                      className="group/imp w-full text-left px-4 py-2.5 relative transition-colors hover:bg-foreground/[0.04] focus-ring"
                                      title={`${IMPROVE_ACTION_LABEL[meta.improve]} — ${row.label}`}
                                    >
                                      {cell}
                                      {(() => {
                                        const fl = fleetMap.get(dispatchKey(e.project.id, row.key));
                                        if (fl) {
                                          return (
                                            <span
                                              role="link"
                                              tabIndex={0}
                                              onClick={(ev) => { ev.stopPropagation(); useSystemStore.getState().setDevToolsTab('fleet'); }}
                                              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); useSystemStore.getState().setDevToolsTab('fleet'); } }}
                                              title={`In Fleet — ${String(fl.state).replace('_', ' ')} (click to open)`}
                                              className="absolute top-2 right-2.5 cursor-pointer"
                                              data-testid={`fleet-cell-${row.key}-${e.project.id}`}
                                            >
                                              <TerminalSquare
                                                className={`w-3.5 h-3.5 ${fl.state === 'running' || fl.state === 'spawning' ? 'animate-pulse' : ''}`}
                                                style={{ color: FLEET_STATE_HUE[String(fl.state)] ?? NEON.violet }}
                                                aria-hidden
                                              />
                                            </span>
                                          );
                                        }
                                        return (
                                          <Settings2
                                            className="w-3.5 h-3.5 absolute top-2 right-2.5 opacity-[0.10] group-hover/imp:opacity-100 transition-opacity"
                                            style={{ color: NEON.teal }}
                                            aria-hidden
                                          />
                                        );
                                      })()}
                                    </button>
                                  ) : (
                                    <div className="px-4 py-2.5">{cell}</div>
                                  )}
                                </div>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}

                  <div className={`${rail} px-4 py-2.5 border-t border-dashed border-foreground/15`}>
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em]" style={{ color: NEON.red }}>
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> Not ready
                    </span>
                  </div>
                  {entries.map((e) => {
                    const blockers = [...e.passport.productionReadiness.blockers, ...e.passport.automationReadiness.blockers];
                    return (
                      <div key={e.project.id} className="px-4 py-2.5 border-t border-dashed border-foreground/15">
                        {blockers.length === 0 ? (
                          <span className="inline-flex items-center gap-1.5 typo-caption" style={{ color: NEON.emerald }}>
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Ready — no blockers
                          </span>
                        ) : (
                          <ul className="space-y-1">
                            {blockers.map((b, i) => (
                              <li key={i} className="flex gap-1.5 typo-caption text-foreground/80">
                                <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: NEON.red }} aria-hidden />
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </LayoutGroup>

      {improve && (
        <SetupPopover
          st={improve}
          pair={pairs[dispatchKey(improve.projectId, improve.rowKey)] ?? null}
          onPair={(p) => setPairs((prev) => ({ ...prev, [dispatchKey(improve.projectId, improve.rowKey)]: p }))}
          fleet={fleetMap.get(dispatchKey(improve.projectId, improve.rowKey)) ?? null}
          onClose={() => setImprove(null)}
        />
      )}
    </div>
  );
}
