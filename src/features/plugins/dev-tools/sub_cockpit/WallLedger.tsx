// WALL VARIANT 2 — "Ledger" (R7). Projects as STACKED ROW BOXES in the Focus
// identity: each project is one Console-frame box wearing Cards' ink, read top
// to bottom like a register. Same functionality as the production Passport Wall
// (same passports, same row spec, same sorts, the "Why it's not ready" payload)
// — but painted with the Focus vocabulary: thin score lines for the two
// readiness axes, dimension cells that RECEDE when good, blue = set up.
// The project title is the door: click → that project's Focus cockpit.
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from 'lucide-react';

import {
  ARCHETYPE_LABEL, CRITICALITY_LABEL, LIFECYCLE_LABEL,
} from '@/features/teams/sub_factory/passport/passportModel';
import { SECTIONS } from '@/features/teams/sub_factory/passport/passportRows';

import { InkCellValue, InkTabs, NEON, ScoreLine, SETUP_BLUE, inkKindOf, scoreInk } from './cockpitGlyphs';
import { WALL, sortWall, wallHealth, type WallEntry, type WallSort } from './wallMock';

const SORT_TABS: Array<{ id: WallSort; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'automation', label: 'Automation' },
  { id: 'production', label: 'Production' },
  { id: 'gap', label: 'Gap' },
];

/** Non-headline rows — the two axes render as the box's score lines instead. */
const DIM_ROWS = SECTIONS.flatMap((s) => s.rows.filter((r) => !r.headline).map((row) => ({ section: s, row })));

function AxisLine({ label, sub, score }: { label: string; sub: string; score: number }) {
  const hue = scoreInk(score);
  return (
    <div className="min-w-[180px] flex-1 max-w-[260px]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40">{label}</span>
        <span className="text-[10.5px] font-medium" style={{ color: hue }}>{sub}</span>
        <span className="text-[10px] tabular-nums text-foreground/40 ml-auto">{score}</span>
      </div>
      <div className="mt-1"><ScoreLine pct={score} hue={hue} /></div>
    </div>
  );
}

function LedgerRow({ entry, onOpen }: { entry: WallEntry; onOpen: (id: string) => void }) {
  const { project, passport } = entry;
  const health = wallHealth(project);
  const blockers = [...passport.productionReadiness.blockers, ...passport.automationReadiness.blockers];
  const worst =
    health.crit > 0 ? NEON.red
    : health.warn > 0 ? NEON.amber
    : health.total === 0 ? SETUP_BLUE
    : NEON.emerald;

  return (
    <section
      className="rounded-xl p-4"
      style={{ border: `1px solid ${worst}2e`, background: 'rgba(148,163,184,.025)' }}
      data-testid={`ledger-row-${project.id}`}
    >
      {/* identity + the door into Focus */}
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        <button
          type="button"
          onClick={() => onOpen(project.id)}
          title={`Open the ${project.name} cockpit`}
          className="group/door inline-flex items-center gap-1.5 min-w-0 text-left focus-ring rounded-interactive"
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: worst, boxShadow: `0 0 6px ${worst}88` }} />
          <span className="typo-heading-lg tracking-tight text-foreground group-hover/door:text-primary transition-colors truncate">
            {project.name}
          </span>
          <ArrowUpRight className="w-4 h-4 shrink-0 text-primary/70 opacity-0 group-hover/door:opacity-100 transition-opacity" aria-hidden />
        </button>
        <span className="typo-label text-foreground/40">
          {ARCHETYPE_LABEL[passport.identity.archetype]} · {LIFECYCLE_LABEL[passport.identity.lifecycle]} · {CRITICALITY_LABEL[passport.identity.criticality]}
        </span>
        <span className="ml-auto text-[10.5px] tabular-nums flex items-center gap-2.5 shrink-0">
          {health.total === 0 ? (
            <span style={{ color: SETUP_BLUE }}>no contexts scanned — scan to light the grid →</span>
          ) : (
            <>
              {health.crit > 0 && <span style={{ color: NEON.red }}>{health.crit} critical</span>}
              {health.warn > 0 && <span style={{ color: NEON.amber }}>{health.warn} warning</span>}
              <span className="text-foreground/35">{health.total} contexts</span>
            </>
          )}
        </span>
      </div>

      {/* the two readiness axes as score lines */}
      <div className="flex items-end gap-6 flex-wrap mt-3">
        <AxisLine label="Automation" sub={passport.automationReadiness.level} score={passport.automationReadiness.score} />
        <AxisLine label="Production" sub={passport.productionReadiness.band} score={passport.productionReadiness.score} />
      </div>

      {/* every passport dimension — good/info recede, deficiencies stand */}
      <div className="mt-3.5 grid gap-x-4 gap-y-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
        {DIM_ROWS.map(({ row }) => {
          const value = row.get(passport);
          const kind = inkKindOf(value);
          const recede = kind === 'good' || kind === 'info';
          return (
            <div key={row.key} className={`min-w-0 ${recede ? 'opacity-40' : ''}`}>
              <span className="block text-[9.5px] uppercase tracking-[0.1em] text-foreground/40 mb-0.5 truncate">{row.label}</span>
              <InkCellValue value={value} />
            </div>
          );
        })}
      </div>

      {/* the signature payload: why it's not ready */}
      <div className="mt-3.5 pt-2.5 border-t border-dashed border-foreground/10 flex items-start gap-2 min-w-0">
        {blockers.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 typo-caption" style={{ color: NEON.emerald }}>
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Ready — no blockers
          </span>
        ) : (
          <>
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: NEON.red }} aria-hidden />
            <span className="typo-caption text-foreground/75 min-w-0">
              {blockers.map((b, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-foreground/30 mx-1.5">·</span>}
                  {b}
                </span>
              ))}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

export default function WallLedger({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [sort, setSort] = useState<WallSort>('name');
  const entries = useMemo(() => sortWall(WALL, sort), [sort]);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-8" data-testid="wall-ledger">
      <div className="flex justify-end mb-3">
        <InkTabs tabs={SORT_TABS} active={sort} onChange={setSort} label="Sort" />
      </div>
      <div className="space-y-3">
        {entries.map((e) => <LedgerRow key={e.project.id} entry={e} onOpen={onOpenProject} />)}
      </div>
    </div>
  );
}
