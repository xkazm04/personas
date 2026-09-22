// One scenario, as a small multiple. Everything a person needs to judge a
// branch in a cell the size of a card: what varies, what it is held to, how far
// it got, on how big a sample, and on what kind of evidence.
import { Pencil, Trash2 } from 'lucide-react';

import { AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';
import { formatNumeric } from '@/lib/utils/formatters';

import { bucketFloor } from '../featureRules';
import { proofLabel, scopeLabel, type TFeatures } from '../featuresModel';
import { ProofLadder, ScoreBar } from '../svg/RowFigures';
import type { ScenarioProof } from '@/api/devTools/features';

const SCOPE_TONE: Record<string, string> = {
  must_hold: 'border-primary/50 text-primary',
  tracked: 'border-status-info/50 text-status-info',
  out_of_scope: 'border-border text-foreground/70',
  proposed: 'border-violet-400/50 text-violet-300',
};

export interface ScenarioCellProps {
  scenario: BoardScenario;
  onEdit: (scenario: BoardScenario) => void;
  onDelete: (scenario: BoardScenario) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

export function ScenarioCell({ scenario, onEdit, onDelete, t, tx, language }: ScenarioCellProps) {
  const latest = scenario.latest;
  const measured = latest?.state === 'measured' && latest.score != null;
  const score = measured ? latest?.score ?? null : null;
  const floor = bucketFloor(scenario);
  const floorText = formatNumeric(floor, 'plain', { language, precision: 2 });
  const barLabel = score == null
    ? tx(t.score_bar_unmeasured, { floor: floorText })
    : tx(t.score_bar_label, { score: formatNumeric(score, 'plain', { language, precision: 2 }), floor: floorText });
  // The ladder is only meaningful for a row a run actually touched.
  const proof = latest ? (latest.proof as ScenarioProof) : null;

  return (
    <article
      data-testid="features-scenario-cell"
      data-scenario-scope={scenario.scope}
      className="flex flex-col gap-2 rounded-card border border-primary/15 bg-primary/5 shadow-elevation-1 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 typo-body text-foreground">{scenario.title}</h4>
        <span
          className={`flex-none rounded-pill border px-1.5 typo-caption ${SCOPE_TONE[scenario.scope] ?? 'border-border text-foreground/70'}`}
        >
          {scopeLabel(scenario.scope, t)}
        </span>
      </div>

      {Object.keys(scenario.axes).length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {Object.entries(scenario.axes).map(([key, value]) => (
            <li
              key={key}
              className="rounded-pill border border-border bg-secondary/40 px-1.5 typo-caption text-foreground"
            >
              {key}: {value}
            </li>
          ))}
        </ul>
      ) : null}

      <ScoreBar
        score={score}
        floor={floor}
        floorHit={latest?.floorHit ?? false}
        advisory={latest?.advisory ?? false}
        label={barLabel}
        width={196}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="typo-data text-foreground">
          {score == null ? t.not_measured : <Numeric value={score} precision={2} />}
        </span>
        <span className="typo-caption">
          {latest?.n == null ? t.sample_unknown : tx(t.sample_label, { count: latest.n })}
        </span>
        {/* No run touched this branch, so there is no rung to draw. Saying
            "proof not recognised" here would name a defect that is really an
            absence. */}
        {proof ? (
          <Tooltip content={tx(t.proof_ladder_label, { proof: proofLabel(proof, t) })}>
            <span className="inline-flex items-center gap-1.5 typo-caption">
              <ProofLadder proof={proof} label={tx(t.proof_ladder_label, { proof: proofLabel(proof, t) })} />
              {proofLabel(proof, t)}
            </span>
          </Tooltip>
        ) : null}
      </div>

      {latest?.summary ? <p className="typo-caption">{latest.summary}</p> : null}

      {/* Icon-only: at cell width the full labels wrap to three lines each and
          the two controls become the loudest thing in a figure-led cell. The
          name is carried by the shared tooltip and the aria-label. */}
      <div className="flex items-center gap-1">
        <Tooltip content={t.scenario_edit}>
          <AsyncButton
            variant="ghost"
            size="sm"
            aria-label={t.scenario_edit}
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => onEdit(scenario)}
          />
        </Tooltip>
        <Tooltip content={t.scenario_delete}>
          <AsyncButton
            variant="ghost"
            size="sm"
            aria-label={t.scenario_delete}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => onDelete(scenario)}
          />
        </Tooltip>
      </div>
    </article>
  );
}
