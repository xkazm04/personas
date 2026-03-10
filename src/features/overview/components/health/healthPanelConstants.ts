import { Monitor, Cpu, Cloud, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const SECTION_ICONS: Record<string, LucideIcon> = {
  local: Monitor,
  agents: Cpu,
  cloud: Cloud,
  account: User,
};

export const SECTION_STYLES: Record<string, { badge: string; icon: string }> = {
  local: { badge: 'bg-violet-500/10', icon: 'text-violet-300' },
  agents: { badge: 'bg-emerald-500/10', icon: 'text-emerald-300' },
  cloud: { badge: 'bg-sky-500/10', icon: 'text-sky-300' },
  account: { badge: 'bg-amber-500/10', icon: 'text-amber-300' },
};

export const DEFAULT_SECTION_STYLE = { badge: 'bg-violet-500/10', icon: 'text-violet-300' };

/** Skeleton section stubs -- rendered immediately while backend check runs. */
export const SKELETON_SECTIONS = [
  { id: 'local', label: 'Local Environment' },
  { id: 'agents', label: 'Agents' },
  { id: 'cloud', label: 'Cloud Deployment' },
  { id: 'account', label: 'Account' },
];
