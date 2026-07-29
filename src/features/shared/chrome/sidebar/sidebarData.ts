import {
  BarChart3, Zap, Key, Activity, ClipboardCheck, MessageSquare,
  FlaskConical, Brain, Cloud, Plus, LayoutTemplate, Monitor, Upload,
  List, Settings, Globe, Palette, GitBranch, LayoutDashboard, Cpu,
  Network, Database, Compass, Shield, ShieldCheck, HardDriveDownload, Heart,
  FolderKanban, Map, Lightbulb, Play, Share2, Waypoints,
  Radio, Gauge, Unplug, Webhook, Store, Archive, Layers,
  GraduationCap, BookOpen, Trophy, AlertOctagon,
  User, Mic, Sparkles, Headphones,
  Wand2, Image as ImageIcon, Film, Gauge as GaugeIcon, Bell,
  Terminal, RefreshCw, FolderOpen, ScrollText, History,
  Clapperboard, MoonStar, Landmark,
  type LucideIcon,
} from 'lucide-react';
import type { SidebarSection, HomeTab, OverviewTab } from '@/lib/types/types';
import type { SubNavItem } from '@/features/shared/chrome/sidebar/SidebarSubNav';
import { type Tier, TIERS, isTierVisible } from '@/lib/constants/uiModes';
import { SIDEBAR_SECTIONS } from '@/lib/navigation/registry';

export interface SectionDef {
  id: SidebarSection;
  icon: LucideIcon;
  label: string;
  /** Minimum tier required to show this section. Default: starter (always visible). */
  minTier?: Tier;
  /** Only visible in import.meta.env.DEV builds (regardless of tier). */
  devOnly?: boolean;

  // Backward-compatible aliases — computed from minTier by filterByTier()
  /** @deprecated Read-only compat flag derived from minTier */
  simpleHidden?: boolean;
  /** @deprecated Read-only compat flag derived from minTier */
  devModeOnly?: boolean;
}

/**
 * Level-1 sidebar sections — DERIVED from the navigation registry
 * (`@/lib/navigation/registry`) so the rail can never drift from the content
 * router, command palette, or analytics catalog. Only `reachability: 'sidebar'`
 * entries appear here (Schedules is an overlay-only section, so it is excluded).
 * To add / remove / re-gate a top-level section, edit `NAV_SECTIONS` — every
 * surface updates in lockstep.
 */
export const sections: SectionDef[] = SIDEBAR_SECTIONS.map((e) => ({
  id: e.id,
  icon: e.icon,
  label: e.label,
  minTier: e.gates.minTier,
  devOnly: e.gates.devOnly,
}));

/** Filter any item array by tier visibility. */
export function filterByTier<T extends { minTier?: Tier; simpleHidden?: boolean }>(
  items: T[],
  activeTier: Tier,
): T[] {
  return items.filter((item) => {
    const minTier = item.minTier ?? TIERS.STARTER;
    return isTierVisible(minTier, activeTier);
  });
}

export const homeItems: Array<{ id: HomeTab; icon: LucideIcon; label: string }> = [
  { id: 'welcome', icon: Compass, label: 'Welcome' },
  { id: 'cockpit', icon: GaugeIcon, label: 'Cockpit' },
  { id: 'learning', icon: GraduationCap, label: 'Learning' },
  { id: 'roadmap', icon: Map, label: "What's New" },
  ...(import.meta.env.DEV ? [{ id: 'system-check' as HomeTab, icon: Monitor, label: 'System Check' }] : []),
];

