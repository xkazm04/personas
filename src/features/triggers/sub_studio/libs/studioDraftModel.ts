/**
 * studioDraftModel — the canvas-free chain representation behind the Chain
 * Studio Switchboard. A chain draft is a flat list of source→target links;
 * linear chains emerge from persona-completion sources. Persisted to
 * localStorage so work in progress survives reloads.
 */
import type { Persona } from '@/lib/bindings/Persona';
import { TRIGGER_BLOCK_TEMPLATES, type TriggerBlockTemplate } from './triggerStudioConstants';
import { silentCatch } from '@/lib/silentCatch';

export type DraftSource =
  | { kind: 'trigger'; triggerType: string }
  | { kind: 'persona'; personaId: string };

/**
 * Run-condition gating a link. Stored as a token (never a display string) so
 * the persisted draft stays language-agnostic; labels resolve via i18n at
 * render time. null = always run.
 */
export type LinkCondition = 'on_success' | 'on_failure' | 'output_match' | null;

export const LINK_CONDITION_PRESETS: LinkCondition[] = [
  null,
  'on_success',
  'on_failure',
  'output_match',
];

export interface DraftLink {
  id: string;
  source: DraftSource;
  targetPersonaId: string;
  condition: LinkCondition;
}

export interface ChainDraft {
  version: 1;
  links: DraftLink[];
}

export const STUDIO_DRAFT_KEY = 'trigger_studio_draft_v1';

export function newLinkId(): string {
  return `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function loadDraft(): ChainDraft {
  try {
    const raw = localStorage.getItem(STUDIO_DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChainDraft;
      if (parsed.version === 1 && Array.isArray(parsed.links)) {
        // Round-1 prototype drafts stored display strings as conditions;
        // anything that isn't a known token degrades to "always".
        for (const link of parsed.links) {
          if (!LINK_CONDITION_PRESETS.includes(link.condition)) link.condition = null;
        }
        return parsed;
      }
    }
  } catch (err) {
    silentCatch('features/triggers/sub_studio/studioDraftModel:load')(err);
  }
  return { version: 1, links: [] };
}

export function saveDraft(draft: ChainDraft): void {
  try {
    localStorage.setItem(STUDIO_DRAFT_KEY, JSON.stringify(draft));
  } catch (err) {
    silentCatch('features/triggers/sub_studio/studioDraftModel:save')(err);
  }
}

export function findTrigger(triggerType: string): TriggerBlockTemplate | undefined {
  return TRIGGER_BLOCK_TEMPLATES.find((t) => t.triggerType === triggerType);
}

export function personaName(id: string, personas: Persona[]): string {
  return personas.find((p) => p.id === id)?.name ?? 'Unknown persona';
}
