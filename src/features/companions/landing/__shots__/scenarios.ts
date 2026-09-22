// The contest's own staged scenarios, mapped onto the REAL DTO.
//
// Only fields `CompanionDetailDto` actually carries survive the mapping - the
// prototype's `domains`, `subjects`, `findingsWaiting`, `decisionsWaiting`,
// `lastActive`, `lastWave` and `planNext` have no wire field yet, so the port
// draws nothing for them rather than inventing a number. A field that is
// absent stays absent: a missing count is never a zero.
import type { CompanionStatusDto } from '../../types';

export type ScenarioId = 'today' | 'fresh' | 'all-active' | 'athena-off' | 'mixed';

function athena(
  enabled: boolean,
  onboarded: boolean,
  pendingDecisions?: number,
): CompanionStatusDto {
  return { id: 'athena', enabled, eligible: true, onboarded, detail: pendingDecisions === undefined ? {} : { pendingDecisions } };
}

function overseer(enabled: boolean, starredCount: number, agentsTotal: number): CompanionStatusDto {
  const eligible = starredCount > 0;
  return {
    id: 'overseer',
    enabled,
    eligible,
    onboarded: true,
    detail: { starredCount, agentsTotal },
    ...(eligible ? {} : { blocker: 'no_starred_personas' as const }),
  };
}

function curator(enabled: boolean, registryName?: string): CompanionStatusDto {
  const eligible = registryName !== undefined;
  return {
    id: 'curator',
    enabled,
    eligible,
    onboarded: true,
    detail: eligible ? { registryName, registryPath: 'C:\\Users\\kazda\\kiro\\ai-registry' } : {},
    ...(eligible ? {} : { blocker: 'no_registry' as const }),
  };
}

export const SCENARIOS: Record<ScenarioId, CompanionStatusDto[]> = {
  // This machine, right now: Athena awake with two decisions waiting,
  // Overseer waiting on a starred agent, Curator mapped but switched off.
  today: [athena(true, true, 2), overseer(false, 0, 16), curator(false, 'ai-registry')],
  fresh: [athena(true, false), overseer(false, 0, 0), curator(false)],
  'all-active': [athena(true, true, 0), overseer(true, 6, 16), curator(true, 'ai-registry')],
  'athena-off': [athena(false, true), overseer(true, 3, 16), curator(true, 'ai-registry')],
  mixed: [athena(true, true, 5), overseer(false, 3, 16), curator(false)],
};

export function scenarioOf(id: string | null): CompanionStatusDto[] {
  return SCENARIOS[(id ?? 'today') as ScenarioId] ?? SCENARIOS.today;
}
