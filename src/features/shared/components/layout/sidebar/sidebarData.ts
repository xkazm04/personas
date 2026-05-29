import {
  BarChart3, Bot, Zap, Key, Activity, ClipboardCheck, MessageSquare,
  FlaskConical, Brain, Cloud, Plus, LayoutTemplate, Monitor, Upload,
  List, Settings, Globe, Palette, GitBranch, LayoutDashboard, Cpu,
  Network, Database, Home, Compass, Shield, HardDriveDownload, Heart,
  FolderKanban, Map, Lightbulb, ArrowLeftRight, Play, Share2, Waypoints,
  Radio, Gauge, Unplug, Webhook, Puzzle, Store, Archive, Layers, Workflow,
  GraduationCap, BookOpen, Trophy, AlertOctagon, Target, CalendarClock,
  User, Mic, Volume2, Sparkles,
  Wand2, Image as ImageIcon, Film, Gauge as GaugeIcon, Bell,
  Terminal, RefreshCw, FolderOpen, ScrollText, History,
  Clapperboard,
  type LucideIcon,
} from 'lucide-react';
import type { SidebarSection, HomeTab, OverviewTab } from '@/lib/types/types';
import type { SubNavItem } from './SidebarSubNav';
import { type Tier, TIERS, isTierVisible } from '@/lib/constants/uiModes';

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

export const sections: SectionDef[] = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'overview', icon: BarChart3, label: 'Overview' },
  { id: 'goals', icon: Target, label: 'Goals', minTier: TIERS.TEAM },
  { id: 'personas', icon: Bot, label: 'Agents' },
  { id: 'events', icon: Radio, label: 'Events', minTier: TIERS.TEAM },
  { id: 'credentials', icon: Key, label: 'Connections' },
  { id: 'design-reviews', icon: FlaskConical, label: 'Templates' },
  { id: 'plugins', icon: Puzzle, label: 'Plugins', minTier: TIERS.TEAM },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

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

  { id: 'health', icon: Heart, label: 'Health' },
  { id: 'director', icon: Clapperboard, label: 'Director', minTier: TIERS.TEAM },
  { id: 'leaderboard', icon: Trophy, label: 'Leaderboard' },
];

export const credentialItems: SubNavItem[] = [
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'databases', label: 'Databases', icon: Database, minTier: TIERS.TEAM },
  { id: 'from-template', label: 'Catalog', icon: LayoutTemplate },
  { id: 'graph', label: 'Dependencies', icon: Network },
  { id: 'add-new', label: 'Add new', icon: Plus },
];

/** Goals L2 sub-nav — Board/Map are live; Timeline/Portfolio/Attention scaffolded. */
export const goalItems: SubNavItem[] = [
  { id: 'board', label: 'Board', icon: LayoutDashboard },
  { id: 'map', label: 'Map', icon: Waypoints },
  { id: 'timeline', label: 'Timeline', icon: CalendarClock },
  { id: 'portfolio', label: 'Portfolio', icon: Layers },
  { id: 'attention', label: 'Attention', icon: AlertOctagon },
];

export const eventBusItems: SubNavItem[] = [
  { id: 'live-stream', label: 'Live Stream', icon: Activity },
  { id: 'builder', label: 'Builder', icon: Network },
  { id: 'rate-limits', label: 'Speed Limits', icon: Gauge },
  { id: 'test', label: 'Test', icon: Zap },
  { id: 'smee-relay', label: 'Local Relay', icon: Unplug },
  { id: 'cloud-webhooks', label: 'Cloud Events', icon: Webhook, devOnly: true },
  { id: 'dead-letter', label: 'Dead Letter Queue', icon: Archive, devOnly: true },
  { id: 'studio', label: 'Chain Studio', icon: GitBranch, devOnly: true },
  { id: 'lineage', label: 'Lineage', icon: Workflow },
  { id: 'shared', label: 'Marketplace', icon: Store, devOnly: true },
];

export const templateItems: SubNavItem[] = [
  { id: 'n8n', label: 'n8n Import', icon: Upload, minTier: TIERS.TEAM },
  { id: 'generated', label: 'Generated', icon: List },
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
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'lifecycle', label: 'Lifecycle', icon: GitBranch },
  { id: 'context-map', label: 'Context Map', icon: Map },
  { id: 'idea-scanner', label: 'Idea Scanner', icon: Lightbulb },
  { id: 'idea-triage', label: 'Idea Triage', icon: ArrowLeftRight },
  { id: 'task-runner', label: 'Task Runner', icon: Play },
  // Fleet — Claude Code session aggregator for the active project.
  // Inherits the active project's root_path as the spawn cwd. Not
  // tier-gated here because the PluginsSidebarNav devToolsItems map
  // doesn't apply tier/dev filtering today; the underlying Rust module
  // always compiles so showing it is safe across builds.
  { id: 'fleet', label: 'Fleet', icon: Terminal },
];

export const twinItems: SubNavItem[] = [
  { id: 'profiles', label: 'Profiles', icon: Sparkles },
  { id: 'identity', label: 'Identity', icon: User },
  { id: 'tone', label: 'Tone', icon: Mic },
  { id: 'brain', label: 'Brain', icon: Brain },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'voice', label: 'Voice', icon: Volume2 },
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
export const obsidianBrainItems: SubNavItem[] = [
  { id: 'setup',  label: 'Setup',        icon: Settings },
  { id: 'sync',   label: 'Sync',         icon: RefreshCw },
  { id: 'browse', label: 'Browse Vault', icon: FolderOpen },
  { id: 'graph',  label: 'Graph',        icon: Network },
  { id: 'cloud',  label: 'Cloud',        icon: Cloud },
];

export function getSettingsItems(isDev: boolean, activeTier?: Tier): SubNavItem[] {
  const tier = activeTier ?? TIERS.TEAM;
  return [
    { id: 'account', label: 'Account', icon: Globe },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'engine', label: 'Engine', icon: Cpu, devOnly: true },
    { id: 'byom', label: 'Custom Models', icon: Network, devOnly: true },
    { id: 'portability', label: 'Data', icon: HardDriveDownload, minTier: TIERS.TEAM },
    { id: 'limits', label: 'Limits', icon: Gauge, minTier: TIERS.TEAM },
    { id: 'api-keys', label: 'API Keys', icon: Key, minTier: TIERS.TEAM },
    { id: 'network', label: 'Network', icon: Share2, devOnly: true },
    { id: 'config', label: 'Config Resolution', icon: Layers, devOnly: true },
    { id: 'history', label: 'History', icon: History, devOnly: true },
    { id: 'admin', label: 'Admin', icon: Shield, devOnly: true },
  ].filter((item) => {
    if (item.devOnly && !isDev) return false;
    const minTier = item.minTier ?? TIERS.STARTER;
    return isTierVisible(minTier, tier);
  });
}
