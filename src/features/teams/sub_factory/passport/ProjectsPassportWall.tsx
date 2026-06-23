// The project-readiness MATRIX — a wall of passport "booklets" read side by side.
// Each dev_tools project is a COLUMN styled like a readiness certificate: a
// stamped cover (identity + the two labeled headline seals — automation level &
// production band), then stamped entries below. Rows align across columns via a
// sticky label rail so it stays a true comparison. Columns sort by name (default),
// either readiness axis, or the automatable-vs-production "readiness gap" — the
// passport's signature insight. Its unique payload is the "Why it's not ready"
// band: each app's own blockers. This is the production baseline for the Factory
// projects overview (the KPI-cards + heat-grid variants were consolidated out).
import { Fragment, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ArrowUpRight, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';

import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { passportToMarkdown } from './passportExport';
import { SECTIONS, type CellValue } from './passportRows';
import {
  scoreTint, ordinalTint, sortByNameAsc,
  ARCHETYPE_LABEL, LIFECYCLE_LABEL, CRITICALITY_LABEL,
  type AppPassport,
} from './passportModel';
import { ReadinessSeal, ScoreBar, Pips, BoolMark, GapMark, Chip, SectionIcon } from './passportWidgets';
import { TechBadge } from './techIcons';
import { WarningBadge, type WarningItem } from './WarningBadge';
import { ImproveCell } from './improve/ImproveCell';
import { StandardsScan } from './improve/StandardsScan';
import { GoldenGauge } from './improve/GoldenGauge';
import { ReadinessTrend } from './ReadinessTrend';

// Improvable cells. Tier-0 standards-config rows (CI / Self-verify) + every
// code-requiring or connector-bindable row: context/CLAUDE.md/tests/evals/
// security/migrations/observability (Claude deploy or scan), the monitoring
// tooling rows (errors/logs/metrics/tracing → connector wire), hosting (deploy),
// aiflow + skills. Each opens the cell popover with its level ladder + actions.
const IMPROVABLE_ROWS = new Set([
  'ci', 'security', 'selfverify', 'context', 'instructions', 'tests', 'evals',
  'migrations', 'observability', 'aiflow', 'skills',
  'errors', 'logs', 'metrics', 'tracing', 'hosting',
]);

const COPY = {
  blockersTitle: 'Why it’s not ready',
  clear: 'Ready — no blockers',
  compare: 'Passport',
  scrollHint: 'scroll to compare →',
  automation: 'Automation',
  production: 'Production',
  sort: 'Sort',
};

const MAX_CHIPS = 5;

type WallSort = 'name' | 'automation' | 'production' | 'gap';
const SORT_TABS: SegmentedTab<WallSort>[] = [
  { id: 'name', label: 'Name' },
  { id: 'automation', label: 'Automation' },
  { id: 'production', label: 'Production' },
  { id: 'gap', label: 'Readiness gap' },
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

  return (
    <div>
      {/* toolbar — horizontal scroll arrows + column sort */}
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="inline-flex items-center gap-1.5">
          <button type="button" onClick={() => nudge(-1)} aria-label="Scroll columns left" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => nudge(1)} aria-label="Scroll columns right" className="inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-primary/12 text-foreground/70 hover:text-foreground hover:bg-primary/5 transition-colors focus-ring">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="typo-caption text-foreground/45 ml-1">{COPY.scrollHint}</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="typo-label text-foreground/40">{COPY.sort}</span>
          <SegmentedTabs tabs={SORT_TABS} activeTab={sort} onTabChange={setSort} variant="pill" fullWidth={false} size="sm" ariaLabel="Sort projects" />
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded-modal border border-primary/[0.08] bg-secondary/[0.03] shadow-elevation-1">
        <table className="border-separate border-spacing-0">
          {/* passport covers */}
          <thead>
            <tr>
              <th className={`${rail} w-[190px] min-w-[190px] px-3 py-3 text-left align-bottom border-b-2 border-primary/15`}>
                <span className="typo-label text-foreground/50">{COPY.compare}</span>
              </th>
              {columns.map((p, i) => (
                <CoverCell
                  key={p.identity.slug}
                  p={p}
                  i={i}
                  reduce={reduce}
                  colChrome={colChrome}
                  openable={Boolean(openSlugs?.has(p.identity.slug) && onOpen)}
                  onOpen={onOpen}
                  attention={attentionByProject?.get(p.identity.slug) ?? []}
                  onJumpKpi={onJumpKpi}
                />
              ))}
            </tr>
          </thead>

          <tbody>
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
                    <td className={`${rail} px-3 py-1.5 border-t border-primary/[0.06] align-top`}>
                      <span className="typo-caption text-foreground/65">{row.label}</span>
                    </td>
                    {columns.map((p) => (
                      <td key={p.identity.slug} className={`px-3 py-1.5 align-top border-t border-primary/[0.06] ${colChrome}`}>
                        {IMPROVABLE_ROWS.has(row.key) ? (
                          <ImproveCell slug={p.identity.slug} rowKey={row.key} passport={p}><WallCell value={row.get(p)} /></ImproveCell>
                        ) : (
                          <WallCell value={row.get(p)} />
                        )}
                      </td>
                    ))}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A passport "cover" — the column header: clickable identity, meta chips, the
 *  axis-skew insight, and the two labeled readiness seals. */
function CoverCell({
  p, i, reduce, colChrome, openable, onOpen, attention, onJumpKpi,
}: {
  p: AppPassport;
  i: number;
  reduce: boolean | null;
  colChrome: string;
  openable: boolean;
  onOpen?: (slug: string) => void;
  attention: WarningItem[];
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const tint = scoreTint(p.automationReadiness.score);
  const critical = p.identity.criticality === 'mission-critical';

  return (
    <motion.th
      initial={reduce ? false : { opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.24, delay: reduce ? 0 : i * 0.04 }}
      className={`min-w-[224px] w-[224px] px-3 py-3 text-left align-top border-b-2 border-primary/15 ${colChrome}`}
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${tint.hex} 9%, transparent), transparent 70%)`,
        borderTop: `2px solid color-mix(in srgb, ${tint.hex} 45%, transparent)`,
      }}
    >
      {/* title + warning badge */}
      <div className="flex items-center gap-1.5 min-w-0">
        {openable ? (
          <button type="button" onClick={() => onOpen!(p.identity.slug)} title={p.identity.purpose} className="group/cov inline-flex items-center gap-1 min-w-0 text-left">
            <span className="typo-heading-lg truncate group-hover/cov:text-primary transition-colors">{p.identity.name}</span>
            <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover/cov:opacity-100 text-primary/70 transition-opacity" aria-hidden />
          </button>
        ) : (
          <span title={p.identity.purpose} className="typo-heading-lg truncate block">{p.identity.name}</span>
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

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Chip label={ARCHETYPE_LABEL[p.identity.archetype]} />
        <Chip label={LIFECYCLE_LABEL[p.identity.lifecycle]} />
        <span className={`typo-label ${critical ? 'text-red-300' : 'text-foreground/40'}`}>{CRITICALITY_LABEL[p.identity.criticality]}</span>
      </div>

      <div className="flex flex-col gap-2.5 mt-3">
        <ScoreBar label={COPY.automation} kind="level" level={p.automationReadiness.level} score={p.automationReadiness.score} />
        <ScoreBar label={COPY.production} kind="band" band={p.productionReadiness.band} score={p.productionReadiness.score} />
        <GoldenGauge passport={p} />
        <ReadinessTrend slug={p.identity.slug} />
      </div>
    </motion.th>
  );
}

/** Stamped-entry cell renderer — flatter, ink-on-page styling. Ordinals show a
 *  5-dot stamp scale; meaningful nulls render as a quiet gap marker. */
function WallCell({ value }: { value: CellValue }) {
  switch (value.kind) {
    case 'level':
      return <ReadinessSeal kind="level" level={value.level} score={value.score} size="sm" />;
    case 'band':
      return <ReadinessSeal kind="band" band={value.band} score={value.score} size="sm" />;
    case 'ordinal': {
      const tint = ordinalTint(value.pos);
      const filled = Math.max(1, Math.ceil(value.pos * 5));
      return (
        <span className="inline-flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex gap-0.5" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className="w-1 h-2.5 rounded-interactive" style={{ background: i < filled ? tint.hex : 'color-mix(in srgb, var(--foreground) 12%, transparent)' }} />
              ))}
            </span>
            <span className={`typo-caption font-medium ${tint.text}`}>{value.label}</span>
          </span>
          {value.sub && <span className="typo-label text-foreground/45 truncate">{value.sub}</span>}
        </span>
      );
    }
    case 'present':
      return value.label ? <span className="typo-caption text-foreground">{value.label}</span> : <GapMark />;
    case 'chips':
      if (value.items.length === 0) return <GapMark label="None" />;
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {value.items.slice(0, MAX_CHIPS).map((c) => <TechBadge key={c} label={c} />)}
          {value.items.length > MAX_CHIPS && <span className="typo-caption text-foreground/45">+{value.items.length - MAX_CHIPS}</span>}
        </span>
      );
    case 'pips':
      return <Pips items={value.items} />;
    case 'bool':
      return <BoolMark on={value.on} />;
  }
}
