// Which desk verbs the selected note can take RIGHT NOW — the one predicate the
// command bar's chips, the keys HUD's dimming and the key handler's refusals
// all read, so the three can never disagree.
//
// Every gate is the baseline's own: the right-click menu's dispatch rule for
// publish / goals, `noteAskBlocked` for Ask, `railNextStep` for the lifecycle
// step, `canQuickWrite` for writing on the card, `noteDeleteBlocked` (computed
// by the caller, it needs the fleet list) for delete.
import type { DevNote } from '@/lib/bindings/DevNote';

import { noteAskBlocked } from '../../../noteGuards';
import { canQuickWrite } from '../../../noteText';
import { railNextStep } from '../../parts/NoteLifecycleRail';
import type { DeskAction } from './deskKeyModel';

export interface DeskActionContext {
  /** A Fleet session still holds the note (`noteDeleteBlocked`). */
  deleteBlocked: boolean;
  /** A review waiting on the operator is known for the note (its bubble). */
  pendingReview: boolean;
}

export function availableDeskActions(note: DevNote, ctx: DeskActionContext): Set<DeskAction> {
  const out = new Set<DeskAction>(['open', 'reply', 'thread', 'menu', 'archive']);
  if (!noteAskBlocked(note)) out.add('ask');
  if (note.projectId && note.status === 'draft') {
    out.add('publish');
    out.add('goals');
  }
  const next = railNextStep(note);
  if (next && next.blockedKey === null) out.add('step');
  if (canQuickWrite(note)) out.add('edit');
  if (!ctx.deleteBlocked) out.add('delete');
  if (ctx.pendingReview) {
    out.add('approve');
    out.add('reject');
  }
  return out;
}
