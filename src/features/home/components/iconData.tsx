import {
  Home, BarChart3, Bot, Zap, Key, FlaskConical, Users, Cloud, Settings,
} from 'lucide-react';
import {
  CustomHome, CustomOverview, CustomAgents, CustomEvents, CustomKeys,
  CustomTemplates, CustomTeams, CustomCloud, CustomSettings,
} from './CustomIcons';

// ── Types ────────────────────────────────────────────────────────────────

export interface IconEntry {
  id: string;
  label: string;
  desc: string;
  lucide: React.ReactNode;
  custom: React.ReactNode;
}

export type IconMode = 'lucide' | 'custom';

// ── Data ────────────────────────────────────────────────────────────────

export const ICONS: IconEntry[] = [
  { id: 'home', label: 'Home', desc: 'Command hub', lucide: <Home className="w-full h-full" />, custom: <CustomHome /> },
  { id: 'overview', label: 'Overview', desc: 'HUD panels', lucide: <BarChart3 className="w-full h-full" />, custom: <CustomOverview /> },
  { id: 'agents', label: 'Agents', desc: 'Neural face', lucide: <Bot className="w-full h-full" />, custom: <CustomAgents /> },
  { id: 'events', label: 'Events', desc: 'Signal burst', lucide: <Zap className="w-full h-full" />, custom: <CustomEvents /> },
  { id: 'keys', label: 'Keys', desc: 'Quantum lock', lucide: <Key className="w-full h-full" />, custom: <CustomKeys /> },
  { id: 'templates', label: 'Templates', desc: 'Blueprint', lucide: <FlaskConical className="w-full h-full" />, custom: <CustomTemplates /> },
  { id: 'teams', label: 'Teams', desc: 'Constellation', lucide: <Users className="w-full h-full" />, custom: <CustomTeams /> },
  { id: 'cloud', label: 'Cloud', desc: 'Mesh network', lucide: <Cloud className="w-full h-full" />, custom: <CustomCloud /> },
  { id: 'settings', label: 'Settings', desc: 'Calibrator', lucide: <Settings className="w-full h-full" />, custom: <CustomSettings /> },
];
