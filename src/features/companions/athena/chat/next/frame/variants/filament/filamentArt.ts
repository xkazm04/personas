/**
 * Filament (contest B/1) — small shared helpers for the right panel and the
 * decision stage. Deliberately not imported from `../c/cardArt`: that module
 * is the ornament vocabulary this look retires (ring, filigree, weave), and
 * this variant must not inherit it even transitively.
 *
 * TODO(prototype, 2026-10-03): first in-app port of the contest winner, for a
 * visual-degradation check before the full promotion pass (style-contract.py).
 */

import { ClipboardList, Map as MapIcon, MessageSquareMore, OctagonAlert, Scale, ShieldCheck, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { WorkItemKind } from '../../../useWorkforce';

export const KIND_GLYPH: Record<WorkItemKind, LucideIcon> = {
  session_request: MessageSquareMore,
  decision: Scale,
  approval: ShieldCheck,
  plan: MapIcon,
  failure: OctagonAlert,
  warning: TriangleAlert,
  nudge: Sparkles,
  assignment: ClipboardList,
};

export const mix = (color: string, pct: number, into = 'transparent') => `color-mix(in srgb, ${color} ${pct}%, ${into})`;

/** The one hover language: brighten, never fill or move. */
export const HOVER_GLOW = 'transition-[filter] duration-200 ease-linear hover:brightness-125 focus-visible:brightness-125';
