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
import { AlertTriangle, CheckCircle2, ArrowUpRight, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';

import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { passportToMarkdown } from './passportExport';
import { SECTIONS, type CellValue } from './passportRows';
import {
  sortByNameAsc,
  ARCHETYPE_LABEL, LIFECYCLE_LABEL, CRITICALITY_LABEL,
  AUTOMATION_LABEL, PROD_BAND_LABEL, AUTOMATION_SCALE, PROD_BAND_SCALE,
  type AppPassport,
} from './passportModel';
import { INK, InkTabs, SegBar, TechInk, inkKindOf, scoreInk } from './passportInk';
import { Pips, BoolMark, SectionIcon } from './passportWidgets';
import { scoreAgainstRubric } from './improve/goldenStandard';
import { ImproveCell } from './improve/ImproveCell';
import { StandardsScan } from './improve/StandardsScan';
import { ReadinessTrend } from './ReadinessTrend';
import { LlmTrackingCell } from './LlmTrackingCell';
import { WarningBadge, type WarningItem } from './WarningBadge';

// Improvable cells. Tier-0 standards-config rows (CI / Self-verify) + every
// code-requiring or connector-bindable row: context/CLAUDE.md/tests/evals/
// security/migrations/observability (Claude deploy or scan), the monitoring
// tooling rows (errors/logs/metrics/tracing → connector wire), hosting (deploy),
// aiflow + skills. Each opens the cell popover with its level ladder + actions.
const IMPROVABLE_ROWS = new Set([
  'ci', 'security', 'selfverify', 'context', 'instructions', 'tests', 'evals',
  'migrations', 'observability', 'aiflow', 'skills',
  'errors', 'logs', 'metrics', 'tracing', 'hosting', 'llmtracking',
]);

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
}: {
  passports: AppPassport[];
  openSlugs?: Set<string>;
  onOpen?: (slug: string) => void;
  /** Off-track KPIs per project id — surfaced as a warning badge on the cover. */
  attentionByProject?: Map<string, WarningItem[]>;
  /** Deep-link from a warning into that KPI's console. */
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<WallView>('overview');
  const [sort, setSort] = useState<WallSort>('name');
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
                          <span className="typo-caption text-foreground/65">{row.label}</span>
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
                              {IMPROVABLE_ROWS.has(row.key) ? (
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
    </div>
  );
}

/** A passport cover — shared by the Overview tile and the Compare column
 *  header: clickable identity, warning badge + scan + export, meta chips, the
 *  two readiness axes as segmented level bars, golden gauge, trend.
 *  Exported for reuse as the Mastermind project sidebar's header. */
export function CoverBody({
  p, openable, onOpen, attention, onJumpKpi,
}: {
  p: AppPassport;
  openable: boolean;
  onOpen?: (slug: string) => void;
  attention: WarningItem[];
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const critical = p.identity.criticality === 'mission-critical';
  const worst = scoreInk(Math.min(p.automationReadiness.score, p.productionReadiness.score));
  const axis = (label: string, code: string, name: string, score: number, reached: number, steps: number) => {
    const hue = scoreInk(score);
    return (
      <div className="w-full">
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/45">{label}</span>
          <Tooltip content={`${name} — ${score}/100`}>
            <span className="inline-flex items-baseline gap-1 cursor-default ml-auto">
              <span className="typo-caption font-bold tabular-nums leading-none" style={{ color: hue }}>{code}</span>
              <span className="typo-caption tabular-nums leading-none opacity-70" style={{ color: hue }}>{score}</span>
            </span>
          </Tooltip>
        </div>
        <SegBar steps={steps} reached={reached} hue={hue} />
      </div>
    );
  };

  return (
    <>
      {/* worst-state dot + title + warning badge + scan + export */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: worst, boxShadow: `0 0 6px ${worst}88` }} aria-hidden />
        {openable ? (
          <button type="button" onClick={() => onOpen!(p.identity.slug)} title={p.identity.purpose} className="group/cov inline-flex items-center gap-1 min-w-0 text-left">
            <span className="typo-heading-lg tracking-tight truncate group-hover/cov:text-primary transition-colors">{p.identity.name}</span>
            <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover/cov:opacity-100 text-primary/70 transition-opacity" aria-hidden />
          </button>
        ) : (
          <span title={p.identity.purpose} className="typo-heading-lg tracking-tight truncate block">{p.identity.name}</span>
        )}
        <WarningBadge projectName={p.identity.name} items={attention} onJump={(g, k) => onJumpKpi?.(p.identity.slug, g, k)} />
        <StandardsScan slug={p.identity.slug} projectName={p.identity.name} />
        <CopyButton
          text={passportToMarkdown(p, Date.now())}
          icon={<FileDown className="w-3.5 h-3.5" />}
          tooltip="Copy readiness report (markdown)"
          className="flex-shrink-0 p-0.5 text-foreground/45 hover:text-primary"
        />
      </div>

      {/* identity as quiet ink text — no pill chips */}
      <div className="typo-label text-foreground/40 mt-1">
        {ARCHETYPE_LABEL[p.identity.archetype]} · {LIFECYCLE_LABEL[p.identity.lifecycle]} ·{' '}
        <span className={critical ? 'text-red-300' : undefined}>{CRITICALITY_LABEL[p.identity.criticality]}</span>
      </div>

      <div className="flex flex-col gap-2.5 mt-3">
        {axis(
          COPY.automation,
          p.automationReadiness.level,
          AUTOMATION_LABEL[p.automationReadiness.level],
          p.automationReadiness.score,
          AUTOMATION_SCALE.indexOf(p.automationReadiness.level) + 1,
          AUTOMATION_SCALE.length,
        )}
        {axis(
          COPY.production,
          PROD_BAND_LABEL[p.productionReadiness.band],
          PROD_BAND_LABEL[p.productionReadiness.band],
          p.productionReadiness.score,
          PROD_BAND_SCALE.indexOf(p.productionReadiness.band) + 1,
          PROD_BAND_SCALE.length,
        )}
        <GoldenInk p={p} />
        <ReadinessTrend slug={p.identity.slug} />
      </div>
    </>
  );
}

/** The golden-standard line in ink — same rubric as the improve engine's gauge,
 *  painted with the ink score ramp (the original scoreTint's blue-at-60 would
 *  collide with ink's blue = SETUP vocabulary). */
function GoldenInk({ p }: { p: AppPassport }) {
  const r = scoreAgainstRubric(p);
  const hue = scoreInk(r.goldenPct);
  const tip = r.belowTarget.length
    ? `Below the ${ARCHETYPE_LABEL[r.archetype]} golden standard on: ${r.belowTarget.map((d) => d.label).join(', ')}`
    : `Meets the ${ARCHETYPE_LABEL[r.archetype]} golden standard`;
  return (
    <Tooltip content={tip}>
      <span className="inline-flex items-center gap-1.5 w-full cursor-default">
        <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/45 flex-shrink-0">Golden</span>
        <span className="relative flex-1 h-[2px] rounded-full" style={{ background: 'rgba(148,163,184,.10)' }}>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${r.goldenPct}%`, background: hue, boxShadow: `0 0 4px ${hue}55` }} />
        </span>
        <span className="typo-caption tabular-nums font-semibold leading-none flex-shrink-0" style={{ color: hue }}>{r.goldenPct}%</span>
        {r.belowTarget.length > 0 && (
          <span className="typo-label text-foreground/40 flex-shrink-0">· {r.belowTarget.length}&nbsp;below</span>
        )}
      </span>
    </Tooltip>
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
  }
}
