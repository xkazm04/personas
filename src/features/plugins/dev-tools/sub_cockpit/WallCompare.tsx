// WALL VARIANT 3 — "Compare" (R7). The production wall's signature side-by-side
// COLUMN comparison, kept row-aligned via the same passportRows spec — but in
// the Focus identity: covers with thin readiness lines instead of seals, cells
// in editorial ink that RECEDE when good (scan a column of faded green and the
// deficiencies are the only things standing), blue = set up, and the blockers
// band at the foot. Project title is the door into that project's Focus cockpit.
import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from 'lucide-react';

import { SECTIONS } from '@/features/teams/sub_factory/passport/passportRows';

import { InkCellValue, InkTabs, NEON, ScoreLine, SETUP_BLUE, inkKindOf, scoreInk } from './cockpitGlyphs';
import { WALL, sortWall, wallHealth, type WallEntry, type WallSort } from './wallMock';

const SORT_TABS: Array<{ id: WallSort; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'automation', label: 'Automation' },
  { id: 'production', label: 'Production' },
  { id: 'gap', label: 'Gap' },
];

const bodySections = SECTIONS.map((s) => ({ ...s, rows: s.rows.filter((r) => !r.headline) }));

function Cover({ entry, onOpen }: { entry: WallEntry; onOpen: (id: string) => void }) {
  const { project, passport } = entry;
  const health = wallHealth(project);
  const worst =
    health.crit > 0 ? NEON.red
    : health.warn > 0 ? NEON.amber
    : health.total === 0 ? SETUP_BLUE
    : NEON.emerald;
  const axis = (label: string, sub: string, score: number) => {
    const hue = scoreInk(score);
    return (
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-foreground/40">{label}</span>
          <span className="text-[10.5px] font-medium" style={{ color: hue }}>{sub}</span>
          <span className="text-[10px] tabular-nums text-foreground/40 ml-auto">{score}</span>
        </div>
        <div className="mt-1"><ScoreLine pct={score} hue={hue} /></div>
      </div>
    );
  };
  return (
    <div className="px-3.5 py-3 border-b border-foreground/10" style={{ borderTop: `2px solid ${worst}55` }}>
      <button
        type="button"
        onClick={() => onOpen(project.id)}
        title={`Open the ${project.name} cockpit`}
        className="group/door inline-flex items-center gap-1.5 min-w-0 max-w-full text-left focus-ring rounded-interactive"
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: worst, boxShadow: `0 0 6px ${worst}88` }} />
        <span className="typo-body font-semibold tracking-tight text-foreground group-hover/door:text-primary transition-colors truncate">
          {project.name}
        </span>
        <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-primary/70 opacity-0 group-hover/door:opacity-100 transition-opacity" aria-hidden />
      </button>
      <div className="text-[10.5px] tabular-nums mt-1 flex items-center gap-2">
        {health.total === 0 ? (
          <span style={{ color: SETUP_BLUE }}>no contexts scanned →</span>
        ) : (
          <>
            {health.crit > 0 && <span style={{ color: NEON.red }}>{health.crit} critical</span>}
            {health.warn > 0 && <span style={{ color: NEON.amber }}>{health.warn} warning</span>}
            <span className="text-foreground/35">{health.total} contexts</span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 mt-2.5">
        {axis('Automation', passport.automationReadiness.level, passport.automationReadiness.score)}
        {axis('Production', passport.productionReadiness.band, passport.productionReadiness.score)}
      </div>
    </div>
  );
}

export default function WallCompare({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [sort, setSort] = useState<WallSort>('name');
  const entries = useMemo(() => sortWall(WALL, sort), [sort]);
  const cols = { gridTemplateColumns: `150px repeat(${entries.length}, minmax(215px, 1fr))` };
  const rail = 'sticky left-0 z-10 bg-background';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-8" data-testid="wall-compare">
      <div className="flex justify-end mb-3">
        <InkTabs tabs={SORT_TABS} active={sort} onChange={setSort} label="Sort" />
      </div>

      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(148,163,184,.14)', background: 'rgba(148,163,184,.025)' }}>
        <div className="grid min-w-fit" style={cols}>
          {/* covers */}
          <div className={`${rail} border-b border-foreground/10`} />
          {entries.map((e) => <Cover key={e.project.id} entry={e} onOpen={onOpenProject} />)}

          {/* sections + dimension rows */}
          {bodySections.map((section) => (
            <Fragment key={section.key}>
              <div className="col-span-full px-3.5 py-1.5 text-[9.5px] uppercase tracking-[0.14em] text-foreground/45 bg-foreground/[0.03] border-b border-foreground/[0.06]">
                {section.label}
              </div>
              {section.rows.map((row) => (
                <Fragment key={row.key}>
                  <div className={`${rail} px-3.5 py-2 border-b border-foreground/[0.05]`}>
                    <span className="text-[10.5px] text-foreground/60">{row.label}</span>
                  </div>
                  {entries.map((e) => {
                    const value = row.get(e.passport);
                    const kind = inkKindOf(value);
                    const recede = kind === 'good' || kind === 'info';
                    return (
                      <div key={e.project.id} className={`px-3.5 py-2 border-b border-foreground/[0.05] min-w-0 ${recede ? 'opacity-40' : ''}`}>
                        <InkCellValue value={value} />
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </Fragment>
          ))}

          {/* the blockers band */}
          <div className={`${rail} px-3.5 py-2.5 border-t border-dashed border-foreground/15`}>
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em]" style={{ color: NEON.red }}>
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> Not ready
            </span>
          </div>
          {entries.map((e) => {
            const blockers = [...e.passport.productionReadiness.blockers, ...e.passport.automationReadiness.blockers];
            return (
              <div key={e.project.id} className="px-3.5 py-2.5 border-t border-dashed border-foreground/15">
                {blockers.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5 typo-caption" style={{ color: NEON.emerald }}>
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Ready — no blockers
                  </span>
                ) : (
                  <ul className="space-y-1">
                    {blockers.map((b, i) => (
                      <li key={i} className="flex gap-1.5 typo-caption text-foreground/75">
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
      </div>
    </div>
  );
}
