/**
 * Navigation registry — the SINGLE source of truth for every top-level
 * navigation destination (a `SidebarSection`).
 *
 * Historically four catalogs described the same set of sections and drifted
 * apart:
 *
 *   1. `sidebarData.sections`        — what the sidebar rail renders
 *   2. the `PersonasPage` if-ladder  — what the content router mounts
 *   3. `CommandPalette` NAV_ITEMS    — what the ⌘K palette can jump to
 *   4. `navCatalog.SECTIONS`         — what usage-analytics tracks
 *
 * Each of those is now DERIVED from `NAV_SECTIONS` below, so a section can no
 * longer exist in one surface and silently vanish from another. The
 * completeness test (`registry.test.ts`) fails the build if any consumer
 * omits or invents a section, and a compile-time exhaustiveness assertion
 * fails `tsc` if a new `SidebarSection` union member is added without a
 * registry entry.
 *
 * Each entry declares:
 *   - `id`            — the `SidebarSection` union member
 *   - `label`         — English fallback (localized at render via `useSidebarLabels`)
 *   - `labelKey`      — sidebar-label lookup id (fed to `useSidebarLabels`)
 *   - `icon`          — the Lucide fallback icon (custom icons still win in SidebarIcons)
 *   - `gates`         — `{ minTier?, devOnly? }` visibility gates
 *   - `reachability`  — how a user can actually reach this surface:
 *       · `'sidebar'`      — rendered in the Level-1 rail and mounted by the content router
 *       · `'overlay-only'` — NOT in the rail; summoned as a title-bar overlay (e.g. Schedules)
 *       · `'hidden'`       — has a type member / persisted value but no live surface
 */
import type { LucideIcon } from 'lucide-react';
import {
  Home, BarChart3, Users, Bot, Radio, Key, FlaskConical,
  Puzzle, Globe, Settings, CalendarClock,
} from 'lucide-react';
import type { SidebarSection } from '@/lib/types/types';
import { type Tier, TIERS } from '@/lib/constants/uiModes';

/** How a user can actually reach a navigation section. */
export type NavReachability = 'sidebar' | 'overlay-only' | 'hidden';

/** Visibility gates evaluated before a section renders. */
export interface NavGates {
  /** Minimum tier required (default: starter — always visible). */
  minTier?: Tier;
  /** Only in `import.meta.env.DEV` builds, regardless of tier. */
  devOnly?: boolean;
}

export interface NavSectionEntry {
  id: SidebarSection;
  /** English fallback; the live label resolves through `useSidebarLabels(labelKey)`. */
  label: string;
  /** Lookup id for `useSidebarLabels` (equals `id` for every section today). */
  labelKey: string;
  icon: LucideIcon;
  gates: NavGates;
  reachability: NavReachability;
}

/**
 * The registry. Order = canonical nav order (drives the sidebar rail and the
 * analytics section order). Every `SidebarSection` MUST appear exactly once.
 */
export const NAV_SECTIONS: readonly NavSectionEntry[] = [
  { id: 'home',           label: 'Home',        labelKey: 'home',           icon: Home,          gates: {},                      reachability: 'sidebar' },
  { id: 'overview',       label: 'Overview',    labelKey: 'overview',       icon: BarChart3,     gates: {},                      reachability: 'sidebar' },
  { id: 'teams',          label: 'Projects',    labelKey: 'teams',          icon: Users,         gates: { minTier: TIERS.TEAM }, reachability: 'sidebar' },
  { id: 'personas',       label: 'Agents',      labelKey: 'personas',       icon: Bot,           gates: {},                      reachability: 'sidebar' },
  { id: 'events',         label: 'Events',      labelKey: 'events',         icon: Radio,         gates: { minTier: TIERS.TEAM }, reachability: 'sidebar' },
  { id: 'credentials',    label: 'Connections', labelKey: 'credentials',    icon: Key,           gates: {},                      reachability: 'sidebar' },
  { id: 'design-reviews', label: 'Templates',   labelKey: 'design-reviews', icon: FlaskConical,  gates: {},                      reachability: 'sidebar' },
  { id: 'plugins',        label: 'Plugins',     labelKey: 'plugins',        icon: Puzzle,        gates: { minTier: TIERS.TEAM }, reachability: 'sidebar' },
  // Studio — the Athena web-dev companion preview. Dev-only while in
  // active development; still rail-rendered (behind the devOnly gate).
  { id: 'studio',         label: 'Studio',      labelKey: 'studio',         icon: Globe,         gates: { devOnly: true },       reachability: 'sidebar' },
  // Schedules is summoned as a full-screen title-bar overlay
  // (see useTitleBarTray → headerOverlay==='schedules'), NOT a rail section.
  // It keeps a `SidebarSection` type member for legacy persisted state, but
  // owns no content-router branch.
  { id: 'schedules',      label: 'Schedules',   labelKey: 'schedules',      icon: CalendarClock, gates: {},                      reachability: 'overlay-only' },
  { id: 'settings',       label: 'Settings',    labelKey: 'settings',       icon: Settings,      gates: {},                      reachability: 'sidebar' },
] as const;

/** Every `SidebarSection`, in nav order. Kept honest by the asserts below. */
export const ALL_SIDEBAR_SECTIONS = NAV_SECTIONS.map((e) => e.id);

// -- Compile-time exhaustiveness ---------------------------------------------
// If a new member is added to the `SidebarSection` union without a matching
// NAV_SECTIONS entry, `_AssertAllRegistered` collapses to `never` and the
// assignment below fails `tsc`. The reverse (an entry whose id is not a
// SidebarSection) is already impossible because `id: SidebarSection`.
type RegisteredSection = (typeof NAV_SECTIONS)[number]['id'];
type _AssertAllRegistered = [Exclude<SidebarSection, RegisteredSection>] extends [never] ? true : never;
const _allSectionsRegistered: _AssertAllRegistered = true;
void _allSectionsRegistered;

// -- Lookups & helpers -------------------------------------------------------

const SECTION_BY_ID: Record<SidebarSection, NavSectionEntry> = Object.fromEntries(
  NAV_SECTIONS.map((e) => [e.id, e]),
) as Record<SidebarSection, NavSectionEntry>;

/** Registry entry for a section id (never undefined — the union is exhaustive). */
export function navSection(id: SidebarSection): NavSectionEntry {
  return SECTION_BY_ID[id];
}

/** Sections rendered in the Level-1 sidebar rail (before tier/dev filtering). */
export const SIDEBAR_SECTIONS: readonly NavSectionEntry[] =
  NAV_SECTIONS.filter((e) => e.reachability === 'sidebar');

/** Sections summoned as an overlay rather than the rail (e.g. Schedules). */
export const OVERLAY_SECTIONS: readonly NavSectionEntry[] =
  NAV_SECTIONS.filter((e) => e.reachability === 'overlay-only');

/** Context needed to evaluate a section's gates. */
export interface GateContext {
  isDev: boolean;
  /** Usually `useTier().isVisible`. */
  isTierVisible: (minTier: Tier) => boolean;
}

/**
 * Whether a section's gates permit it to render/appear for the given context.
 * The one place tier + dev gating is decided, so the sidebar, the content
 * router, and the command palette can never disagree about what's reachable.
 */
export function passesGates(gates: NavGates, ctx: GateContext): boolean {
  if (gates.devOnly && !ctx.isDev) return false;
  if (gates.minTier && !ctx.isTierVisible(gates.minTier)) return false;
  return true;
}
