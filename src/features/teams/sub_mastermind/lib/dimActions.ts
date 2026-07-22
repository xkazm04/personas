// Canvas dimension → Passport-wall improve action. Maps each Mastermind dim
// to its wall row key and asks the SAME applicability logic ImproveCell uses,
// so a canvas cell is clickable exactly when its wall row would show a gear.
import { applicableDeployActions } from '@/features/teams/sub_factory/passport/improve/deployActions';
import { applicableStandardsActions } from '@/features/teams/sub_factory/passport/improve/standards';
import { connectorSpecFor } from '@/features/teams/sub_factory/passport/improve/connectors';
import type { ImproveRaw } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';

import type { DimKey, DimNode } from './types';

/** Canvas dim key → wall row key (null = no wall counterpart yet). */
export const DIM_TO_ROW: Record<DimKey, string | null> = {
  db: 'migrations',
  monitoring: 'observability',
  ci: 'ci',
  tests: 'tests',
  security: 'security',
  hosting: 'hosting',
  auth: null,
  agents: 'aiflow',
  skills: 'skills',
  llm: 'llmtracking',
  kpi: null,
};

/** Mirror of ImproveCell's applicability checks (ci is a Tier-0 standards row). */
export function dimAction(
  dimKey: DimKey,
  passport: AppPassport | undefined,
  raw: ImproveRaw | undefined,
): { rowKey: string | null; action: DimNode['action'] } {
  const rowKey = DIM_TO_ROW[dimKey];
  if (!rowKey || !passport) return { rowKey: rowKey ?? null, action: null };
  if (rowKey === 'ci') {
    const has = raw ? applicableStandardsActions(raw.project.standards_config).length > 0 : false;
    return { rowKey, action: has ? 'standards' : null };
  }
  const hasDeploy = applicableDeployActions(rowKey, passport).length > 0;
  const hasConnector = Boolean(connectorSpecFor(rowKey)?.applicable(passport));
  const hasSkills = rowKey === 'skills' && (raw?.skillsToAdd?.length ?? 0) > 0;
  return { rowKey, action: hasDeploy || hasConnector || hasSkills ? 'deploy' : null };
}