export const overviewItems: Array<{ id: OverviewTab; icon: LucideIcon; label: string; minTier?: Tier; simpleHidden?: boolean; devOnly?: boolean }> = [
  { id: 'home', icon: LayoutDashboard, label: 'Dashboard' },
  // Incidents inbox — shipped now that the Errors-sigil routing can open
  // incidents per capability. Backend IPC (list/ack/resolve/dismiss) is wired;
  // the execution-failure → incident promotion is the remaining runtime hook.
  { id: 'incidents', icon: AlertOctagon, label: 'Incidents', minTier: TIERS.TEAM },
  { id: 'executions', icon: Activity, label: 'Activity', minTier: TIERS.TEAM },
  { id: 'manual-review', icon: ClipboardCheck, label: 'Approvals', minTier: TIERS.TEAM },
  { id: 'messages', icon: MessageSquare, label: 'Messages' },
  { id: 'events', icon: Zap, label: 'Events', minTier: TIERS.TEAM },
  { id: 'knowledge', icon: Brain, label: 'Knowledge', minTier: TIERS.TEAM },
  // Reliability (SLA) dashboard — has a live OverviewPage router case
  // (`overviewTab === 'sla'` → SLADashboard) and real content; surfaced in the
  // rail alongside its TEAM-tier analytics neighbors.
  { id: 'sla', icon: Gauge, label: 'Reliability', minTier: TIERS.TEAM },

  { id: 'health', icon: Heart, label: 'Health' },
  { id: 'director', icon: Clapperboard, label: 'Director', minTier: TIERS.TEAM },
  { id: 'leaderboard', icon: Trophy, label: 'Leaderboard' },
  // Dev-only: in-app viewer over the team-autonomy eval/certification bundles
  // (docs/test/runs/). Never shipped in packaged installers.
  { id: 'certification', icon: ShieldCheck, label: 'Certification', devOnly: true },
];

export const credentialItems: SubNavItem[] = [
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'databases', label: 'Databases', icon: Database, minTier: TIERS.TEAM },
  { id: 'from-template', label: 'Catalog', icon: LayoutTemplate },
  { id: 'graph', label: 'Dependencies', icon: Network },
  { id: 'add-new', label: 'Add new', icon: Plus },
];

export const eventBusItems: SubNavItem[] = [
  { id: 'live-stream', label: 'Live Stream', icon: Activity },
  { id: 'rate-limits', label: 'Speed Limits', icon: Gauge },
  { id: 'test', label: 'Test', icon: Zap },
  { id: 'smee-relay', label: 'Local Relay', icon: Unplug },
  { id: 'cloud-webhooks', label: 'Cloud Events', icon: Webhook, devOnly: true },
  { id: 'dead-letter', label: 'Dead Letter Queue', icon: Archive, devOnly: true },
  { id: 'studio', label: 'Chain Studio', icon: GitBranch },
  { id: 'shared', label: 'Marketplace', icon: Store },
];

export const templateItems: SubNavItem[] = [
  { id: 'n8n', label: 'n8n Import', icon: Upload, minTier: TIERS.TEAM },
  { id: 'generated', label: 'Generated', icon: List },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'recipes', label: 'Recipes', icon: Sparkles },
  { id: 'presets', label: 'Presets', icon: Layers, minTier: TIERS.TEAM },
];

export const artistItems: SubNavItem[] = [
  { id: 'blender', label: 'Creative Studio', icon: Wand2 },
  { id: 'gallery', label: 'Gallery', icon: ImageIcon },
  { id: 'media-studio', label: 'Media Studio', icon: Film },
];

export const devToolsItems: SubNavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'llm-overview', label: 'Observability', icon: BarChart3 },
  { id: 'context-map', label: 'Context Map', icon: Map },
  { id: 'task-runner', label: 'Task Runner', icon: Play },
  // Fleet — Claude Code session aggregator for the active project.
  // Inherits the active project's root_path as the spawn cwd. Not
  // tier-gated here because the PluginsSidebarNav devToolsItems map
  // doesn't apply tier/dev filtering today; the underlying Rust module
  // always compiles so showing it is safe across builds.
  { id: 'fleet', label: 'Fleet', icon: Terminal },
  // Workspace Knowledge Center — workspace management + cross-project
  // practice library (docs/plans/workspace-knowledge-center.md).
  { id: 'workspaces', label: 'Workspaces', icon: Landmark },
  // Skills Manager — workspace library vs active project, adopt/share,
  // memory bindings + per-skill context coverage (skill-memory-unification).
  { id: 'skills', label: 'Skills', icon: Wand2 },
];

