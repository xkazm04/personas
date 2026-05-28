/**
 * Agent Icon Catalog
 *
 * Registry of built-in agent icons with dark/light theme variants.
 * Icons are stored as WebP in /public/agent_icons/{id}-dark.webp and {id}-light.webp.
 * The hot renderer uses a generated WebP sprite sheet; the per-id WebP path
 * stays around for grid pickers and the (effectively-unreachable) sprite-miss
 * fallback. WebP shaves ~7x off the per-icon byte count vs the prior PNGs.
 *
 * Convention:
 *   persona.icon = "agent-icon:{id}"   (e.g. "agent-icon:code")
 *   Rendering resolves to the correct variant based on current theme mode.
 */

import { AGENT_ICON_SPRITES } from './agentIconSprite.generated';

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
  { id: 'sales',        label: 'Sales',         categories: ['sales', 'ecommerce'],          suggestedColor: '#fb923c' },
  { id: 'hr',           label: 'HR',            categories: ['hr'],                          suggestedColor: '#4ade80' },
  { id: 'legal',        label: 'Legal',         categories: ['legal'],                       suggestedColor: '#94a3b8' },
  { id: 'notification', label: 'Notification',  categories: ['notification', 'alerts'],      suggestedColor: '#fbbf24' },
  { id: 'calendar',     label: 'Calendar',      categories: ['project_management', 'scheduling'], suggestedColor: '#2dd4bf' },
  { id: 'search',       label: 'Search',        categories: ['research', 'intelligence'],    suggestedColor: '#818cf8' },
  // System-owned Director meta-persona. `director` is not a template category,
  // so this icon is never auto-assigned — it's set explicitly on the Director.
  { id: 'director',     label: 'Director',      categories: ['director'],                     suggestedColor: '#8b5cf6' },
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

/** Resolve the public path to an agent icon WebP for the given theme mode. */
export function agentIconPath(id: string, mode: 'dark' | 'light'): string {
  return `/agent_icons/${id}-${mode}.webp`;
}

/** Get the correct icon path from a full agent-icon value and theme mode. */
export function resolveAgentIconSrc(icon: string, isDark: boolean): string {
  const id = parseAgentIconId(icon);
  return agentIconPath(id, isDark ? 'dark' : 'light');
}

export function resolveAgentIconSprite(icon: string, isDark: boolean) {
  const id = parseAgentIconId(icon);
  const sprite = AGENT_ICON_SPRITES[isDark ? 'dark' : 'light'];
  const index = sprite.cells[id as keyof typeof sprite.cells];
  if (index === undefined) return null;
  return {
    src: sprite.src,
    columns: sprite.columns,
    index,
  };
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

// Keyword → icon ID mapping (most specific first). Used as a secondary signal
// when a template's category alone is too coarse — e.g. ~24 templates declare
// only "productivity" yet their purpose is clearly email/calendar/automation.
// Mirrors the heuristics in `autoAssignIcons.ts` so adoption-time inference
// agrees with the migration pass that runs on first launch.
const KEYWORD_MAP: Array<{ keywords: string[]; iconId: string }> = [
  { keywords: ['email', 'inbox', 'mail', 'digest', 'newsletter'],                          iconId: 'email' },
  { keywords: ['calendar', 'schedule', 'meeting', 'appointment', 'standup', 'deadline'],  iconId: 'calendar' },
  { keywords: ['security', 'vulnerability', 'access', 'sentinel'],                         iconId: 'security' },
  { keywords: ['devops', 'sentry', 'infrastructure', 'deploy', 'incident', 'pipeline'],   iconId: 'devops' },
  { keywords: ['monitor', 'alert', 'health', 'performance', 'watchdog'],                   iconId: 'monitor' },
  { keywords: ['code', 'developer', 'codebase', 'ci/cd', 'qa', 'test', 'feature flag', 'git'], iconId: 'code' },
  { keywords: ['document', 'documentation', 'knowledge base', 'wiki', 'journal'],          iconId: 'document' },
  { keywords: ['support', 'helpdesk', 'ticket', 'escalation'],                             iconId: 'support' },
  { keywords: ['automat', 'workflow', 'orchestrat', 'router'],                              iconId: 'automation' },
  { keywords: ['research', 'intelligence', 'analyst', 'insight', 'scout', 'survey'],       iconId: 'research' },
  { keywords: ['finance', 'invoice', 'expense', 'budget', 'billing', 'revenue', 'accounting', 'payment'], iconId: 'finance' },
  { keywords: ['marketing', 'brand', 'campaign', 'seo'],                                    iconId: 'marketing' },
  { keywords: ['content', 'editorial', 'video', 'writer', 'blog'],                          iconId: 'content' },
  { keywords: ['sales', 'lead', 'crm', 'deal', 'proposal', 'outbound'],                    iconId: 'sales' },
  { keywords: ['hr', 'recruit', 'onboard', 'hiring', 'employee', 'people'],                 iconId: 'hr' },
  { keywords: ['legal', 'contract', 'compliance', 'regulation', 'policy'],                  iconId: 'legal' },
  { keywords: ['notification', 'event', 'webhook'],                                          iconId: 'notification' },
  { keywords: ['search', 'find', 'discover', 'explore', 'lookup'],                          iconId: 'search' },
  { keywords: ['data', 'analytics', 'database', 'chart', 'metric', 'dashboard'],            iconId: 'data' },
];

/**
 * Resolve the best agent icon ID for a template, blending three signals:
 *   1. Categories that have a 1:1 mapping (sales, finance, legal, …) win first.
 *   2. Otherwise, keyword inference from name+description picks a specific icon.
 *   3. Fall back to the category mapping (productivity → assistant) when no
 *      keyword fires, and finally to 'assistant'.
 *
 * Adoption uses this so an "email-morning-digest" template categorized only
 * as "productivity" gets the email icon instead of the generic assistant.
 */
export function iconIdForTemplate(
  categories: string[],
  name?: string | null,
  description?: string | null,
): string {
  // First pass: any category other than 'productivity' (which is the catch-all
  // bucket that maps to 'assistant') gets to claim the icon — we trust the
  // template author when they tag with something specific.
  for (const cat of categories) {
    if (cat === 'productivity') continue;
    const match = CATEGORY_TO_ICON[cat];
    if (match) return match;
  }
  // Second pass: keyword inference from name + description.
  const text = `${name ?? ''} ${description ?? ''}`.toLowerCase();
  if (text.trim()) {
    for (const rule of KEYWORD_MAP) {
      if (rule.keywords.some((kw) => text.includes(kw))) return rule.iconId;
    }
  }
  // Third pass: 'productivity' (or whatever was left) → assistant.
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
