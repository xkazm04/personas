/**
 * Agent Icon Catalog
 *
 * Registry of built-in agent icons with dark/light theme variants.
 * Icons are stored as PNGs in /public/agent_icons/{id}-dark.png and {id}-light.png.
 *
 * Convention:
 *   persona.icon = "agent-icon:{id}"   (e.g. "agent-icon:code")
 *   Rendering resolves to the correct variant based on current theme mode.
 */

export interface AgentIconEntry {
  id: string;
  label: string;
  /** Template directory categories this icon covers */
  categories: string[];
  /** Hex color suggestion when this icon is auto-assigned */
  suggestedColor: string;
}

// ── Icon Definitions ──────────────────────────────────────────────────────────

export const AGENT_ICONS: AgentIconEntry[] = [
  { id: 'assistant',    label: 'Assistant',     categories: ['productivity'],                suggestedColor: '#8b5cf6' },
  { id: 'code',         label: 'Code',          categories: ['development'],                 suggestedColor: '#06b6d4' },
  { id: 'data',         label: 'Data',          categories: ['data', 'analytics'],           suggestedColor: '#3b82f6' },
  { id: 'security',     label: 'Security',      categories: ['security'],                    suggestedColor: '#ef4444' },
  { id: 'monitor',      label: 'Monitor',       categories: ['monitoring', 'devops'],        suggestedColor: '#f59e0b' },
  { id: 'email',        label: 'Email',         categories: ['email', 'communication'],      suggestedColor: '#ec4899' },
  { id: 'document',     label: 'Document',      categories: ['content', 'productivity'],     suggestedColor: '#a78bfa' },
  { id: 'support',      label: 'Support',       categories: ['support'],                     suggestedColor: '#14b8a6' },
  { id: 'automation',   label: 'Automation',     categories: ['automation', 'workflow'],      suggestedColor: '#f97316' },
  { id: 'research',     label: 'Research',      categories: ['research'],                    suggestedColor: '#6366f1' },
  { id: 'finance',      label: 'Finance',       categories: ['finance'],                     suggestedColor: '#22c55e' },
  { id: 'marketing',    label: 'Marketing',     categories: ['marketing'],                   suggestedColor: '#e879f9' },
  { id: 'devops',       label: 'DevOps',        categories: ['devops', 'infrastructure'],    suggestedColor: '#0ea5e9' },
  { id: 'content',      label: 'Content',       categories: ['content'],                     suggestedColor: '#c084fc' },
  { id: 'sales',        label: 'Sales',         categories: ['sales'],                       suggestedColor: '#fb923c' },
  { id: 'hr',           label: 'HR',            categories: ['hr'],                          suggestedColor: '#4ade80' },
  { id: 'legal',        label: 'Legal',         categories: ['legal'],                       suggestedColor: '#94a3b8' },
  { id: 'notification', label: 'Notification',  categories: ['notification', 'alerts'],      suggestedColor: '#fbbf24' },
  { id: 'calendar',     label: 'Calendar',      categories: ['project-management', 'scheduling'], suggestedColor: '#2dd4bf' },
  { id: 'search',       label: 'Search',        categories: ['research', 'intelligence'],    suggestedColor: '#818cf8' },
];

// ── Prefix Convention ─────────────────────────────────────────────────────────

export const AGENT_ICON_PREFIX = 'agent-icon:';

/** Check if a persona icon value is an agent-icon reference. */
export function isAgentIcon(icon: string | null | undefined): boolean {
  return typeof icon === 'string' && icon.startsWith(AGENT_ICON_PREFIX);
}

/** Extract the icon ID from an agent-icon value (e.g. "agent-icon:code" → "code"). */
export function parseAgentIconId(icon: string): string {
  return icon.slice(AGENT_ICON_PREFIX.length);
}

/** Build the agent-icon value from an icon ID. */
export function toAgentIconValue(id: string): string {
  return `${AGENT_ICON_PREFIX}${id}`;
}

// ── Path Resolvers ────────────────────────────────────────────────────────────

/** Resolve the public path to an agent icon PNG for the given theme mode. */
export function agentIconPath(id: string, mode: 'dark' | 'light'): string {
  return `/agent_icons/${id}-${mode}.png`;
}

/** Get the correct icon path from a full agent-icon value and theme mode. */
export function resolveAgentIconSrc(icon: string, isDark: boolean): string {
  const id = parseAgentIconId(icon);
  return agentIconPath(id, isDark ? 'dark' : 'light');
}

// ── Category Mapping ──────────────────────────────────────────────────────────

/** Map from template directory name / category tag to best-matching icon ID. */
const CATEGORY_TO_ICON: Record<string, string> = {};
for (const entry of AGENT_ICONS) {
  for (const cat of entry.categories) {
    // First match wins — entries earlier in AGENT_ICONS have priority
    if (!CATEGORY_TO_ICON[cat]) {
      CATEGORY_TO_ICON[cat] = entry.id;
    }
  }
}

/**
 * Given a list of template categories (e.g. ["content", "productivity"]),
 * return the best-matching agent icon ID, or 'assistant' as fallback.
 */
export function iconIdForCategories(categories: string[]): string {
  for (const cat of categories) {
    const match = CATEGORY_TO_ICON[cat];
    if (match) return match;
  }
  return 'assistant';
}

/** Look up an icon entry by ID. */
export function getAgentIconEntry(id: string): AgentIconEntry | undefined {
  return AGENT_ICONS.find((e) => e.id === id);
}
