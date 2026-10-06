/**
 * Fusion · decision v2 - who asks and about what, from the product's own
 * slices: the project the item belongs to (the work item's own, else the
 * decision's source ref "billing-api#412", else an approval's `project`
 * parameter), that project's tech-stack mark (the same brand glyphs Dev Tools
 * draws), and the ref inside it. Read-only; nothing here owns a verb.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { resolveTechIcon, type BrandIcon } from '@/features/shared/components/display/techIcons';
import { useSystemStore } from '@/stores/systemStore';
import type { WorkItem, WorkItemKind } from '../../../../../useWorkforce';
import type { CardModel } from '../../../c/bodies/model';

export interface Provenance {
  project: string | null;
  ref: string | null;
  tech: BrandIcon | null;
}

function paramProject(model: CardModel | null): string | null {
  if (!model?.details) return null;
  try {
    const p: unknown = JSON.parse(model.details.code);
    if (!p || typeof p !== 'object' || !('project' in p)) return null;
    return typeof p.project === 'string' ? p.project : null;
  } catch {
    // Not JSON: the parameters stay prose behind the details reveal.
    return null;
  }
}

export function useProvenance(item: WorkItem, model: CardModel | null): Provenance {
  const projects = useSystemStore((s) => s.projects);
  const sourceRef = useAthenaStore((s) => (item.kind === 'decision' ? (s.pendingDecision?.sourceRef ?? null) : null));
  const [refProject, refTail] = sourceRef?.includes('#') ? sourceRef.split('#', 2) : [null, null];
  const project = item.project ?? (refProject || null) ?? paramProject(model);
  const known = project ? projects.find((p) => p.name === project) : undefined;
  const tech = known?.tech_stack ? (resolveTechIcon(known.tech_stack)?.icon ?? null) : null;
  return { project, ref: refTail ? `#${refTail}` : null, tech };
}

/** The kit tone a kind's status takes on the hero tile's rail. */
export const KIND_TONE: Record<WorkItemKind, 'warning' | 'primary' | 'error' | 'info' | 'agent'> = {
  session_request: 'warning',
  decision: 'warning',
  approval: 'primary',
  plan: 'primary',
  failure: 'error',
  warning: 'warning',
  nudge: 'agent',
  assignment: 'info',
};
