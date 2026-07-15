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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Settings2, TerminalSquare, X } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';
import {
  ARCHETYPE_LABEL, AUTOMATION_LABEL, AUTOMATION_SCALE, CRITICALITY_LABEL,
  LIFECYCLE_LABEL, PROD_BAND_LABEL, PROD_BAND_SCALE,
} from '@/features/teams/sub_factory/passport/passportModel';
import { SECTIONS, type CellValue } from '@/features/teams/sub_factory/passport/passportRows';

import { InkCellValue, InkTabs, NEON, SETUP_BLUE, SegBar, anchorTip, inkKindOf, scoreInk } from './cockpitGlyphs';
import { buildDispatchPrompt, dispatchKey, dispatchToFleet, findRunningDispatch } from './wallDispatch';
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

type DispatchPhase = 'checking' | 'idle' | 'dispatching' | 'running';

function ImprovePopover({ st, onClose }: { st: ImproveState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<DispatchPhase>('checking');
  const key = dispatchKey(st.projectId, st.rowKey);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);

  // Dedup gate: is a terminal already working this exact task?
  useEffect(() => {
    let alive = true;
    findRunningDispatch(key)
      .then((s) => { if (alive) setPhase(s ? 'running' : 'idle'); })
      .catch(() => { if (alive) setPhase('idle'); });
    return () => { alive = false; };
  }, [key]);

  const ladder = st.meta.ladder;
  const reached = ladder ? reachedStep(st.value, ladder) : 0;
  const estH = 92 + (ladder ? ladder.length * 28 : 34) + 96;
  const { left, top } = anchorTip(st.rect, 300, estH);
  const action = st.meta.improve ? IMPROVE_ACTION_LABEL[st.meta.improve] : null;

  const dispatch = () => {
    if (!st.meta.improve) return;
    setPhase('dispatching');
    const prompt = buildDispatchPrompt({
      kind: st.meta.improve,
      projectName: st.projectName,
      rowLabel: st.rowLabel,
      current: ladder?.[reached],
      next: ladder?.[Math.min(reached + 1, ladder.length - 1)],
    });
    dispatchToFleet(key, prompt)
      .then(() => setPhase('running'))
      .catch((e) => {
        setPhase('idle');
        toastCatch('cockpit fleet dispatch')(e);
      });
  };

  const viewInFleet = () => {
    onClose();
    useSystemStore.getState().setDevToolsTab('fleet');
  };

  return createPortal(
    <div
      ref={ref}
      data-testid="wall-improve-popover"
      className="fixed z-50 w-[300px] rounded-xl overflow-hidden"
      style={{
        left, top,
        background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
        border: '1px solid rgba(148,163,184,.25)',
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
    >
      <div className="px-4 pt-3 pb-2 flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">{st.projectName}</div>
          <div className="typo-body font-semibold text-foreground mt-0.5">{st.rowLabel}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/45 hover:text-foreground hover:bg-foreground/[0.06] transition-colors focus-ring"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {ladder ? (
        <div className="px-4 pb-3">
          <SegBar steps={ladder.length - 1} reached={reached} hue={reached === 0 ? SETUP_BLUE : scoreInk((reached / (ladder.length - 1)) * 100)} />
          <ol className="mt-2.5 space-y-1">
            {ladder.map((name, i) => {
              const isCurrent = i === reached;
              const isNext = i === reached + 1;
              return (
                <li key={name} className="flex items-center gap-2.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={
                      i <= reached
                        ? { background: isCurrent ? NEON.teal : 'rgba(148,163,184,.55)', boxShadow: isCurrent ? `0 0 5px ${NEON.teal}88` : undefined }
                        : { border: `1px solid ${isNext ? SETUP_BLUE : 'rgba(148,163,184,.35)'}` }
                    }
                  />
                  <span className={`typo-caption ${isCurrent ? 'font-semibold text-foreground' : i < reached ? 'text-foreground/60' : 'text-foreground/45'}`} style={isNext ? { color: SETUP_BLUE } : undefined}>
                    {name}
                  </span>
                  {isCurrent && <span className="text-[10px] uppercase tracking-[0.1em] text-foreground/40 ml-auto">current</span>}
                  {isNext && <span className="text-[10px] uppercase tracking-[0.1em] ml-auto" style={{ color: SETUP_BLUE }}>next</span>}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <div className="px-4 pb-3"><InkCellValue value={st.value} /></div>
      )}

      {action && (
        <div className="px-4 pb-3.5 pt-2.5 border-t border-foreground/[0.08]" data-testid="dispatch-zone" data-phase={phase}>
          {phase === 'running' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: NEON.violet, boxShadow: `0 0 6px ${NEON.violet}` }} />
                <span className="typo-caption font-medium" style={{ color: NEON.violet }}>Running in Fleet</span>
              </div>
              <button
                type="button"
                data-testid="view-in-fleet"
                onClick={viewInFleet}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-card px-3 py-2 typo-caption font-semibold transition-colors focus-ring hover:bg-foreground/[0.05]"
                style={{ color: NEON.violet, border: `1px solid ${NEON.violet}55` }}
              >
                <TerminalSquare className="w-3.5 h-3.5" aria-hidden />
                View in Fleet
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
              </button>
              <p className="text-[10px] text-foreground/35 text-center mt-1.5">one terminal per task — kill it in Fleet to dispatch again</p>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="dispatch-action"
                disabled={phase !== 'idle'}
                onClick={dispatch}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-card px-3 py-2 typo-caption font-semibold transition-colors focus-ring hover:bg-foreground/[0.05] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: NEON.teal, border: `1px solid ${NEON.teal}55` }}
              >
                {phase === 'dispatching' ? 'Dispatching…' : phase === 'checking' ? 'Checking Fleet…' : action}
                {phase === 'idle' && <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />}
              </button>
              <p className="text-[10px] text-foreground/35 text-center mt-1.5">opens a Fleet terminal seeded with the task prompt</p>
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

// -- covers (shared by both views; motion layoutId makes them morph) --------------

function CoverBody({ entry, onOpen, identity }: { entry: WallEntry; onOpen: (id: string) => void; identity?: boolean }) {
  const { project, passport } = entry;
  const health = wallHealth(project);
  const worst = worstHue(entry);
  const axis = (label: string, sub: string, score: number, reached: number, steps: number) => {
    const hue = scoreInk(score);
    return (
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/45">{label}</span>
          <span className="typo-caption font-semibold" style={{ color: hue }}>{sub}</span>
          <span className="text-[11px] tabular-nums text-foreground/45 ml-auto">{score}</span>
        </div>
        <div className="mt-1.5"><SegBar steps={steps} reached={reached} hue={hue} /></div>
      </div>
    );
  };
  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(project.id)}
        title={`Open the ${project.name} cockpit`}
        className="group/door inline-flex items-center gap-2 min-w-0 max-w-full text-left focus-ring rounded-interactive"
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: worst, boxShadow: `0 0 6px ${worst}88` }} />
        <span className="typo-heading-lg tracking-tight text-foreground group-hover/door:text-primary transition-colors truncate">
          {project.name}
        </span>
        <ArrowUpRight className="w-4 h-4 shrink-0 text-primary/70 opacity-0 group-hover/door:opacity-100 transition-opacity" aria-hidden />
      </button>
      {identity && (
        <div className="typo-label text-foreground/40 mt-0.5">
          {ARCHETYPE_LABEL[passport.identity.archetype]} · {LIFECYCLE_LABEL[passport.identity.lifecycle]} · {CRITICALITY_LABEL[passport.identity.criticality]}
        </div>
      )}
      <div className="text-[11.5px] tabular-nums mt-1 flex items-center gap-2.5">
        {health.total === 0 ? (
          <span style={{ color: SETUP_BLUE }}>no contexts scanned →</span>
        ) : (
          <>
            {health.crit > 0 && <span style={{ color: NEON.red }}>{health.crit} critical</span>}
            {health.warn > 0 && <span style={{ color: NEON.amber }}>{health.warn} warning</span>}
            <span className="text-foreground/40">{health.total} contexts</span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2.5 mt-3">
        {axis(
          'Automation',
          `${passport.automationReadiness.level} · ${AUTOMATION_LABEL[passport.automationReadiness.level]}`,
          passport.automationReadiness.score,
          AUTOMATION_SCALE.indexOf(passport.automationReadiness.level) + 1,
          AUTOMATION_SCALE.length,
        )}
        {axis(
          'Production',
          PROD_BAND_LABEL[passport.productionReadiness.band],
          passport.productionReadiness.score,
          PROD_BAND_SCALE.indexOf(passport.productionReadiness.band) + 1,
          PROD_BAND_SCALE.length,
        )}
      </div>
    </>
  );
}

// -- the wall ------------------------------------------------------------------------

export default function WallCompare({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<WallView>('table');
  const [sort, setSort] = useState<WallSort>('name');
  const [improve, setImprove] = useState<ImproveState | null>(null);
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
                  <CoverBody entry={e} onOpen={onOpenProject} identity />
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
                                      <Settings2
                                        className="w-3.5 h-3.5 absolute top-2 right-2.5 opacity-0 group-hover/imp:opacity-100 transition-opacity"
                                        style={{ color: NEON.teal }}
                                        aria-hidden
                                      />
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

      {improve && <ImprovePopover st={improve} onClose={() => setImprove(null)} />}
    </div>
  );
}
