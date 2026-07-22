import { Monitor, Cloud, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const SECTION_ICONS: Record<string, LucideIcon> = {
  local: Monitor,
  cloud: Cloud,
  account: User,
};

export const SECTION_STYLES: Record<string, { badge: string; icon: string }> = {
  local: { badge: 'bg-violet-500/10', icon: 'text-violet-400' },
  cloud: { badge: 'bg-sky-500/10', icon: 'text-sky-400' },
  account: { badge: 'bg-amber-500/10', icon: 'text-amber-400' },
};

export const DEFAULT_SECTION_STYLE = { badge: 'bg-violet-500/10', icon: 'text-violet-400' };

/** Skeleton section stubs -- rendered immediately while backend check runs.
 *  MUST cover every id in useHealthChecks' CHECKS list: this list drifted to
 *  3 of the 6 fetched sections, so environment/agents/subscriptions were
 *  fetched and thrown away every refresh — 3 wasted IPC round-trips, warning
 *  banners for issues the user couldn't see, and the Ollama/LiteLLM
 *  configure buttons (which live in the agents section) were unreachable. */
export const SKELETON_SECTIONS = [
  { id: 'local', label: 'Local Environment' },
  { id: 'environment', label: 'Environment' },
  { id: 'agents', label: 'Agents' },
  { id: 'cloud', label: 'Cloud Deployment' },
  { id: 'account', label: 'Account' },
  { id: 'subscriptions', label: 'Subscription Health' },
];