export const twinItems: SubNavItem[] = [
  { id: 'profiles', label: 'Profiles', icon: Sparkles },
  { id: 'identity', label: 'Identity', icon: User },
  { id: 'tone', label: 'Tone', icon: Mic },
  { id: 'brain', label: 'Brain', icon: Brain },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  // NOTE: there is deliberately no 'voice' item. One existed until 2026-07-27
  // but no VoicePage was ever built and 'voice' is not in the `TwinTab` union —
  // the sidebar's `id as TwinTab` cast (PluginsSidebarNav.tsx) hid that from the
  // compiler, so clicking it set an unhandled tab and rendered a blank page.
  // Voice-of-writing lives under Tone; TTS voice selection is Companion → Voice.
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'training', label: 'Training', icon: GraduationCap },
];

export const researchLabItems: SubNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'literature', label: 'Literature', icon: BookOpen },
  { id: 'hypotheses', label: 'Hypotheses', icon: Lightbulb },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical },
  { id: 'findings', label: 'Findings', icon: Cpu },
  { id: 'reports', label: 'Reports', icon: Archive },
  { id: 'graph', label: 'Graph', icon: Waypoints },
];

export const cloudItems: SubNavItem[] = [
  { id: 'unified', label: 'All Deployments', icon: LayoutDashboard },
  { id: 'cloud', label: 'Cloud Runs', icon: Cloud },
  { id: 'gitlab', label: 'GitLab', icon: GitBranch },
];

// Companion plugin sub-nav: Setup (toggles), Memory (brain viewer),
// Voice (ElevenLabs credential picker + voice id), Decisions (Athena's
// design-decision log). The in-page header tab strip was retired — these
// all live in the L3 sidebar now. (The Dashboard tab was retired — Cockpit
// is the dynamic dashboard surface.)
export const companionItems: SubNavItem[] = [
  { id: 'setup', label: 'Setup', icon: Settings },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'decisions', label: 'Decisions', icon: ScrollText },
];

// Obsidian Brain plugin sub-nav: promoted to sidebar L3 on 2026-05-17.
// Mirrors the in-page header tab bar that previously lived in
// ObsidianBrainPage.tsx — the page now renders only the active panel,
// matching the L3-pattern adopted by Artist / Dev Tools / Twin etc.
// Keep sorted alphabetically by label (asc) — nav-order convention since
// 2026-06-10; new tabs slot into alphabetical position.
export const obsidianBrainItems: SubNavItem[] = [
  { id: 'browse',     label: 'Browse Vault', icon: FolderOpen },
  { id: 'cloud',      label: 'Cloud',        icon: Cloud },
  { id: 'graph',      label: 'Graph',        icon: Network },
  { id: 'revitalize', label: 'Revitalize',   icon: MoonStar },
  { id: 'setup',      label: 'Setup',        icon: Settings },
  { id: 'sync',       label: 'Sync',         icon: RefreshCw },
];

// ─── L2 grouping ────────────────────────────────────────────────────────
//
// Every section's Level-2 list is presented as the Projects-style grouped
// nav (see SidebarGroupNav): a caption heading per group with its items
// nested behind a left rail. These descriptors declare group membership by
// item id; `SidebarLevel2` resolves them against the flat item arrays above,
// so an item that is tier/dev-filtered out simply disappears from its group
// (and an empty group disappears entirely).

export interface SidebarItemGroupDef {
  /** Stable group key (also the collapse-state key). */
  id: string;
  /** `t.sidebar.<labelKey>` — the caption rendered above the rail. */
  labelKey: string;
  /** Item ids, in the order they should appear before label sorting. */
  itemIds: string[];
}

/** Overview → Monitoring / Operations / Memory. */
export const overviewGroups: SidebarItemGroupDef[] = [
  { id: 'monitoring', labelKey: 'group_monitoring', itemIds: ['executions', 'events', 'health', 'leaderboard', 'home', 'sla'] },
  { id: 'operations', labelKey: 'group_operations', itemIds: ['manual-review', 'certification', 'director', 'incidents', 'messages'] },
  { id: 'memory',     labelKey: 'group_memory',     itemIds: ['knowledge'] },
];

/** Home → a single group holding every home tab. */
export const homeGroups: SidebarItemGroupDef[] = [
  { id: 'home', labelKey: 'group_home', itemIds: ['welcome', 'cockpit', 'learning', 'roadmap', 'system-check'] },
];

