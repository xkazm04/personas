import type { SidebarSection } from '@/lib/types/types';
import type { Persona } from '@/lib/bindings/Persona';

// -- Types -------------------------------------------------------------

export type ResultKind = 'agent' | 'navigation' | 'action';

export interface PaletteItem {
  id: string;
  kind: ResultKind;
  label: string;
  description?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

// -- Fuzzy match -------------------------------------------------------

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 80;
  let qi = 0;
  let gaps = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
    else if (qi > 0) gaps++;
  }
  return qi === q.length ? Math.max(10, 70 - gaps) : 0;
}

// -- Recent agents (session-scoped) ------------------------------------

const MAX_RECENT = 5;
let recentAgentIds: string[] = [];

export function trackRecent(id: string) {
  recentAgentIds = [id, ...recentAgentIds.filter(r => r !== id)].slice(0, MAX_RECENT);
}

export function getRecentAgentIds(): string[] {
  return recentAgentIds;
}

// -- Agent item builder ------------------------------------------------

export function agentItem(
  p: Persona,
  groupMap: Record<string, string>,
  selectPersona: (id: string) => void,
  setSidebarSection: (s: SidebarSection) => void,
  BotIcon: React.ReactNode,
  PowerIcon: React.ReactNode,
): PaletteItem {
  return {
    id: `agent:${p.id}`,
    kind: 'agent',
    label: p.name,
    description: p.group_id ? groupMap[p.group_id] : undefined,
    icon: p.enabled ? BotIcon : PowerIcon,
    onSelect: () => { setSidebarSection('personas'); selectPersona(p.id); },
  };
}
