// The project-readiness wall — TWO VIEWS of the same passports (design adopted
// from the Dev Tools cockpit prototype R7–R9, docs/plans/dev-tools-cx-redesign.md):
//
//   • Overview (DEFAULT) — the first layer: a 3-column grid of passport COVERS
//     (identity, warning badge, the two readiness axes as segmented level bars,
//     golden gauge, trend, blockers digest). Majority of projects on first
//     sight; the title click keeps the existing open-project quick function.
//   • Compare — the row-aligned dimension matrix: sticky label rail, one column
//     per project, every passport dimension in Focus ink (segmented level bars
//     for ordinals, brand icons with visible names for stack/tooling, healthy
//     rows RECEDING so deficiencies stand, blue "set up →" for absent wiring),
//     the "Why it's not ready" blockers band, and the improve machinery
//     (ImproveCell popovers, LlmTrackingCell live wiring) unchanged.
//
// Covers carry framer-motion layoutIds, so switching views RECOMPOSES the wall:
// each cover morphs between its grid tile and its table column.
import { Fragment, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Activity, AlertTriangle, ArrowUpRight, Boxes, CheckCircle2, ChevronLeft, ChevronRight, Database, FileDown, KeyRound, Server, Settings2, TerminalSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { passportToMarkdown } from './passportExport';
import { SECTIONS, type CellValue } from './passportRows';
import {
  sortByNameAsc,
  AUTOMATION_LABEL, PROD_BAND_LABEL, ENV_LABEL, APP_COST_FILENAME,
  type AppPassport,
} from './passportModel';
import { formatCost } from '@/lib/utils/formatters';
import { INK, InkTabs, SegBar, TechInk, inkKindOf, scoreInk } from './passportInk';
import { trendDelta } from './passportHistory';
import { resolveTechIcon } from './techIcons';
import { Pips, BoolMark, SectionIcon, RowInfoLabel } from './passportWidgets';
import { ImproveCell } from './improve/ImproveCell';
import { StandardsScan } from './improve/StandardsScan';
import { LlmTrackingCell } from './LlmTrackingCell';
import { WarningBadge, type WarningItem } from './WarningBadge';
import { PASSPORT_FLEET_INK, PassportTerminalModal, passportDispatchKey, usePassportFleetSessions } from './passportFleet';
import { RowSetupModal } from './RowSetupModal';

// Improvable cells. Tier-0 standards-config rows (CI / Self-verify) + every
// code-requiring or connector-bindable row: context/CLAUDE.md/tests/evals/
// security/migrations/observability (Claude deploy or scan), the monitoring
// tooling rows (errors/logs/metrics/tracing → connector wire), hosting (deploy),
// the env-split monitoring row (connector wire), app cost (agent-created cost
// file), aiflow + skills. Each opens the cell popover with its ladder + actions.
const IMPROVABLE_ROWS = new Set([
  'ci', 'selfverify', 'context', 'instructions', 'docs', 'memory',
  'observability', 'aiflow', 'skills',
  'errors', 'logs', 'metrics', 'tracing', 'hosting', 'llmtracking',
  'monitoring', 'appcost',
]);

// R19 — the UNIFIED setup rows: always-available setup icon (any level, not
// just red), full setup modal with three directions, Fleet as the LLM engine,
// state-tinted terminal icon + terminal modal while a run is live.
const UNIFIED_ROWS = new Set(['evals', 'security', 'tests', 'migrations']);

const COPY = {
  blockersTitle: 'Why it’s not ready',
  clear: 'Ready — no blockers',
  compare: 'Passport',
  scrollHint: 'scroll to compare →',
  automation: 'Automation',
  production: 'Production',
  sort: 'Sort',
  view: 'View',
  viewOverview: 'Overview',
  viewCompare: 'Compare',
  setUp: 'set up →',
  add: 'add →',
};

const MAX_CHIPS = 5;

type WallSort = 'name' | 'automation' | 'production' | 'gap';
const SORT_TABS: Array<{ id: WallSort; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'automation', label: 'Automation' },
  { id: 'production', label: 'Production' },
  { id: 'gap', label: 'Readiness gap' },
];

type WallView = 'overview' | 'compare';
const VIEW_TABS: Array<{ id: WallView; label: string }> = [
  { id: 'overview', label: COPY.viewOverview },
  { id: 'compare', label: COPY.viewCompare },
];

