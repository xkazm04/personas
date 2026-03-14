import {
  BarChart3, Bot, Zap, Key, Activity, ClipboardCheck, MessageSquare,
  FlaskConical, Users, Brain, Cloud, Plus, LayoutTemplate, Monitor, Upload,
  List, Settings, Chrome, Palette, Bell, GitBranch, LayoutDashboard, Cpu,
  Network, Database, Home, Compass, Shield, CalendarClock, HardDriveDownload,
  Wrench, FolderKanban, Map, Lightbulb, ArrowLeftRight, Play, Share2,
  type LucideIcon,
} from 'lucide-react';
import type { SidebarSection, HomeTab, OverviewTab } from '@/lib/types/types';
import type { SubNavItem } from './SidebarSubNav';

export interface SectionDef {
  id: SidebarSection;
  icon: LucideIcon;
  label: string;
  devOnly?: boolean;
  simpleHidden?: boolean;
  devModeOnly?: boolean;
}

export const sections: SectionDef[] = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'overview', icon: BarChart3, label: 'Overview' },
  { id: 'personas', icon: Bot, label: 'Agents' },
  { id: 'events', icon: Zap, label: 'Events', simpleHidden: true },
  { id: 'credentials', icon: Key, label: 'Keys' },
  { id: 'design-reviews', icon: FlaskConical, label: 'Templates' },
  { id: 'team', icon: Users, label: 'Teams', devOnly: true, simpleHidden: true },
  { id: 'cloud', icon: Cloud, label: 'Cloud', devOnly: true, simpleHidden: true },
  { id: 'dev-tools', icon: Wrench, label: 'Dev Tools', devModeOnly: true },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export const homeItems: Array<{ id: HomeTab; icon: LucideIcon; label: string }> = [
  { id: 'welcome', icon: Compass, label: 'Welcome' },
  ...(import.meta.env.DEV ? [{ id: 'system-check' as HomeTab, icon: Monitor, label: 'System Check' }] : []),
];

export const overviewItems: Array<{ id: OverviewTab; icon: LucideIcon; label: string; simpleHidden?: boolean }> = [
  { id: 'home', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'executions', icon: Activity, label: 'Executions', simpleHidden: true },
  { id: 'manual-review', icon: ClipboardCheck, label: 'Manual Review', simpleHidden: true },
  { id: 'messages', icon: MessageSquare, label: 'Messages' },
  { id: 'events', icon: Zap, label: 'Events', simpleHidden: true },
  { id: 'knowledge', icon: Brain, label: 'Knowledge', simpleHidden: true },
  { id: 'sla', icon: Shield, label: 'SLA', simpleHidden: true },
  { id: 'schedules', icon: CalendarClock, label: 'Schedules', simpleHidden: true },
];

export const credentialItems: SubNavItem[] = [
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'databases', label: 'Databases', icon: Database, simpleHidden: true },
  { id: 'from-template', label: 'Catalog', icon: LayoutTemplate, simpleHidden: true },
  { id: 'add-new', label: 'Add new', icon: Plus },
];

export const templateItems: SubNavItem[] = [
  { id: 'n8n', label: 'n8n Import', icon: Upload, simpleHidden: true },
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

export function getSettingsItems(isDev: boolean, isSimple = false): SubNavItem[] {
  return [
    { id: 'account', label: 'Account', icon: Chrome },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'engine', label: 'Engine', icon: Cpu, devOnly: true },
    { id: 'byom', label: 'BYOM', icon: Network, devOnly: true },
    { id: 'portability', label: 'Data', icon: HardDriveDownload, simpleHidden: true },
    { id: 'network', label: 'Network', icon: Share2 },
    { id: 'admin', label: 'Admin', icon: Shield, devOnly: true },
  ].filter((item) => (!item.devOnly || isDev) && (!isSimple || !item.simpleHidden));
}
