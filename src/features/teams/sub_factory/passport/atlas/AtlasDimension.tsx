// Passport Atlas — one dimension of one project, in full: its state, value,
// sub-line, ladder and door. The same body renders in the cell drawer and as
// a row of the passport document. The row's long explanation is never body
// text: it is the Hint behind the label (owner, 2026-09-25: "hide these into
// custom tooltip components in case hint is needed").
import { Hint, KitButton } from '@/features/shared/components/kit';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { AppPassport } from '../passportModel';
import {
  CI_SCALE, CI_LABEL, TESTS_SCALE, TESTS_LABEL, SECURITY_SCALE, SECURITY_LABEL, OBSERVABILITY_SCALE, OBSERVABILITY_LABEL,
  GRAPH_SCALE, GRAPH_LABEL, EVALS_SCALE, EVALS_LABEL, MIGRATIONS_SCALE, MIGRATIONS_LABEL, MEMORY_SCALE, MEMORY_LABEL,
  DOCS_SCALE, DOCS_LABEL, DESIGN_SYSTEM_SCALE, DESIGN_SYSTEM_LABEL,
} from '../passportModel';
import { ImproveCell } from '../improve/ImproveCell';
import { LlmTrackingCell } from '../LlmTrackingCell';
import { passportDispatchKey } from '../passportFleet';
import { IMPROVABLE_ROWS, UNIFIED_ROWS } from '../wallConfig';
import type { WallSetupTarget } from '../WallCompareTable';
import { inkOf, type AtlasRow } from './atlasModel';
import { InkDot, Ladder, ladderOf, ValueView, valueText } from './AtlasParts';
import { ATLAS_WORDS as W, INK_MARK } from './atlasWords';

const labelsOf = <T extends string>(scale: T[], labels: Record<T, string>) => scale.map((s) => labels[s]);
const ROW_SCALE: Record<string, string[]> = {
  ci: labelsOf(CI_SCALE, CI_LABEL), tests: labelsOf(TESTS_SCALE, TESTS_LABEL), security: labelsOf(SECURITY_SCALE, SECURITY_LABEL),
  observability: labelsOf(OBSERVABILITY_SCALE, OBSERVABILITY_LABEL), context: labelsOf(GRAPH_SCALE, GRAPH_LABEL),
  evals: labelsOf(EVALS_SCALE, EVALS_LABEL), migrations: labelsOf(MIGRATIONS_SCALE, MIGRATIONS_LABEL),
  memory: labelsOf(MEMORY_SCALE, MEMORY_LABEL), docs: labelsOf(DOCS_SCALE, DOCS_LABEL), 'design-system': labelsOf(DESIGN_SYSTEM_SCALE, DESIGN_SYSTEM_LABEL),
};

export interface DimensionDoors {
  fleetSessions: Map<string, FleetSession>;
  onOpenSetup: (t: WallSetupTarget) => void;
  onOpenTerminal: (dispatchKey: string) => void;
}

export function DimensionBody({ p, row, doors, heading = 'h3' }: { p: AppPassport; row: AtlasRow; doors: DimensionDoors; heading?: 'h2' | 'h3' }) {
  const v = row.get(p);
  const ink = inkOf(p, row);
  const unknown = ink === 'unknown';
  const ladder = ladderOf(v, ROW_SCALE[row.key]);
  const slug = p.identity.slug;
  const H = heading;

  const value = row.key === 'llmtracking'
    ? <LlmTrackingCell slug={slug} label={v.kind === 'present' ? v.label : null} />
    : <ValueView v={v} unknown={unknown} />;

  const dk = passportDispatchKey(row.key, slug);
  const live = UNIFIED_ROWS.has(row.key) ? doors.fleetSessions.get(dk) : undefined;
  const door = UNIFIED_ROWS.has(row.key)
    ? live
      ? <KitButton onClick={() => doors.onOpenTerminal(dk)} testId={`atlas-terminal-${row.key}`}>{W.openTerminal}</KitButton>
      : <KitButton onClick={() => doors.onOpenSetup({ rowKey: row.key, rowLabel: row.label, passport: p, currentLabel: valueText(v) })} testId={`atlas-setup-${row.key}`}>{W.setUp}</KitButton>
    : null;

  return (
    <div className="atlas-dim" data-ink={ink}>
      <div className="atlas-dim__head">
        <Hint content={row.info} focusable placement="bottom">
          <H className="atlas-dim__label typo-title">{row.label}</H>
        </Hint>
        <span className="atlas-dim__state typo-caption">
          <InkDot ink={ink} /> {INK_MARK[ink].label}
          {v.kind === 'ordinal' && v.reached != null && v.steps != null && <span className="k-quiet"> · {W.rung(v.reached + 1, v.steps + 1)}</span>}
        </span>
        {live && <span className="atlas-dim__live typo-caption"><span className="k-mark k-dot g-live t-primary" aria-hidden="true" />{W.working}</span>}
      </div>
      <div className="atlas-dim__value">
        {IMPROVABLE_ROWS.has(row.key) && !unknown ? <ImproveCell slug={slug} rowKey={row.key} passport={p}>{value}</ImproveCell> : value}
        {'sub' in v && v.sub && <p className="atlas-dim__sub typo-caption">{v.sub}</p>}
        {ladder && <Ladder steps={ladder.steps} reached={ladder.reached} unverified={unknown} />}
      </div>
      {door && <div className="atlas-dim__door">{door}</div>}
    </div>
  );
}
