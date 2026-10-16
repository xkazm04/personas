/**
 * peekKeys — the peek's half of the Decision Center keyboard, as a pure table.
 *
 *   ↑/↓ move the row focus · ←/→ (J/K) walk to the neighbouring chip ·
 *   A accept · R arm a reject, Enter confirms it · D done (reports, chat) ·
 *   S skip to the next row · Space opens a thread to reply · Enter opens ·
 *   Esc disarms, then closes the peek.
 *
 * A one-key verdict only fires where the verdict is honest WITHOUT the card:
 * a question has fields to fill, a council rejection needs a written reason,
 * and a draft mandate is signed on its envelope (and dropped with a reason),
 * so A / R on those open the item instead of writing a deferral (or a
 * refusal) that would read as a landed decision. A lens-scan card (build,
 * evidence, release) is never decided from the row or the card: it is
 * decided on the blueprint sheet (or in bp), so A / R open it too.
 *
 * React-free; the hook that binds it is `usePeekKeyboard`.
 */
import type { DecisionItem } from '../model/decisionModel';
import { isLensKind } from '../lens/lensKinds';

export type PeekAction =
  | { type: 'move'; step: 1 | -1 }
  | { type: 'walk'; step: 1 | -1 }
  | { type: 'open' }
  | { type: 'decide'; verdict: 'accept' | 'reject' }
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'close' };

/** A can write `accept` from the row. */
export function canAcceptFromRow(item: DecisionItem): boolean {
  return item.kind !== 'question' && item.kind !== 'mandate' && !isLensKind(item.kind);
}

/** R can write `reject` from the row. */
export function canRejectFromRow(item: DecisionItem): boolean {
  return item.kind !== 'question' && item.kind !== 'council' && item.kind !== 'mandate' && !isLensKind(item.kind);
}

/** D (done) applies: a report read, a thread answered. */
export function canFinishFromRow(item: DecisionItem): boolean {
  return item.kind === 'report' || item.kind === 'message';
}

export function peekKeyAction(
  key: string,
  state: { armed: boolean; item: DecisionItem | null },
): PeekAction | null {
  const { armed, item } = state;
  switch (key) {
    case 'Escape':
      return armed ? { type: 'disarm' } : { type: 'close' };
    case 'ArrowDown':
      return { type: 'move', step: 1 };
    case 'ArrowUp':
      return { type: 'move', step: -1 };
    case 'ArrowRight':
    case 'j':
    case 'J':
      return { type: 'walk', step: 1 };
    case 'ArrowLeft':
    case 'k':
    case 'K':
      return { type: 'walk', step: -1 };
  }
  if (!item) return null;
  switch (key) {
    case 'Enter':
      return armed ? { type: 'decide', verdict: 'reject' } : { type: 'open' };
    case 'a':
    case 'A':
      return canAcceptFromRow(item) ? { type: 'decide', verdict: 'accept' } : { type: 'open' };
    case 'r':
    case 'R':
      return canRejectFromRow(item) ? { type: 'arm' } : { type: 'open' };
    case 'd':
    case 'D':
      return canFinishFromRow(item) ? { type: 'decide', verdict: 'accept' } : null;
    case 's':
    case 'S':
      return { type: 'move', step: 1 };
    case ' ':
      return item.kind === 'message' ? { type: 'open' } : null;
    default:
      return null;
  }
}
