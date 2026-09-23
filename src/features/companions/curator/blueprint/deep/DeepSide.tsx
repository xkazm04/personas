/**
 * What the instrument holds about this subject, and where it crosses the fleet.
 *
 * THE CROSSING IS UNNAMED, NOT ABSENT. The registry's map check reports its
 * totals per PROJECT; it does not say which subject a project's stale verdicts
 * were judged against. The prototype could name 25 subjects because it read a
 * printed report this app does not carry. So every subject takes what was the
 * prototype's own fallback branch, in its own words: the crossings exist and
 * cannot be drawn from this instrument.
 */
import type { BlueprintModel, BlueprintRow, ConsumerProject } from '../model/types';
import { fmt, share, widthPct } from '../format';
import { useWords } from '../words';

/** How far Curator may reach into a checkout. `unknown` is not `refused`. */
type Reach = 'granted' | 'refused' | 'never_asked' | 'off' | 'unknown';

const REACH_GLYPH: Record<Reach, string> = {
  granted: '●',
  refused: '⊘',
  never_asked: '○',
  off: '◌',
  unknown: '?',
};

function reachMark(reach: ConsumerProject['reach']): Reach {
  if (!reach) return 'unknown';
  if (!reach.enabled) return 'off';
  return reach.consent === 'granted' ? 'granted' : reach.consent === 'refused' ? 'refused' : 'never_asked';
}

function ProjectBar({ model, slug }: { model: BlueprintModel; slug: string }) {
  const { w, tx } = useWords();
  const p = model.consumers.projects.find((x) => x.slug === slug)!;
  const maxPairs = Math.max(1, ...model.consumers.projects.map((x) => x.pairs));
  const scale = p.pairs / maxPairs;
  const part = (n: number) => widthPct((n / Math.max(1, p.pairs)) * 100 * scale, 100);
  return (
    <div
      className="cb-pj"
      data-cb-tip={`${tx(w.project_tip, {
        slug: p.slug,
        evaluated: fmt(p.evaluated),
        pairs: fmt(p.pairs),
        pct: share(p.evaluated, p.pairs) ?? w.not_measured,
        stale: p.staleVerdicts,
        state: p.state,
      })} ${w.side_reach}: ${w.reach[reachMark(p.reach)]}`}
    >
      <span className="cb-pn typo-caption">
        {p.slug}
        <i className={`cb-reach cb-reach-${reachMark(p.reach)}`}>{REACH_GLYPH[reachMark(p.reach)]}</i>
      </span>
      <span className="cb-bar" style={{ height: '9px' }}>
        <i
          className="cb-ink-solid"
          style={
            {
              ['--cb-c']: 'var(--status-success)',
              width: part(p.evaluated - p.staleVerdicts),
              minWidth: '1px',
            } as React.CSSProperties
          }
        />
        <i
          className="cb-ink-stale"
          style={
            { ['--cb-c']: 'var(--status-success)', width: part(p.staleVerdicts) } as React.CSSProperties
          }
        />
        <i className="cb-ink-unknown" style={{ width: part(p.pairs - p.evaluated) }} />
      </span>
      <span className="cb-pv typo-code">
        <b>{p.evaluated}</b>/{fmt(p.pairs)}
      </span>
    </div>
  );
}

export function DeepSide({ row, model }: { row: BlueprintRow; model: BlueprintModel }) {
  const { w, tx } = useWords();
  const c = model.consumers;
  const quiet = model.quiet.find((q) => q.domain === row.domain);
  const bundleRows = model.rows.filter((r) => r.domain === row.domain);
  const demandRead = model.demandKnownDomains.includes(row.domain);

  return (
    <aside className="cb-dside">
      <div className="cb-sect typo-label cb-up">
        {w.side_crossing}
        <span className="cb-ln" />
      </div>
      <p className="typo-caption">
        {tx(w.side_crossing_unnamed, {
          stale: fmt(c.staleVerdicts),
          projects: fmt(c.projects.length),
        })}
      </p>
      {[...c.projects]
        .sort((a, b) => b.staleVerdicts - a.staleVerdicts)
        .map((p) => (
          <ProjectBar key={p.slug} model={model} slug={p.slug} />
        ))}

      <div className="cb-sect typo-label cb-up">
        {w.side_scan_holds}
        <span className="cb-ln" />
      </div>
      <dl className="cb-kv typo-caption">
        <dt>{w.side_techniques}</dt>
        <dd>
          {row.techniques}
          {row.techniques < 4 && (
            <span style={{ color: 'var(--cb-ch4)' }}> {tx(w.side_under_floor, { n: 4 })}</span>
          )}
        </dd>
        <dt>{w.side_applications}</dt>
        <dd>{row.applications}</dd>
        <dt>{w.side_stacks}</dt>
        <dd>
          <span className="cb-chips">
            {row.stacks.length ? (
              row.stacks.map((s) => (
                <span key={s} className="cb-chip typo-label">
                  {s}
                </span>
              ))
            ) : (
              <span className="cb-dim">{w.side_none}</span>
            )}
          </span>
        </dd>
        <dt>{w.side_last_swept}</dt>
        <dd>{row.lastSwept ?? <span style={{ color: 'var(--cb-ch5)' }}>{w.side_never}</span>}</dd>
        <dt>{w.side_demand}</dt>
        <dd>
          {row.demandKnown && row.demand ? (
            tx(w.side_demand_read, {
              consults: row.demand.consults,
              deviations: row.demand.deviations,
              summed: row.demand.deviationsSummed,
              contributors: row.demand.contributors,
            })
          ) : (
            <>
              <span className="cb-unkbox" /> {tx(w.side_demand_unknown, { domain: row.domain })}
            </>
          )}
        </dd>
        <dt>{w.side_dry_streak}</dt>
        <dd data-cb-tip={w.side_dry_streak_tip}>
          {row.registryDryStreak === 0 ? w.side_dry_streak_unknown : String(row.registryDryStreak)}
        </dd>
        <dt>{w.side_saturation}</dt>
        <dd>{row.suppressedBySaturation ? w.yes : w.no}</dd>
        <dt>{w.side_applied_row}</dt>
        <dd>{row.hasAppliedRow === null ? w.side_applied_unknown : row.hasAppliedRow ? w.yes : w.no}</dd>
        <dt>{w.side_in_plan}</dt>
        <dd>{tx(w.side_plan_position, { n: row.order + 1, total: model.rows.length })}</dd>
      </dl>

      <div className="cb-sect typo-label cb-up">
        {w.side_bundle}
        <span className="cb-ln" />
      </div>
      <dl className="cb-kv typo-caption">
        <dt>{row.domain}</dt>
        <dd>
          {tx(w.side_bundle_subjects, { n: bundleRows.length, quiet: quiet?.subjects ?? 0 })}
        </dd>
        <dt>{w.side_bundle_points}</dt>
        <dd>
          {fmt(bundleRows.reduce((a, r) => a + r.points, 0))} / {fmt(model.planPoints)}
        </dd>
        <dt>{w.side_demand}</dt>
        <dd>
          {demandRead ? (
            w.side_bundle_demand_read
          ) : (
            <b style={{ color: 'var(--status-warning)' }}>{w.side_bundle_demand_unread}</b>
          )}
        </dd>
      </dl>
    </aside>
  );
}
