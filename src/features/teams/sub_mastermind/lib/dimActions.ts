// Canvas dimension → Passport-wall improve action. Maps each Mastermind dim
// to its wall row key and asks the SAME applicability logic ImproveCell uses,
// so a canvas cell is clickable exactly when its wall row would show a gear.
import { applicableDeployActions } from '@/features/teams/sub_factory/passport/improve/deployActions';
import { applicableStandardsActions } from '@/features/teams/sub_factory/passport/improve/standards';
import { connectorSpecFor } from '@/features/teams/sub_factory/passport/improve/connectors';
import type { ImproveRaw } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';

import { DIM_REGISTRY } from './dimRegistry';
import type { DimKey, DimNode } from './types';

/** Mirror of ImproveCell's applicability checks, driven by the dimension
 *  registry: `rowKey` (wall counterpart) and `action` (resolution kind) come
 *  from the entry. Standards dimensions (ci) gate on a Tier-0 standards config;
 *  deploy dimensions gate on deploy/connector/skills applicability; the ideas
 *  dimension is always actionable on a real project (its click opens the
 *  scan-dispatch popover — running one IS the setup path). */
export function dimAction(
  dimKey: DimKey,
  passport: AppPassport | undefined,
  raw: ImproveRaw | undefined,
): { rowKey: string | null; action: DimNode['action'] } {
  const entry = DIM_REGISTRY[dimKey];
  if (entry.action === 'ideas') return { rowKey: null, action: passport ? 'ideas' : null };
  const rowKey = entry.rowKey;
  if (!rowKey || !passport) return { rowKey: rowKey ?? null, action: null };
  if (entry.action === 'standards') {
    const has = raw ? applicableStandardsActions(raw.project.standards_config).length > 0 : false;
    return { rowKey, action: has ? 'standards' : null };
  }
  const hasDeploy = applicableDeployActions(rowKey, passport).length > 0;
  const hasConnector = Boolean(connectorSpecFor(rowKey)?.applicable(passport));
  const hasSkills = rowKey === 'skills' && (raw?.skillsToAdd?.length ?? 0) > 0;
  return { rowKey, action: hasDeploy || hasConnector || hasSkills ? 'deploy' : null };
}
