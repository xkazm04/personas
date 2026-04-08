/**
 * Auto-assign agent icons to personas that don't have one.
 *
 * Runs once after initial persona load. Analyses name + description
 * to pick the best agent-icon alias, then persists via updatePersona.
 */
import type { Persona } from '@/lib/bindings/Persona';
import { updatePersona } from '@/api/agents/personas';
import { isAgentIcon, AGENT_ICONS, toAgentIconValue } from './agentIconCatalog';

// v2: broadened filter to also migrate personas whose icon is a stale Lucide
// PascalCase name ("Mail", "Database", …) — the legacy output of the build LLM
// before the Rust-side normalizer started coercing to agent-icon:<id>. Bumping
// the key forces one migration pass per existing install.
const ASSIGNMENT_KEY = 'personas-icon-auto-assigned-v2';

/** Keyword → icon ID mapping (most specific first). */
const KEYWORD_MAP: Array<{ keywords: string[]; iconId: string }> = [
  { keywords: ['code', 'developer', 'dev', 'codebase', 'build', 'ci/cd', 'qa', 'test', 'feature flag', 'git'],  iconId: 'code' },
  { keywords: ['devops', 'sentry', 'infrastructure', 'deploy', 'pipeline', 'incident', 'ops'],                    iconId: 'devops' },
  { keywords: ['security', 'vulnerability', 'access', 'brand protection', 'sentinel'],                             iconId: 'security' },
  { keywords: ['monitor', 'alert', 'health', 'performance', 'watchdog', 'database monitor'],                       iconId: 'monitor' },
  { keywords: ['email', 'inbox', 'mail', 'digest', 'newsletter'],                                                  iconId: 'email' },
  { keywords: ['document', 'documentation', 'knowledge base', 'wiki', 'doc'],                                      iconId: 'document' },
  { keywords: ['support', 'helpdesk', 'ticket', 'escalation', 'customer service'],                                 iconId: 'support' },
  { keywords: ['automat', 'workflow', 'orchestrat', 'router', 'pipeline'],                                          iconId: 'automation' },
  { keywords: ['research', 'intelligence', 'analyst', 'report', 'insight', 'scout'],                                iconId: 'research' },
  { keywords: ['finance', 'invoice', 'expense', 'budget', 'billing', 'revenue', 'accounting', 'payment'],           iconId: 'finance' },
  { keywords: ['marketing', 'brand', 'campaign', 'seo', 'content distribution', 'visual brand'],                    iconId: 'marketing' },
  { keywords: ['content', 'editorial', 'video', 'writer', 'blog', 'newsletter curator'],                            iconId: 'content' },
  { keywords: ['sales', 'lead', 'crm', 'deal', 'proposal', 'outbound', 'pipeline autopilot'],                      iconId: 'sales' },
  { keywords: ['hr', 'recruit', 'onboard', 'hiring', 'employee', 'people'],                                         iconId: 'hr' },
  { keywords: ['legal', 'contract', 'compliance', 'regulation', 'policy'],                                           iconId: 'legal' },
  { keywords: ['notification', 'alert', 'event', 'webhook', 'feedback'],                                             iconId: 'notification' },
  { keywords: ['calendar', 'schedule', 'meeting', 'appointment', 'deadline', 'standup'],                              iconId: 'calendar' },
  { keywords: ['search', 'find', 'discover', 'explore', 'lookup'],                                                   iconId: 'search' },
  { keywords: ['data', 'analytics', 'database', 'chart', 'metric', 'dashboard'],                                     iconId: 'data' },
];

/** Infer the best icon ID from a persona's name and description. */
function inferIconId(name: string, description: string | null): string {
  const text = `${name} ${description ?? ''}`.toLowerCase();
  for (const rule of KEYWORD_MAP) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule.iconId;
    }
  }
  return 'assistant'; // default fallback
}

/**
 * Auto-assign agent-icon aliases to all personas without one.
 * Idempotent: tracks completion in localStorage so it only runs once.
 */
export async function autoAssignPersonaIcons(personas: Persona[]): Promise<void> {
  // Skip if already done in this database
  const done = localStorage.getItem(ASSIGNMENT_KEY);
  if (done) return;

  // An icon is considered "user-preserved" if it's already in the catalog form,
  // a URL, or looks like an emoji (short non-ASCII string) — matches the
  // PersonaIcon renderer heuristic so we don't overwrite legitimate choices.
  const isEmojiLike = (s: string) => {
    const t = s.trim();
    return t.length > 0 && t.length <= 8 && !/^[a-zA-Z0-9_:.\-/]+$/.test(t);
  };
  const needsIcon = personas.filter((p) => {
    if (!p.icon) return true;
    if (isAgentIcon(p.icon)) return false;
    if (p.icon.startsWith('http')) return false;
    if (isEmojiLike(p.icon)) return false;
    return true; // stale Lucide name, garbage, etc. — eligible for rewrite
  });

  if (needsIcon.length === 0) {
    localStorage.setItem(ASSIGNMENT_KEY, new Date().toISOString());
    return;
  }

  // Assign icons in parallel (but throttled to avoid overwhelming the DB)
  const batchSize = 5;
  for (let i = 0; i < needsIcon.length; i += batchSize) {
    const batch = needsIcon.slice(i, i + batchSize);
    await Promise.all(
      batch.map((p) => {
        const iconId = inferIconId(p.name, p.description);
        const entry = AGENT_ICONS.find((e) => e.id === iconId);
        const updates: Record<string, unknown> = {
          icon: toAgentIconValue(iconId),
        };
        // Only set color if persona doesn't have one
        if (!p.color && entry) {
          updates.color = entry.suggestedColor;
        }
        return updatePersona(p.id, updates as never).catch(() => {
          // Silently skip failures (e.g. if persona was deleted concurrently)
        });
      }),
    );
  }

  localStorage.setItem(ASSIGNMENT_KEY, new Date().toISOString());
}
