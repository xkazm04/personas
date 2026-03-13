import type { Persona } from '@/lib/types/types';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { extractConnectorNames } from '@/lib/personas/utils';

// -- Smart Tag Types --------------------------------------------------

export type TagCategory = 'status' | 'model' | 'health' | 'recency' | 'auto';

export interface SmartTag {
  id: string;
  label: string;
  color: string;
  category: TagCategory;
  /** Whether this tag was auto-generated (vs user-defined) */
  auto: boolean;
}

// -- Tag Vocabulary ---------------------------------------------------

const STATUS_TAGS: SmartTag[] = [
  { id: 'status:enabled', label: 'Enabled', color: '#10B981', category: 'status', auto: false },
  { id: 'status:disabled', label: 'Disabled', color: '#6B7280', category: 'status', auto: false },
];

const MODEL_TAGS: SmartTag[] = [
  { id: 'model:anthropic', label: 'Anthropic', color: '#D97706', category: 'model', auto: false },
  { id: 'model:ollama', label: 'Ollama', color: '#3B82F6', category: 'model', auto: false },
  { id: 'model:litellm', label: 'LiteLLM', color: '#8B5CF6', category: 'model', auto: false },
  { id: 'model:custom', label: 'Custom', color: '#EC4899', category: 'model', auto: false },
  { id: 'model:default', label: 'Default', color: '#6B7280', category: 'model', auto: false },
];

const HEALTH_TAGS: SmartTag[] = [
  { id: 'health:healthy', label: 'Healthy', color: '#10B981', category: 'health', auto: false },
  { id: 'health:degraded', label: 'Degraded', color: '#F59E0B', category: 'health', auto: false },
  { id: 'health:failing', label: 'Failing', color: '#EF4444', category: 'health', auto: false },
  { id: 'health:dormant', label: 'Dormant', color: '#6B7280', category: 'health', auto: false },
  { id: 'health:needs-attention', label: 'Needs Attention', color: '#F59E0B', category: 'health', auto: false },
];

const RECENCY_TAGS: SmartTag[] = [
  { id: 'recency:today', label: 'Today', color: '#10B981', category: 'recency', auto: false },
  { id: 'recency:week', label: 'This Week', color: '#3B82F6', category: 'recency', auto: false },
  { id: 'recency:month', label: 'This Month', color: '#8B5CF6', category: 'recency', auto: false },
  { id: 'recency:stale', label: 'Stale', color: '#F59E0B', category: 'recency', auto: false },
  { id: 'recency:never_run', label: 'Never Run', color: '#6B7280', category: 'recency', auto: false },
];

/** All dimension tags (non-auto) grouped by category */
export const TAG_GROUPS: { category: TagCategory; label: string; tags: SmartTag[] }[] = [
  { category: 'status', label: 'Status', tags: STATUS_TAGS },
  { category: 'model', label: 'Model', tags: MODEL_TAGS },
  { category: 'health', label: 'Health', tags: HEALTH_TAGS },
  { category: 'recency', label: 'Recency', tags: RECENCY_TAGS },
];

// -- Persona Run State -------------------------------------------------
export type PersonaRunState = 'never_run' | 'active' | 'stale';

export function getPersonaRunState(lastRun: string | null | undefined, staleDays: number): PersonaRunState {
  if (!lastRun) return 'never_run';
  const last = new Date(lastRun).getTime();
  if (isNaN(last)) return 'never_run';
  return Date.now() - last > staleDays * 86_400_000 ? 'stale' : 'active';
}

// -- Filter State -----------------------------------------------------

export interface FilterState {
  search: string;
  tags: Set<string>;
}

export const defaultFilters: FilterState = { search: '', tags: new Set() };

// -- Parse model profile ----------------------------------------------

function parseModelProfile(persona: Persona): ModelProfile | null {
  if (!persona.model_profile) return null;
  try {
    return JSON.parse(persona.model_profile) as ModelProfile;
  } catch {
    return null;
  }
}

function getProviderLabel(persona: Persona): string {
  const mp = parseModelProfile(persona);
  if (!mp?.provider) return 'default';
  return mp.provider;
}

// -- Compute all tags for a persona -----------------------------------

export function computePersonaTags(
  persona: Persona,
  health: PersonaHealth | undefined,
  lastRun: string | null | undefined,
): Set<string> {
  const tags = new Set<string>();
  const now = Date.now();

  tags.add(persona.enabled ? 'status:enabled' : 'status:disabled');
  tags.add(`model:${getProviderLabel(persona)}`);

  const healthStatus = health?.status ?? 'dormant';
  tags.add(`health:${healthStatus}`);
  const runState = getPersonaRunState(lastRun, 7);
  if (
    (health && (health.status === 'failing' || health.status === 'degraded')) ||
    runState === 'stale'
  ) {
    tags.add('health:needs-attention');
  }

  if (runState === 'never_run') {
    tags.add('recency:never_run');
  } else if (runState === 'stale') {
    tags.add('recency:stale');
  } else if (lastRun) {
    const last = new Date(lastRun).getTime();
    const age = now - last;
    if (age <= 86_400_000) tags.add('recency:today');
    if (age <= 7 * 86_400_000) tags.add('recency:week');
    if (age <= 30 * 86_400_000) tags.add('recency:month');
  }

  const connectors = extractConnectorNames(persona, 10);
  for (const name of connectors) {
    const lower = name.toLowerCase();
    if (lower.includes('slack')) tags.add('auto:slack');
    else if (lower.includes('github')) tags.add('auto:github');
    else if (lower.includes('jira')) tags.add('auto:jira');
    else if (lower.includes('linear')) tags.add('auto:linear');
    else if (lower.includes('notion')) tags.add('auto:notion');
    else if (lower.includes('discord')) tags.add('auto:discord');
    else if (lower.includes('supabase')) tags.add('auto:supabase');
    else if (lower.includes('postgres') || lower.includes('sql')) tags.add('auto:database');
    else tags.add(`auto:${lower}`);
  }

  if (runState === 'never_run') tags.add('auto:never-run');
  if (tags.has('health:needs-attention')) tags.add('auto:needs-attention');

  return tags;
}

// -- Auto tag metadata ------------------------------------------------

const AUTO_TAG_META: Record<string, { label: string; color: string }> = {
  'auto:slack': { label: 'slack', color: '#4A154B' },
  'auto:github': { label: 'github', color: '#238636' },
  'auto:jira': { label: 'jira', color: '#0052CC' },
  'auto:linear': { label: 'linear', color: '#5E6AD2' },
  'auto:notion': { label: 'notion', color: '#000000' },
  'auto:discord': { label: 'discord', color: '#5865F2' },
  'auto:supabase': { label: 'supabase', color: '#3FCF8E' },
  'auto:database': { label: 'database', color: '#336791' },
  'auto:never-run': { label: 'never run', color: '#6B7280' },
  'auto:needs-attention': { label: 'needs attention', color: '#EF4444' },
};

export function resolveAutoTag(id: string): SmartTag {
  const meta = AUTO_TAG_META[id];
  return {
    id,
    label: meta?.label ?? id.replace('auto:', ''),
    color: meta?.color ?? '#6B7280',
    category: 'auto',
    auto: true,
  };
}
