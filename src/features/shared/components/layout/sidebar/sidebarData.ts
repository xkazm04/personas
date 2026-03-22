import {
  BarChart3, Bot, Zap, Key, Activity, ClipboardCheck, MessageSquare,
  FlaskConical, Brain, Cloud, Plus, LayoutTemplate, Monitor, Upload,
  List, Settings, Chrome, Palette, Bell, GitBranch, LayoutDashboard, Cpu,
  Network, Database, Home, Compass, Shield, CalendarClock, HardDriveDownload, Heart,
  FolderKanban, Map, Lightbulb, ArrowLeftRight, Play, Share2,
  Radio, Gauge, Unplug, Webhook, Puzzle,
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
  { id: 'personas', icon: Bot, label: 'Agents' },
  { id: 'events', icon: Radio, label: 'Events', minTier: TIERS.TEAM },
  { id: 'credentials', icon: Key, label: 'Keys' },
  { id: 'design-reviews', icon: FlaskConical, label: 'Templates' },
  { id: 'plugins', icon: Puzzle, label: 'Plugins' },
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
  ...(import.meta.env.DEV ? [{ id: 'system-check' as HomeTab, icon: Monitor, label: 'System Check' }] : []),
];

export const overviewItems: Array<{ id: OverviewTab; icon: LucideIcon; label: string; minTier?: Tier; simpleHidden?: boolean }> = [
  { id: 'home', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'executions', icon: Activity, label: 'Executions', minTier: TIERS.TEAM },
  { id: 'manual-review', icon: ClipboardCheck, label: 'Manual Review', minTier: TIERS.TEAM },
  { id: 'messages', icon: MessageSquare, label: 'Messages' },
  { id: 'events', icon: Zap, label: 'Events', minTier: TIERS.TEAM },
  { id: 'knowledge', icon: Brain, label: 'Knowledge', minTier: TIERS.TEAM },
  { id: 'sla', icon: Shield, label: 'SLA', minTier: TIERS.TEAM },
  { id: 'schedules', icon: CalendarClock, label: 'Schedules', minTier: TIERS.TEAM },
  { id: 'health', icon: Heart, label: 'Health' },
];

export const credentialItems: SubNavItem[] = [
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'databases', label: 'Databases', icon: Database, minTier: TIERS.TEAM },
  { id: 'from-template', label: 'Catalog', icon: LayoutTemplate, minTier: TIERS.TEAM },
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'add-new', label: 'Add new', icon: Plus },
];

export const eventBusItems: SubNavItem[] = [
  { id: 'live-stream', label: 'Live Stream', icon: Activity },
  { id: 'rate-limits', label: 'Throttling', icon: Gauge },
  { id: 'test', label: 'Test', icon: Zap },
  { id: 'smee-relay', label: 'Local Relay', icon: Unplug },
  { id: 'cloud-webhooks', label: 'Cloud Events', icon: Webhook },
];

export const templateItems: SubNavItem[] = [
  { id: 'n8n', label: 'n8n Import', icon: Upload, minTier: TIERS.TEAM },
  { id: 'generated', label: 'Generated', icon: List },
];

export const devToolsItems: SubNavItem[] = [
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'context-map', label: 'Context Map', icon: Map },
  { id: 'idea-scanner', label: 'Idea Scanner', icon: Lightbulb },
  { id: 'idea-triage', label: 'Idea Triage', icon: ArrowLeftRight },
  { id: 'task-runner', label: 'Task Runner', icon: Play },
];

export const cloudItems: SubNavItem[] = [
  { id: 'unified', label: 'All Deployments', icon: LayoutDashboard },
  { id: 'cloud', label: 'Cloud Execution', icon: Cloud },
  { id: 'gitlab', label: 'GitLab', icon: GitBranch },
];

export function getSettingsItems(isDev: boolean, activeTier?: Tier): SubNavItem[] {
  const tier = activeTier ?? TIERS.TEAM;
  return [
    { id: 'account', label: 'Account', icon: Chrome },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'engine', label: 'Engine', icon: Cpu, devOnly: true },
    { id: 'byom', label: 'BYOM', icon: Network, devOnly: true },
    { id: 'portability', label: 'Data', icon: HardDriveDownload, minTier: TIERS.TEAM },
    { id: 'network', label: 'Network', icon: Share2, devOnly: true },
    { id: 'admin', label: 'Admin', icon: Shield, devOnly: true },
  ].filter((item) => {
    if (item.devOnly && !isDev) return false;
    const minTier = item.minTier ?? TIERS.STARTER;
    return isTierVisible(minTier, tier);
  });
}
