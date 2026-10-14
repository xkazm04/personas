// Standings at a glance: the contests folded into three small tallies, so the
// drawer can answer "what do we run, which models, who wins" without a matrix.
//
// "Model" is the seat's model name with its effort and label stripped, so
// `claude:opus@high` and `claude:opus@low` count as one model. "Task area" is
// the contest's project: a contest carries no task-type field, and the project
// it was run for is the closest honest grouping the summary offers.
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { seatLabel } from '../model/seatCatalog';

export interface ModelTally {
  model: string;
  /** Decided contests this model sat in. */
  entered: number;
  /** Of those, the ones its seat won. */
  wins: number;
}

export interface AreaTally {
  project: string;
  contests: number;
  decided: number;
  /** The model that won most of this area's decided contests, if any was decided. */
  topModel: string | null;
}

export interface StandingsOverview {
  contests: number;
  decided: number;
  models: ModelTally[];
  areas: AreaTally[];
}

const modelOf = (spec: string): string => seatLabel(spec).model;

export function standingsOverview(contests: readonly ContestSummary[]): StandingsOverview {
  const models = new Map<string, ModelTally>();
  const areas = new Map<string, { contests: number; decided: number; wins: Map<string, number> }>();
  let decided = 0;

  for (const c of contests) {
    const area = areas.get(c.projectName) ?? { contests: 0, decided: 0, wins: new Map<string, number>() };
    area.contests += 1;
    areas.set(c.projectName, area);
    if (c.phase !== 'decided') continue;

    decided += 1;
    area.decided += 1;
    const winner = c.winnerSeatSpec ? modelOf(c.winnerSeatSpec) : null;
    if (winner) area.wins.set(winner, (area.wins.get(winner) ?? 0) + 1);

    for (const model of new Set(c.seatSpecs.map(modelOf))) {
      const row = models.get(model) ?? { model, entered: 0, wins: 0 };
      row.entered += 1;
      if (model === winner) row.wins += 1;
      models.set(model, row);
    }
  }

  return {
    contests: contests.length,
    decided,
    models: [...models.values()].sort((a, b) => b.wins - a.wins || b.entered - a.entered || a.model.localeCompare(b.model)),
    areas: [...areas.entries()]
      .map(([project, a]) => ({
        project,
        contests: a.contests,
        decided: a.decided,
        topModel: [...a.wins.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null,
      }))
      .sort((a, b) => b.contests - a.contests || a.project.localeCompare(b.project)),
  };
}
