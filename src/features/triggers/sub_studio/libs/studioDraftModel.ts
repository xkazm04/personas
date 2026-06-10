/**
 * studioDraftModel — shared, canvas-free chain representation used by the
 * prototype variants (Switchboard, Composer). A chain draft is a flat list
 * of source→target links; linear chains emerge from persona-completion
 * sources. Both variants read/write the SAME localStorage draft so the tab
 * switcher preserves work in progress.
 *
 * Prototype-phase file: consolidation decides whether this replaces the
 * React Flow node/edge model in triggerStudioConstants.
 */
import type { Persona } from '@/lib/bindings/Persona';
import { TRIGGER_BLOCK_TEMPLATES, type TriggerBlockTemplate } from './triggerStudioConstants';
import { silentCatch } from '@/lib/silentCatch';

export type DraftSource =
  | { kind: 'trigger'; triggerType: string }
  | { kind: 'persona'; personaId: string };

export interface DraftLink {
  id: string;
  source: DraftSource;
  targetPersonaId: string;
  /** Optional condition gating the hop. null = always run. */
  condition: string | null;
}

export interface ChainDraft {
  version: 1;
  links: DraftLink[];
}

export const STUDIO_DRAFT_KEY = 'trigger_studio_draft_v1';

/** Condition presets a link can cycle through (null = always). */
export const LINK_CONDITION_PRESETS: Array<string | null> = [
  null,
  'on success',
  'on failure',
  'if output matches',
];

export function newLinkId(): string {
  return `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function loadDraft(): ChainDraft {
  try {
    const raw = localStorage.getItem(STUDIO_DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChainDraft;
      if (parsed.version === 1 && Array.isArray(parsed.links)) return parsed;
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

export function sourceKey(s: DraftSource): string {
  return s.kind === 'trigger' ? `trigger:${s.triggerType}` : `persona:${s.personaId}`;
}

export function sameSource(a: DraftSource, b: DraftSource): boolean {
  return sourceKey(a) === sourceKey(b);
}

/** Human-readable source label for ledger rows + sentences. */
export function sourceLabel(s: DraftSource, personas: Persona[]): string {
  if (s.kind === 'trigger') return findTrigger(s.triggerType)?.label ?? s.triggerType;
  return personas.find((p) => p.id === s.personaId)?.name ?? 'Unknown persona';
}

export function personaName(id: string, personas: Persona[]): string {
  return personas.find((p) => p.id === id)?.name ?? 'Unknown persona';
}

/**
 * Order links into displayable chains: links whose source is a trigger
 * start a chain; persona-sourced links attach after the link that targets
 * that persona. Orphan persona-sourced links (no upstream) trail at the end.
 */
export function groupIntoChains(links: DraftLink[]): DraftLink[][] {
  const roots = links.filter((l) => l.source.kind === 'trigger');
  const rest = new Set(links.filter((l) => l.source.kind === 'persona'));
  const chains: DraftLink[][] = [];

  for (const root of roots) {
    const chain: DraftLink[] = [root];
    let cursor = root.targetPersonaId;
    let extended = true;
    while (extended) {
      extended = false;
      for (const link of rest) {
        if (link.source.kind === 'persona' && link.source.personaId === cursor) {
          chain.push(link);
          rest.delete(link);
          cursor = link.targetPersonaId;
          extended = true;
          break;
        }
      }
    }
    chains.push(chain);
  }
  if (rest.size > 0) chains.push([...rest]);
  return chains;
}
