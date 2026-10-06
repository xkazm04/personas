/**
 * Fusion · decision v2 - what a choice DOES, read from its own words: one
 * glyph and one short effect line per answer tile, so "Land #412 first" reads
 * as a merge and "Hold both" as a wait before the label is read. The verb
 * decides; the choice's tone is the fallback when no verb is known. The ink
 * is the tone's: primary goes ahead, danger is the error ink, neutral stays
 * quiet.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import {
  ArrowRight,
  Ban,
  CircleCheck,
  CircleDot,
  CirclePause,
  GitBranch,
  GitMerge,
  RotateCw,
  Send,
  SkipForward,
  Trash2,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { CardChoice } from '../../../c/bodies/model';
import { V2_COPY as C } from './copy';

type Effect = keyof typeof C.effect;

const VERBS: [RegExp, LucideIcon, Effect][] = [
  [/\b(approve|allow|accept|confirm|yes|proceed)\b/i, CircleCheck, 'approve'],
  [/\b(reject|deny|decline|block|cancel|refuse|no)\b/i, Ban, 'reject'],
  [/\b(hold|wait|pause|later|defer|postpone|snooze|keep)\b/i, CirclePause, 'hold'],
  [/\b(land|merge|ship|release|deploy|publish|push)\b/i, GitMerge, 'ship'],
  [/\b(delete|remove|drop|purge|archive|discard)\b/i, Trash2, 'remove'],
  [/\b(retry|rerun|re-run|restart|rotate|refresh|redo|run)\b/i, RotateCw, 'again'],
  [/\b(send|reply|answer|notify|tell|post)\b/i, Send, 'send'],
  [/\b(split|fork|branch)\b/i, GitBranch, 'split'],
  [/\b(fix|patch|repair|rebase)\b/i, Wrench, 'fix'],
  [/\b(skip|ignore|dismiss)\b/i, SkipForward, 'skip'],
];

export function toneInk(tone: CardChoice['tone']): string {
  if (tone === 'danger') return 'var(--status-error)';
  if (tone === 'neutral') return 'var(--status-neutral)';
  return 'var(--primary)';
}

export function actionGlyph(choice: CardChoice): { Glyph: LucideIcon; effect: string } {
  for (const [re, Glyph, effect] of VERBS) {
    if (re.test(choice.label)) return { Glyph, effect: C.effect[effect] };
  }
  if (choice.tone === 'danger') return { Glyph: TriangleAlert, effect: C.effect.careful };
  if (choice.tone === 'neutral') return { Glyph: CircleDot, effect: C.effect.leave };
  return { Glyph: ArrowRight, effect: C.effect.ahead };
}
