import { Download, Database, Zap, Bell } from 'lucide-react';
import type { ComponentRole } from '../steps/types';

// -- Role icons ---------------------------------------------------------------

export const roleIcons: Record<ComponentRole, typeof Download> = {
  retrieve: Download,
  store: Database,
  act: Zap,
  notify: Bell,
};

export const roleColors: Record<ComponentRole, string> = {
  retrieve: 'from-blue-500/15 to-cyan-500/10 border-blue-500/20',
  store: 'from-amber-500/15 to-orange-500/10 border-amber-500/20',
  act: 'from-violet-500/15 to-purple-500/10 border-violet-500/20',
  notify: 'from-emerald-500/15 to-green-500/10 border-emerald-500/20',
};

export const roleIconColors: Record<ComponentRole, string> = {
  retrieve: 'text-blue-400',
  store: 'text-amber-400',
  act: 'text-violet-400',
  notify: 'text-emerald-400',
};

export const BUILTIN_CONNECTORS = new Set(['in-app-messaging', 'http']);