export function ProjectsPassportWall({
  passports,
  openSlugs,
  onOpen,
  attentionByProject,
  onJumpKpi,
  headerStats,
  faviconBySlug,
}: {
  passports: AppPassport[];
  openSlugs?: Set<string>;
  onOpen?: (slug: string) => void;
  /** Off-track KPIs per project id — surfaced as a warning badge on the cover. */
  attentionByProject?: Map<string, WarningItem[]>;
  /** Deep-link from a warning into that KPI's console. */
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
  /** R18 — per-slug header stats (contexts count, KPI pass rate) computed by
   *  the host; the cover renders 0/dim placeholders when absent. */
  headerStats?: Map<string, { contexts: number; kpiPassed: number; kpiTotal: number }>;
  /** R21 — per-slug favicon data URLs; covers fall back to the status dot. */
  faviconBySlug?: Map<string, string>;
}) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<WallView>('overview');
  const [sort, setSort] = useState<WallSort>('name');
  // R19 — unified-row machinery: live fleet sessions per dispatch key + modals.
  const fleetSessions = usePassportFleetSessions();
  const [setupModal, setSetupModal] = useState<{ rowKey: string; rowLabel: string; passport: AppPassport; currentLabel: string } | null>(null);
  const [terminalKey, setTerminalKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Horizontal scroll from the header so the user never hunts for the bottom
  // scrollbar — nudge by ~80% of the visible width (≈ 3–4 columns).
  const nudge = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const columns = useMemo(() => {
    const base = [...passports];
    switch (sort) {
      case 'automation': // weakest automation first — surfaces the agents-can't-help-here projects
        return base.sort((a, b) => a.automationReadiness.score - b.automationReadiness.score);
      case 'production':
        return base.sort((a, b) => a.productionReadiness.score - b.productionReadiness.score);
      case 'gap': // biggest axis divergence first — the passport's headline view
        return base.sort(
          (a, b) =>
            Math.abs(b.automationReadiness.score - b.productionReadiness.score) -
            Math.abs(a.automationReadiness.score - a.productionReadiness.score),
        );
      default:
        return sortByNameAsc(base);
    }
  }, [passports, sort]);

  // The cover already carries the two headline seals — don't repeat them as rows.
  const bodySections = SECTIONS.map((s) => ({ ...s, rows: s.rows.filter((r) => !r.headline) }));

  const rail = 'sticky left-0 z-20 bg-background';
  const colChrome = 'border-l border-primary/[0.08]';
  const coverMotion = (slug: string) =>
    reduce ? {} : { layoutId: `passport-cover-${slug}`, layout: true as const, transition: { duration: 0.35, ease: [0.32, 0.72, 0.24, 1] as const } };

  const coverProps = (p: AppPassport) => ({
    p,
    openable: Boolean(openSlugs?.has(p.identity.slug) && onOpen),
    onOpen,
    attention: attentionByProject?.get(p.identity.slug) ?? [],
    onJumpKpi,
    stats: headerStats?.get(p.identity.slug) ?? null,
    favicon: faviconBySlug?.get(p.identity.slug) ?? null,
  });

  return (
    <div>
      {/* toolbar — view toggle + (compare-only) scroll arrows + column sort */}
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="inline-flex items-center gap-4">
          <InkTabs tabs={VIEW_TABS} active={view} onChange={setView} label={COPY.view} />
          {view === 'compare' && (
            <div className="inline-flex items-center gap-1.5">
              <button type="button" onClick={() => nudge(-1)} aria-label="Scroll columns left" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => nudge(1)} aria-label="Scroll columns right" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="typo-caption text-foreground/45 ml-1">{COPY.scrollHint}</span>
            </div>
          )}
        </div>
        <InkTabs tabs={SORT_TABS} active={sort} onChange={setSort} label={COPY.sort} />
      </div>

      <LayoutGroup>
        {view === 'overview' ? (
          // ── OVERVIEW — the first layer: covers as a grid, blockers digest per tile
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3" data-testid="passport-overview-grid">
            {columns.map((p) => {
              const blockers = [...p.productionReadiness.blockers, ...p.automationReadiness.blockers];
              const hue = scoreInk(Math.min(p.automationReadiness.score, p.productionReadiness.score));
              return (
                <motion.div
                  key={p.identity.slug}
                  {...coverMotion(p.identity.slug)}
                  data-testid={`passport-tile-${p.identity.slug}`}
                  className="rounded-modal p-4 min-w-0 bg-secondary/[0.03] shadow-elevation-1"
                  style={{ border: '1px solid rgba(148,163,184,.14)', borderTop: `2px solid ${hue}55` }}
                >
                  <CoverBody {...coverProps(p)} />
                  <div className="mt-3 pt-2.5 border-t border-dashed border-foreground/10 min-w-0">
                    {blockers.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 typo-caption" style={{ color: INK.emerald }}>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> {COPY.clear}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 typo-caption min-w-0" style={{ color: INK.red }} title={blockers.join(' · ')}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                        <span className="shrink-0 tabular-nums">{blockers.length}</span>
                        <span className="text-foreground/50 truncate font-normal">— {blockers[0]}</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          // ── COMPARE — the dimension matrix
          <div ref={scrollRef} className="overflow-x-auto rounded-modal border border-primary/[0.08] bg-secondary/[0.03] shadow-elevation-1">
            <table className="border-separate border-spacing-0">
              {/* passport covers */}
              <thead>
                <tr>
                  <th className={`${rail} w-[190px] min-w-[190px] px-3 py-3 text-left align-bottom border-b-2 border-primary/15`}>
                    <span className="typo-label text-foreground/50">{COPY.compare}</span>
                  </th>
                  {columns.map((p) => (
                    <motion.th
                      key={p.identity.slug}
                      {...coverMotion(p.identity.slug)}
                      className={`min-w-[236px] w-[236px] px-3 py-3 text-left align-top border-b-2 border-primary/15 ${colChrome}`}
                      style={{ borderTop: `2px solid ${scoreInk(Math.min(p.automationReadiness.score, p.productionReadiness.score))}55` }}
                    >
                      <CoverBody {...coverProps(p)} />
                    </motion.th>
                  ))}
                </tr>
              </thead>

              <motion.tbody
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: reduce ? 0 : 0.12 }}
              >
                {bodySections.map((section) => (
                  <Fragment key={section.key}>
                    <tr>
                      {/* full-width band so the section name spreads across the row instead of wrapping in the narrow rail */}
                      <td colSpan={columns.length + 1} className="border-t border-primary/10 bg-primary/[0.03] p-0">
                        <span className="sticky left-0 z-10 inline-flex items-center gap-1.5 typo-label text-foreground/70 whitespace-nowrap px-3 py-1.5">
                          <SectionIcon name={section.icon} className="w-3.5 h-3.5 text-primary/70" />
                          {section.label}
                        </span>
                      </td>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={row.key} className="hover:bg-primary/[0.02] transition-colors">
                        <td className={`${rail} px-3 py-2 border-t border-primary/[0.06] align-top`}>
                          <RowInfoLabel label={row.label} info={row.info} />
                        </td>
                        {columns.map((p) => {
                          const value = row.get(p);
                          const kind = inkKindOf(value);
                          // Healthy/informational cells recede; deficiencies and
                          // setup invitations keep full ink.
                          const recede = kind === 'good' || kind === 'info';
                          // `llmtracking` renders live wiring (bound connector + 30d
                          // spend) instead of the scan's generic "connected".
                          const cell =
                            row.key === 'llmtracking' ? (
                              <LlmTrackingCell
                                slug={p.identity.slug}
                                label={value.kind === 'present' ? value.label : null}
                              />
                            ) : (
                              <InkWallCell value={value} />
                            );
                          return (
                            <td key={p.identity.slug} className={`px-3 py-2 align-top border-t border-primary/[0.06] ${colChrome} ${recede ? 'opacity-45' : ''}`}>
                              {UNIFIED_ROWS.has(row.key) ? (() => {
                                const dk = passportDispatchKey(row.key, p.identity.slug);
                                const fl = fleetSessions.get(dk);
                                const currentLabel = value.kind === 'ordinal' ? value.label : value.kind === 'present' ? (value.label ?? 'not set') : '';
                                return (
                                  <span className="group/uni relative flex items-start w-full gap-1" data-testid={`unified-${row.key}-${p.identity.slug}`}>
                                    <span className="min-w-0 flex-1">{cell}</span>
                                    {fl ? (
                                      <button
                                        type="button"
                                        onClick={() => setTerminalKey(dk)}
                                        title={`Fleet is working this row — ${String(fl.state).replace('_', ' ')} (click to open the terminal)`}
                                        className="shrink-0 p-0.5 rounded-interactive transition-colors hover:bg-primary/10 focus-ring"
                                        data-testid={`unified-fleet-${row.key}-${p.identity.slug}`}
                                      >
                                        <TerminalSquare
                                          className={`w-3.5 h-3.5 ${fl.state === 'running' || fl.state === 'spawning' ? 'animate-pulse' : ''}`}
                                          style={{ color: PASSPORT_FLEET_INK[String(fl.state)] ?? INK.violet }}
                                          aria-hidden
                                        />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setSetupModal({ rowKey: row.key, rowLabel: row.label, passport: p, currentLabel })}
                                        title={`Set up ${row.label}`}
                                        className="shrink-0 p-0.5 rounded-interactive opacity-[0.10] group-hover/uni:opacity-100 transition-opacity hover:bg-primary/10 focus-ring"
                                        data-testid={`unified-setup-${row.key}-${p.identity.slug}`}
                                      >
                                        <Settings2 className="w-3.5 h-3.5" style={{ color: INK.teal }} aria-hidden />
                                      </button>
                                    )}
                                  </span>
                                );
                              })() : IMPROVABLE_ROWS.has(row.key) ? (
                                <ImproveCell slug={p.identity.slug} rowKey={row.key} passport={p}>{cell}</ImproveCell>
                              ) : (
                                cell
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}

                {/* the deficiency band — the Wall's signature payload */}
                <tr>
                  <td className={`${rail} px-3 py-2 border-t-2 border-dashed border-primary/15 align-top`}>
                    <span className="inline-flex items-center gap-1.5 typo-label text-red-300/80">
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                      {COPY.blockersTitle}
                    </span>
                  </td>
                  {columns.map((p) => {
                    const blockers = [...p.productionReadiness.blockers, ...p.automationReadiness.blockers];
                    return (
                      <td key={p.identity.slug} className={`px-3 py-2 align-top border-t-2 border-dashed border-primary/15 ${colChrome}`}>
                        {blockers.length === 0 ? (
                          <span className="inline-flex items-center gap-1.5 typo-caption text-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> {COPY.clear}
                          </span>
                        ) : (
                          <ul className="space-y-1">
                            {blockers.map((b, i) => (
                              <li key={i} className="flex gap-1.5 typo-caption text-foreground/80">
                                <span className="mt-1.5 w-1 h-1 rounded-full bg-red-400 flex-shrink-0" aria-hidden />
                                <span style={{ fontWeight: 400 }}>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </motion.tbody>
            </table>
          </div>
        )}
      </LayoutGroup>

      {setupModal && (
        <RowSetupModal
          rowKey={setupModal.rowKey}
          rowLabel={setupModal.rowLabel}
          passport={setupModal.passport}
          currentLabel={setupModal.currentLabel}
          onDispatched={() => { /* R20: no auto-open — the cell's fleet icon is the door; it appears via the 5s poll */ }}
          onClose={() => setSetupModal(null)}
        />
      )}
      {terminalKey && (
        <PassportTerminalModal
          sessionId={fleetSessions.get(terminalKey)?.id ?? ''}
          session={fleetSessions.get(terminalKey) ?? null}
          onClose={() => setTerminalKey(null)}
        />
      )}
    </div>
  );
}

/** R18 — the Statband cover (bench R16/R17 winner, real data): identity +
 *  action icons + the 5-slot stack strip on one line, then the labeled
 *  mini-scoreboard band (Auto / Prod / Trend / Ctx / KPI). The axis depth the
 *  old cover carried lives in the Compare rows; production affordances
 *  (warning badge, standards scan, markdown export) stay on the title row.
 *  Exported for reuse as the Mastermind project sidebar's header. */
const BAND_CODE: Record<string, string> = {
  prototype: 'PT', internal: 'IN', beta: 'BE', production: 'PR', hardened: 'HD',
};

interface HeaderStatsShape { contexts: number; kpiPassed: number; kpiTotal: number }

function StackStrip({ p, size = 13 }: { p: AppPassport; size?: number }) {
  const slots: Array<{ key: string; category: string; label: string | null; fallback: LucideIcon }> = [
    { key: 'framework', category: 'Framework', label: p.stack.frameworks[0] ?? null, fallback: Boxes },
    { key: 'persistence', category: 'Persistence', label: p.stack.persistence[0]?.engine ?? null, fallback: Database },
    { key: 'hosting', category: 'Hosting', label: p.stack.hosting ?? null, fallback: Server },
    { key: 'auth', category: 'Auth', label: p.stack.auth ?? null, fallback: KeyRound },
    { key: 'monitoring', category: 'Monitoring', label: p.stack.monitoring.errorTracking, fallback: Activity },
  ];
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="passport-stack-strip">
      {slots.map((slot) => {
        const match = slot.label ? resolveTechIcon(slot.label) : null;
        const Fallback = slot.fallback;
        if (match) {
          return (
            <span key={slot.key} title={`${slot.category}: ${slot.label}`} className="inline-flex shrink-0">
              <svg width={size} height={size} viewBox="0 0 24 24" fill={match.icon.color ?? 'currentColor'} aria-hidden>
                <path d={match.icon.path} />
              </svg>
            </span>
          );
        }
        if (slot.label) {
          return (
            <span key={slot.key} title={`${slot.category}: ${slot.label}`} className="inline-flex shrink-0 text-foreground/75">
              <Fallback style={{ width: size, height: size }} aria-hidden />
            </span>
          );
        }
        return (
          <span key={slot.key} title={`${slot.category} — not wired`} className="inline-flex shrink-0 text-foreground/20" data-testid={`passport-unwired-${slot.key}`}>
            <Fallback style={{ width: size, height: size }} aria-hidden />
          </span>
        );
      })}
    </span>
  );
}

export function CoverBody({
  p, openable, onOpen, attention, onJumpKpi, stats, favicon = null,
}: {
  p: AppPassport;
  openable: boolean;
  onOpen?: (slug: string) => void;
  attention: WarningItem[];
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
  stats: HeaderStatsShape | null;
  /** Real app favicon (data URL); null → the worst-state dot stays. */
  favicon?: string | null;
}) {
  const worst = scoreInk(Math.min(p.automationReadiness.score, p.productionReadiness.score));
  const trend = trendDelta(p.identity.slug)?.golden ?? 0;
  const kpiHue =
    !stats || stats.kpiTotal === 0 ? 'rgba(148,163,184,.35)'
    : stats.kpiPassed === stats.kpiTotal ? INK.emerald
    : stats.kpiPassed / stats.kpiTotal >= 0.5 ? INK.amber : INK.red;

  const cell = (value: React.ReactNode, label: string, title: string) => (
    <span className="flex flex-col items-center gap-0.5 min-w-0" title={title}>
      <span className="text-[11.5px] font-semibold tabular-nums leading-none">{value}</span>
      <span className="text-[8.5px] uppercase tracking-[0.14em] text-foreground/35 leading-none">{label}</span>
    </span>
  );

  return (
    <>
      {/* identity + production affordances + stack strip */}
      <div className="flex items-center gap-1.5 min-w-0">
        {favicon ? (
          <img src={favicon} alt="" className="w-4 h-4 rounded-[3px] shrink-0" data-testid="cover-favicon" aria-hidden />
        ) : (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: worst, boxShadow: `0 0 6px ${worst}88` }} aria-hidden />
        )}
        {openable ? (
          <button type="button" onClick={() => onOpen!(p.identity.slug)} title={p.identity.purpose} className="group/cov inline-flex items-center gap-1 min-w-0 text-left">
            <span className="typo-body font-semibold tracking-tight truncate group-hover/cov:text-primary transition-colors">{p.identity.name}</span>
            <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover/cov:opacity-100 text-primary/70 transition-opacity" aria-hidden />
          </button>
        ) : (
          <span title={p.identity.purpose} className="typo-body font-semibold tracking-tight truncate block">{p.identity.name}</span>
        )}
        <WarningBadge projectName={p.identity.name} items={attention} onJump={(g, k) => onJumpKpi?.(p.identity.slug, g, k)} />
        <StandardsScan slug={p.identity.slug} projectName={p.identity.name} />
        <CopyButton
          text={passportToMarkdown(p, Date.now())}
          icon={<FileDown className="w-3.5 h-3.5" />}
          tooltip="Copy readiness report (markdown)"
          className="flex-shrink-0 p-0.5 text-foreground/45 hover:text-primary"
        />
        <span className="ml-auto shrink-0"><StackStrip p={p} /></span>
      </div>

      {/* the labeled scoreboard band */}
      <div
        className="mt-2.5 flex items-center justify-between rounded-card px-2.5 py-1.5"
        style={{ background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.10)' }}
        data-testid={`passport-statband-${p.identity.slug}`}
      >
        {cell(
          <span style={{ color: scoreInk(p.automationReadiness.score) }}>{p.automationReadiness.level}</span>,
          'Auto',
          `Automation: ${AUTOMATION_LABEL[p.automationReadiness.level]} — ${p.automationReadiness.score}/100`,
        )}
        {cell(
          <span style={{ color: scoreInk(p.productionReadiness.score) }}>{BAND_CODE[p.productionReadiness.band]}</span>,
          'Prod',
          `Production: ${PROD_BAND_LABEL[p.productionReadiness.band]} — ${p.productionReadiness.score}/100`,
        )}
        {cell(
          trend === 0
            ? <span className="text-foreground/30">—</span>
            : <span style={{ color: trend > 0 ? INK.emerald : INK.red }}>{trend > 0 ? '▲' : '▼'}{Math.abs(trend)}</span>,
          'Trend',
          'Golden-standard trend since last recorded change',
        )}
        {cell(
          <span style={{ color: !stats || stats.contexts === 0 ? INK.blue : 'rgba(226,232,240,.9)' }}>{stats?.contexts ?? 0}</span>,
          'Ctx',
          `${stats?.contexts ?? 0} contexts mapped`,
        )}
        {cell(
          <span style={{ color: kpiHue }}>{stats ? `${stats.kpiPassed}/${stats.kpiTotal}` : '0/0'}</span>,
          'KPI',
          `${stats?.kpiPassed ?? 0} of ${stats?.kpiTotal ?? 0} KPIs meeting target`,
        )}
      </div>
    </>
  );
}

/** Cell renderer in Focus ink — segmented level bars for ordinals, brand icons
 *  with visible names for stack/tooling, blue "set up →" for meaningful gaps.
 *  Pips/bool keep the production widgets (their labels already read well).
 *  Exported for reuse in the Mastermind project sidebar. */
export function InkWallCell({ value }: { value: CellValue }) {
  switch (value.kind) {
    case 'level':
    case 'band': {
      // Headline rows are filtered out of the body (covers carry the axes) —
      // render a compact ink line if one ever appears.
      const label = value.kind === 'level' ? `${value.level} · ${AUTOMATION_LABEL[value.level]}` : PROD_BAND_LABEL[value.band];
      const hue = scoreInk(value.score);
      return <span className="typo-caption font-semibold" style={{ color: hue }}>{label} · {value.score}</span>;
    }
    case 'ordinal': {
      const hue = value.pos >= 0.65 ? INK.emerald : value.pos >= 0.35 ? INK.amber : INK.red;
      const steps = value.steps ?? 0;
      const reached = value.reached ?? 0;
      return (
        <span className="block min-w-0 max-w-[210px]">
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className="typo-caption font-medium truncate" style={{ color: hue }}>{value.label}</span>
            {value.sub && <span className="text-[11px] text-foreground/45 truncate">{value.sub}</span>}
            {steps > 0 && <span className="text-[11px] tabular-nums text-foreground/40 shrink-0 ml-auto">{reached}/{steps}</span>}
          </span>
          {steps > 0 && (
            <span className="block mt-1.5">
              <SegBar steps={steps} reached={reached} hue={hue} />
            </span>
          )}
        </span>
      );
    }
    case 'present':
      return value.label ? (
        <span className="inline-flex flex-col gap-0.5 min-w-0">
          <TechInk label={value.label} />
          {value.sub && <span className="typo-label text-foreground/45 truncate">{value.sub}</span>}
        </span>
      ) : (
        <span className="typo-caption font-medium" style={{ color: INK.blue }}>{COPY.setUp}</span>
      );
    case 'chips': {
      if (value.items.length === 0) return <span className="typo-caption font-medium" style={{ color: INK.blue }}>{COPY.add}</span>;
      return (
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          {value.items.slice(0, MAX_CHIPS).map((c) => <TechInk key={c} label={c} muted />)}
          {value.items.length > MAX_CHIPS && <span className="typo-caption text-foreground/45">+{value.items.length - MAX_CHIPS}</span>}
        </span>
      );
    }
    case 'pips':
      return <Pips items={value.items} />;
    case 'bool':
      return <BoolMark on={value.on} />;
    case 'counts': {
      const total = value.items.reduce((a, i) => a + i.count, 0);
      if (total === 0) return <span className="typo-caption font-medium" style={{ color: INK.blue }}>{COPY.add}</span>;
      return (
        <span className="inline-flex items-center gap-x-2.5 min-w-0">
          {value.items.map((i) => (
            <span key={i.label} className="inline-flex items-baseline gap-1">
              <span className={`typo-caption font-semibold tabular-nums ${i.count > 0 ? 'text-foreground/90' : 'text-foreground/35'}`}>{i.count}</span>
              <span className="typo-label text-foreground/45">{i.label}</span>
            </span>
          ))}
        </span>
      );
    }
    case 'env': {
      // Three visually separated slots (local / test / prod). A known source
      // renders in TechInk (brand glyph when resolvable); an unknown one is an
      // explicit em-dash empty state — the honest "nothing in the codebase".
      return (
        <span className="flex min-w-0 max-w-[220px]" data-testid="env-split-cell">
          {value.slots.map((s, i) => (
            <span key={s.env} className={`flex flex-col gap-1 min-w-0 flex-1 ${i > 0 ? 'pl-2 ml-2 border-l border-foreground/10' : ''}`}>
              <span className={`text-[8.5px] uppercase tracking-[0.14em] leading-none ${s.label ? 'text-foreground/45' : 'text-foreground/25'}`}>{ENV_LABEL[s.env]}</span>
              {s.label ? (
                <span title={s.sub ? `${s.label} — ${s.sub}` : undefined} className="min-w-0"><TechInk label={s.label} /></span>
              ) : (
                <span className="typo-caption text-foreground/25 leading-none" title={`${ENV_LABEL[s.env]}: no source or config known in the codebase`}>—</span>
              )}
            </span>
          ))}
        </span>
      );
    }
    case 'cost': {
      if (value.state === 'missing') {
        return (
          <span className="inline-flex flex-col gap-0.5 min-w-0" title={`No ${APP_COST_FILENAME} in the repo — the gear dispatches an agent to create it`} data-testid="app-cost-missing">
            <span className="typo-caption font-medium text-foreground/45">NA</span>
            <span className="typo-label text-foreground/35">no cost file</span>
          </span>
        );
      }
      if (value.state === 'empty') {
        return (
          <span
            className="typo-caption font-medium"
            style={{ color: INK.blue }}
            title={value.invalid ? `${APP_COST_FILENAME} isn't valid JSON — fix it by hand` : `${APP_COST_FILENAME} exists — add your services and monthly costs by hand`}
          >
            {value.invalid ? 'invalid cost file' : 'add services →'}
          </span>
        );
      }
      const services = value.services ?? [];
      const unpriced = services.filter((s) => s.monthly == null).length;
      const amount = value.currency && value.currency !== 'USD'
        ? `${value.total ?? 0} ${value.currency}`
        : formatCost(value.total ?? 0);
      return (
        <span
          className="inline-flex flex-col gap-0.5 min-w-0"
          title={services.map((s) => `${s.name}: ${s.monthly == null ? '?' : s.monthly}${s.note ? ` (${s.note})` : ''}`).join(' · ')}
          data-testid="app-cost-cell"
        >
          <span className="typo-caption font-semibold text-foreground/90 tabular-nums">{amount}/mo</span>
          <span className="typo-label text-foreground/45 truncate">
            {services.length} service{services.length === 1 ? '' : 's'}{unpriced > 0 ? ` · ${unpriced} unpriced` : ''}
          </span>
        </span>
      );
    }
  }
}
