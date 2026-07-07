import {
  Activity,
  BookOpenCheck,
  Brain,
  ConciergeBell,
  LibraryBig,
  LineChart,
  NotebookPen,
  Palette,
  Radar,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/**
 * Static icon map for the Foundry palette. The archetype/memory-strategy
 * catalog (`scripts/templates/_archetypes.json`) names lucide icons as
 * strings; the palette is small and curated, so a static map beats a
 * dynamic lucide resolver (no bundle bloat, typo-safe fallback).
 */
const FOUNDRY_ICONS: Record<string, LucideIcon> = {
  ShieldCheck,
  LineChart,
  Radar,
  Workflow,
  Activity,
  LibraryBig,
  Palette,
  Rocket,
  ConciergeBell,
  Target,
  Brain,
  Users,
  BookOpenCheck,
  NotebookPen,
};

export function foundryIcon(name: string): LucideIcon {
  return FOUNDRY_ICONS[name] ?? Sparkles;
}
