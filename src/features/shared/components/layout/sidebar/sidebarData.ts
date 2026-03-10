import {
  BarChart3, Bot, Zap, Key, Activity, ClipboardCheck, MessageSquare,
  FlaskConical, Users, Brain, Cloud, Plus, LayoutTemplate, Monitor, Upload,
  List, Settings, Chrome, Palette, Bell, GitBranch, LayoutDashboard, Cpu,
  Network, Database, Home, Compass, Shield, CalendarClock, HardDriveDownload,
  type LucideIcon,
} from 'lucide-react';
import type { SidebarSection, HomeTab, OverviewTab } from '@/lib/types/types';
import type { SubNavItem } from './SidebarSubNav';

export interface SectionDef {
  id: SidebarSection;
  icon: LucideIcon;
  label: string;
  devOnly?: boolean;
}

export const sections: SectionDef[] = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'overview', icon: BarChart3, label: 'Overview' },
  { id: 'personas', icon: Bot, label: 'Agents' },
  { id: 'events', icon: Zap, label: 'Events' },
  { id: 'credentials', icon: Key, label: 'Keys' },
  { id: 'design-reviews', icon: FlaskConical, label: 'Templates' },
  { id: 'team', icon: Users, label: 'Teams', devOnly: true },
  { id: 'cloud', icon: Cloud, label: 'Cloud', devOnly: true },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export const homeItems: Array<{ id: HomeTab; icon: LucideIcon; label: string }> = [
  { id: 'welcome', icon: Compass, label: 'Welcome' },
  { id: 'system-check', icon: Monitor, label: 'System Check' },
];

export const overviewItems: Array<{ id: OverviewTab; icon: LucideIcon; label: string }> = [
  { id: 'home', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'executions', icon: Activity, label: 'Executions' },
  { id: 'manual-review', icon: ClipboardCheck, label: 'Manual Review' },
  { id: 'messages', icon: MessageSquare, label: 'Messages' },
  { id: 'events', icon: Zap, label: 'Events' },
  { id: 'knowledge', icon: Brain, label: 'Knowledge' },
  { id: 'sla', icon: Shield, label: 'SLA' },
  { id: 'cron-agents', icon: Cpu, label: 'Cron Agents' },
  { id: 'schedules', icon: CalendarClock, label: 'Schedules' },
];

export const credentialItems: SubNavItem[] = [
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'databases', label: 'Databases', icon: Database },
  { id: 'from-template', label: 'Catalog', icon: LayoutTemplate },
  { id: 'add-new', label: 'Add new', icon: Plus },
];

export const templateItems: SubNavItem[] = [
  { id: 'n8n', label: 'n8n Import', icon: Upload },
  { id: 'generated', label: 'Generated', icon: List },
];

export const cloudItems: SubNavItem[] = [
  { id: 'unified', label: 'All Deployments', icon: LayoutDashboard },
  { id: 'cloud', label: 'Cloud Execution', icon: Cloud },
  { id: 'gitlab', label: 'GitLab', icon: GitBranch },
];

export function getSettingsItems(isDev: boolean): SubNavItem[] {
  return [
    { id: 'account', label: 'Account', icon: Chrome },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'engine', label: 'Engine', icon: Cpu, devOnly: true },
    { id: 'byom', label: 'BYOM', icon: Network, devOnly: true },
    { id: 'portability', label: 'Data', icon: HardDriveDownload },
    { id: 'admin', label: 'Admin', icon: Shield, devOnly: true },
  ].filter((item) => !item.devOnly || isDev);
}
