import type { SidebarSection, CredentialMetadata } from '@/lib/types/types';
import type { Persona } from '@/lib/bindings/Persona';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';

// -- Types -------------------------------------------------------------

export type ResultKind = 'agent' | 'credential' | 'template' | 'automation' | 'navigation' | 'action' | 'agent-action';

export interface PaletteItem {
  id: string;
  kind: ResultKind;
  label: string;
  description?: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** When true, the palette stays open after selection (e.g. quick-edit). */
  staysOpen?: boolean;
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

// -- Item builders -----------------------------------------------------

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

export function credentialItem(
  c: CredentialMetadata,
  setSidebarSection: (s: SidebarSection) => void,
  icon: React.ReactNode,
): PaletteItem {
  return {
    id: `cred:${c.id}`,
    kind: 'credential',
    label: c.name,
    description: c.service_type,
    icon,
    onSelect: () => setSidebarSection('credentials'),
  };
}

export function templateItem(
  r: RecipeDefinition,
  setSidebarSection: (s: SidebarSection) => void,
  icon: React.ReactNode,
): PaletteItem {
  return {
    id: `template:${r.id}`,
    kind: 'template',
    label: r.name,
    description: r.category ?? undefined,
    icon,
    onSelect: () => setSidebarSection('design-reviews'),
  };
}

export function automationItem(
  a: PersonaAutomation,
  setSidebarSection: (s: SidebarSection) => void,
  icon: React.ReactNode,
): PaletteItem {
  return {
    id: `automation:${a.id}`,
    kind: 'automation',
    label: a.name,
    description: a.platform,
    icon,
    onSelect: () => setSidebarSection('events'),
  };
}

// -- Agent action builders (command mode) --------------------------------

export interface AgentActionCallbacks {
  onRun: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDuplicate: (id: string) => void;
  onHealthCheck: () => void;
  onNavigate: (id: string) => void;
  onQuickEdit: (id: string) => void;
}

export function agentActionItems(
  personas: Persona[],
  callbacks: AgentActionCallbacks,
  icons: {
    run: React.ReactNode;
    toggle: React.ReactNode;
    duplicate: React.ReactNode;
    health: React.ReactNode;
    edit: React.ReactNode;
  },
): PaletteItem[] {
  const items: PaletteItem[] = [];

  for (const p of personas) {
    items.push({
      id: `cmd:run:${p.id}`,
      kind: 'agent-action',
      label: `Run ${p.name}`,
      description: 'Execute ad-hoc',
      icon: icons.run,
      onSelect: () => callbacks.onRun(p.id),
    });
    items.push({
      id: `cmd:toggle:${p.id}`,
      kind: 'agent-action',
      label: `${p.enabled ? 'Disable' : 'Enable'} ${p.name}`,
      description: p.enabled ? 'Currently on' : 'Currently off',
      icon: icons.toggle,
      onSelect: () => callbacks.onToggle(p.id, !p.enabled),
    });
    items.push({
      id: `cmd:duplicate:${p.id}`,
      kind: 'agent-action',
      label: `Duplicate ${p.name}`,
      description: 'Clone agent',
      icon: icons.duplicate,
      onSelect: () => callbacks.onDuplicate(p.id),
    });
    items.push({
      id: `cmd:edit:${p.id}`,
      kind: 'agent-action',
      label: `Quick Edit ${p.name}`,
      description: 'Description & model',
      icon: icons.edit,
      onSelect: () => callbacks.onQuickEdit(p.id),
      staysOpen: true,
    });
    items.push({
      id: `cmd:open:${p.id}`,
      kind: 'agent-action',
      label: `Open ${p.name}`,
      description: 'Full editor',
      icon: icons.edit,
      onSelect: () => callbacks.onNavigate(p.id),
    });
  }

  // Global health check
  items.push({
    id: 'cmd:health-check',
    kind: 'agent-action',
    label: 'Run Health Check',
    description: 'System diagnostics',
    icon: icons.health,
    onSelect: () => callbacks.onHealthCheck(),
  });

  return items;
}