/** Events → Build (author + try) / Maintain (operate + diagnose). */
export const eventGroups: SidebarItemGroupDef[] = [
  { id: 'build',    labelKey: 'group_build',    itemIds: ['studio', 'smee-relay', 'shared', 'test'] },
  { id: 'maintain', labelKey: 'group_maintain', itemIds: ['cloud-webhooks', 'dead-letter', 'live-stream', 'rate-limits'] },
];

/**
 * Connections → Credentials / Templates. The Templates section was folded
 * into Connections (it is no longer a Level-1 rail entry); its items live in
 * the second group and switch `sidebarSection` to 'design-reviews' on select.
 */
export const credentialGroups: SidebarItemGroupDef[] = [
  { id: 'credentials', labelKey: 'group_credentials', itemIds: ['credentials', 'databases', 'from-template', 'graph', 'add-new'] },
];

export const templateGroups: SidebarItemGroupDef[] = [
  { id: 'templates', labelKey: 'group_templates', itemIds: ['n8n', 'generated', 'explore', 'recipes', 'presets'] },
];

/** Settings → General / Connect / LLM / Advanced (dev-only surfaces). */
export const settingsGroups: SidebarItemGroupDef[] = [
  { id: 'general',  labelKey: 'group_general',  itemIds: ['account', 'appearance', 'portability', 'radio', 'notifications'] },
  { id: 'connect',  labelKey: 'group_connect',  itemIds: ['api-keys', 'network'] },
  { id: 'llm',      labelKey: 'group_llm',      itemIds: ['engine', 'byom', 'limits'] },
  { id: 'advanced', labelKey: 'group_advanced', itemIds: ['history', 'admin'] },
];

/**
 * Resolve group descriptors against a (already tier/dev-filtered) item list.
 *
 * Items are returned in `itemIds` order; groups that end up empty are dropped.
 * Any item that no group claims is appended to the LAST group rather than
 * silently disappearing — so adding an entry to `overviewItems` without
 * touching `overviewGroups` still renders (in the wrong group, visibly, which
 * is the failure mode you want).
 */
export function groupItems<T extends { id: string }>(
  defs: SidebarItemGroupDef[],
  items: T[],
): Array<{ def: SidebarItemGroupDef; items: T[] }> {
  // NOTE: `Map` is shadowed in this module by the lucide `Map` icon import —
  // use a plain record for the id index.
  const byId: Record<string, T | undefined> = {};
  for (const item of items) byId[item.id] = item;
  const claimed = new Set<string>();
  const out = defs.map((def) => {
    const picked: T[] = [];
    for (const id of def.itemIds) {
      const item = byId[id];
      if (item) { picked.push(item); claimed.add(id); }
    }
    return { def, items: picked };
  });
  const orphans = items.filter((i) => !claimed.has(i.id));
  if (orphans.length > 0) {
    const last = out[out.length - 1];
    if (last) last.items = [...last.items, ...orphans];
  }
  return out.filter((g) => g.items.length > 0);
}

export function getSettingsItems(isDev: boolean, activeTier?: Tier): SubNavItem[] {
  const tier = activeTier ?? TIERS.TEAM;
  return [
    { id: 'account', label: 'Account', icon: Globe },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'radio', label: 'Radio', icon: Headphones },
    { id: 'engine', label: 'Engine', icon: Cpu, devOnly: true },
    { id: 'byom', label: 'Custom Models', icon: Network, devOnly: true },
    { id: 'portability', label: 'Data', icon: HardDriveDownload, minTier: TIERS.TEAM },
    { id: 'limits', label: 'Limits', icon: Gauge, minTier: TIERS.TEAM },
    { id: 'api-keys', label: 'API Keys', icon: Key, minTier: TIERS.TEAM },
    { id: 'network', label: 'Network', icon: Share2, devOnly: true },
    { id: 'history', label: 'History', icon: History, devOnly: true },
    { id: 'admin', label: 'Admin', icon: Shield, devOnly: true },
  ].filter((item) => {
    if (item.devOnly && !isDev) return false;
    const minTier = item.minTier ?? TIERS.STARTER;
    return isTierVisible(minTier, tier);
  });
}
