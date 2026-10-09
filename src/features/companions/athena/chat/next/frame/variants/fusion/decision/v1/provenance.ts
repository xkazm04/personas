/**
 * Fusion · decision v1 · who is asking, and how risky the ask is - read from
 * the work item and the product's card model, never invented. A project's
 * failure, warning, assignment or session question is asked by that project;
 * everything else (her decisions, her proposed actions, her notes and plans)
 * is Athena's own ask.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { ShieldQuestion, type LucideIcon } from 'lucide-react';
import type { WorkItem, WorkItemKind } from '../../../../../useWorkforce';
import type { CardModel } from '../../../c/bodies/model';
import { SPREAD_COPY as S } from '../../../c/copy';
import { KIND_GLYPH } from '../../kindGlyph';
import { DESK_COPY as C } from './copy';

const PROJECT_ASKS: ReadonlySet<WorkItemKind> = new Set(['session_request', 'failure', 'warning', 'assignment']);

export interface Asker {
  name: string;
  /** Athena herself asks: her portrait is the avatar. */
  athena: boolean;
}

export function askerOf(item: WorkItem): Asker {
  if (PROJECT_ASKS.has(item.kind)) {
    return { name: item.project ?? (item.kind === 'session_request' ? C.aSession : C.athena), athena: !item.project && item.kind !== 'session_request' };
  }
  return { name: C.athena, athena: true };
}

/**
 * The approval's static risk read is the only risk the model carries
 * (`useApprovalModel`: label `riskRead`, text low / elevated).
 */
export function riskOf(model: CardModel | null): 'low' | 'elevated' | null {
  const rec = model?.recommendation;
  if (!rec || rec.label !== S.riskRead) return null;
  return rec.text === S.lowRisk ? 'low' : 'elevated';
}

/** The second line under the asker: what the ask is, unless the badge already says it. */
export function askLine(item: WorkItem, model: CardModel | null): string | null {
  if (item.kind === 'decision') return null;
  return model?.eyebrow ?? item.title;
}

/** A session asking for permission (answers, not a typed reply) is an approval, not a question. */
function sessionApproval(item: WorkItem, model: CardModel | null): boolean {
  return item.kind === 'session_request' && !!model?.choices.length;
}

export function kindLabel(item: WorkItem, model: CardModel | null): string {
  return sessionApproval(item, model) ? C.sessionApproval : C.kind[item.kind]!;
}

export function kindGlyph(item: WorkItem, model: CardModel | null): LucideIcon {
  return sessionApproval(item, model) ? ShieldQuestion : KIND_GLYPH[item.kind];
}
