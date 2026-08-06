// Canvas dimension → Passport-wall improve action. Maps each Mastermind dim
// to its wall row key and asks the SAME applicability logic ImproveCell uses,
// so a canvas cell is clickable exactly when its wall row would show a gear.
import { applicableDeployActions } from '@/features/teams/sub_factory/passport/improve/deployActions';
import { applicableStandardsActions } from '@/features/teams/sub_factory/passport/improve/standards';
import { connectorSpecFor } from '@/features/teams/sub_factory/passport/improve/connectors';
import { MODAL_ROWS } from '@/features/teams/sub_factory/passport/improve/improveRows';
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
  // Goals: actionable on real projects; the page decoration downgrades a
  // zero-count cell to inert (an empty list is nothing to show).
  if (entry.action === 'goals') return { rowKey: null, action: passport ? 'goals' : null };
  // KPIs: same shape — actionable on real projects, and the page downgrades a
  // project with no KPIs at all to inert.
  if (entry.action === 'kpi') return { rowKey: null, action: passport ? 'kpi' : null };
  // Declaration-only dimensions (data links, support channels): the click just
  // names what the passport declared. The page downgrades an empty list.
  if (entry.action === 'stack-list') return { rowKey: null, action: passport ? 'stack-list' : null };
  const rowKey = entry.rowKey;
  if (!rowKey || !passport) return { rowKey: rowKey ?? null, action: null };
  if (entry.action === 'standards') {
    const has = raw ? applicableStandardsActions(raw.project.standards_config).length > 0 : false;
    return { rowKey, action: has ? 'standards' : null };
  }
  // Skills is the one deploy dimension with a SECOND click surface: when the
  // project already has installed skills (green), clicking RUNS one via Fleet
  // (skills-run modal) instead of the adopt/deploy popover. Only when nothing
  // is installed do we fall back to the adopt path (skillsToAdd → deploy).
  if (dimKey === 'skills') {
    if (raw?.hasSkills) return { rowKey, action: 'skills-run' };
    const canAdopt = (raw?.skillsToAdd?.length ?? 0) > 0;
    return { rowKey, action: canAdopt ? 'deploy' : null };
  }
  // Modal dimensions are ALWAYS actionable on a real project. Their surface is
  // a declaration modal (bind a connector per environment / per capability),
  // not a gap-filling deploy — so gating them on "is there a gap" would make the
  // cell inert exactly when everything is already wired, which is when you most
  // want to see what is bound.
  if (MODAL_ROWS.has(rowKey)) return { rowKey, action: 'deploy' };
  const hasDeploy = applicableDeployActions(rowKey, passport).length > 0;
  const hasConnector = Boolean(connectorSpecFor(rowKey)?.applicable(passport));
  const hasSkills = rowKey === 'skills' && (raw?.skillsToAdd?.length ?? 0) > 0;
  return { rowKey, action: hasDeploy || hasConnector || hasSkills ? 'deploy' : null };
}
