/**
 * Halo · Hand — the shared vocabulary of the board and the cards: the gold
 * accent, the glyph per card kind and per process type, and the lane crest
 * (Athena's portrait medallion or a project's monogram shield).
 */

import {
  Activity,
  CalendarClock,
  ClipboardList,
  MessageCircleQuestion,
  OctagonX,
  Play,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Split,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { FleetShipIcon } from '@/features/plugins/fleet/FleetShipIcon';
import type { ProcessKind } from '../../../useProcessColumns';
import type { WorkItemKind } from '../../../useWorkforce';

/** The card-game gold: the brand amber token, never a raw hex. */
export const GOLD = 'var(--brand-amber)';
export const GOLD_SOFT = 'color-mix(in srgb, var(--brand-amber) 45%, transparent)';
export const GOLD_DEEP = 'color-mix(in srgb, var(--brand-amber) 55%, var(--background))';

export const ATHENA_IMG = '/athena/athena_baseline.jpg';

export const KIND_GLYPH: Record<WorkItemKind, LucideIcon> = {
  session_request: MessageCircleQuestion,
  decision: Split,
  approval: ShieldCheck,
  plan: ScrollText,
  failure: OctagonX,
  warning: TriangleAlert,
  nudge: Sparkles,
  assignment: ClipboardList,
};

export const PROCESS_GLYPH: Record<ProcessKind, ComponentType<{ className?: string }>> = {
  fleet: FleetShipIcon,
  liveop: Activity,
  rundesk: Play,
  schedule: CalendarClock,
};

/** Two letters for a project crest: "pumper" → "Pu", "ai-registry" → "AR". */
export function monogram(label: string): string {
  // Code-point cuts ([...s]), so an emoji-initial name never splits a surrogate.
  const parts = label.split(/[\s\-_./]+/).filter(Boolean).map((p) => [...p]);
  if (parts.length >= 2) return ((parts[0]![0] ?? '') + (parts[1]![0] ?? '')).toUpperCase();
  const w = parts[0] ?? [...label];
  return (w[0] ?? '?').toUpperCase() + (w[1] ?? '').toLowerCase();
}

/** A shield silhouette for project crests (Athena wears a round medallion). */
export const SHIELD_CLIP = 'polygon(50% 0%, 100% 14%, 100% 58%, 50% 100%, 0% 58%, 0% 14%)';

/**
 * The lane / card crest. `athena` renders her portrait in a gold-rimmed
 * medallion; a project renders its monogram in a gold-rimmed shield.
 */
export function Crest({ athena, label, size = 28 }: { athena: boolean; label: string; size?: number }) {
  if (athena) {
    return (
      <span
        className="block rounded-full p-[2px] shrink-0"
        style={{ width: size, height: size, background: `linear-gradient(160deg, ${GOLD}, ${GOLD_DEEP})` }}
        aria-hidden
      >
        <img src={ATHENA_IMG} alt="" className="w-full h-full rounded-full object-cover" draggable={false} />
      </span>
    );
  }
  return (
    <span
      className="block shrink-0 p-[2px]"
      style={{ width: size, height: size * 1.12, clipPath: SHIELD_CLIP, background: `linear-gradient(160deg, ${GOLD}, ${GOLD_DEEP})` }}
      aria-hidden
    >
      <span
        className="grid place-items-center w-full h-full typo-caption leading-none text-foreground"
        style={{
          clipPath: SHIELD_CLIP,
          background: 'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--primary) 30%, var(--secondary)), var(--background))',
          paddingBottom: size * 0.12,
        }}
      >
        {monogram(label)}
      </span>
    </span>
  );
}
