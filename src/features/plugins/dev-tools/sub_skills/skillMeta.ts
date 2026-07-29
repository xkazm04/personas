// Skill metadata — parses SKILL.md into a display model for the SkillInfoModal.
//
// Format follows the Claude Code / Agent Skills standard
// (platform.claude.com/docs/.../agent-skills/best-practices): `name` +
// `description` are the required frontmatter (description = what it does AND
// when to use it, third person); `argument-hint` documents expected arguments
// (e.g. "[context]"); we additionally carry the app's `category` / `contexts`
// / `memory` fields. Preset scan skills are synthesized from the in-memory
// catalogue (no file read); custom skills are parsed from their SKILL.md.
import type { PresetSkillDef } from '../constants/presetSkills';

export interface SkillMeta {
  name: string;
  description: string | null;
  /** Frontmatter `argument-hint`, e.g. "[context]". */
  argumentHint: string | null;
  category: string | null;
  contextsTracked: boolean;
  memory: string | null;
  /** First prose block of the body — extra colour beyond the description. */
  bodySummary: string | null;
}

/** Split `---`-delimited YAML frontmatter from the markdown body. */
export function splitFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: content.trim() };
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { fm, body: (m[2] ?? '').trim() };
}

/** First prose paragraph of the body (skips headings + HTML comments), capped. */
function firstProse(body: string): string | null {
  const blocks = body.split(/\r?\n\s*\r?\n/);
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b || b.startsWith('#') || b.startsWith('<!--') || b.startsWith('```')) continue;
    return b.length > 320 ? `${b.slice(0, 317)}…` : b;
  }
  return null;
}

export function metaFromSkillMd(name: string, content: string): SkillMeta {
  const { fm, body } = splitFrontmatter(content);
  return {
    name: fm.name || name,
    description: fm.description ?? null,
    argumentHint: fm['argument-hint'] ?? null,
    category: fm.category ?? null,
    contextsTracked: (fm.contexts ?? '').toLowerCase() === 'tracked',
    memory: fm.memory ?? null,
    bodySummary: firstProse(body),
  };
}

const GROUP_LABEL: Record<string, string> = {
  technical: 'Development', user: 'Other', business: 'Other', mastermind: 'Other',
};

/** Synthesize metadata for a preset scan skill from the in-memory catalogue. */
export function metaFromPreset(def: PresetSkillDef): SkillMeta {
  return {
    name: def.name,
    description: def.description,
    argumentHint: '[context]',
    category: GROUP_LABEL[def.categoryGroup] ?? 'Other',
    contextsTracked: true,
    memory: 'project',
    bodySummary: null,
  };
}

/** The invocation variations shown in the modal — base, argument-hint, context. */
export function commandVariations(meta: SkillMeta): Array<{ command: string; note: string }> {
  const out: Array<{ command: string; note: string }> = [{ command: `/${meta.name}`, note: 'base' }];
  if (meta.argumentHint) out.push({ command: `/${meta.name} ${meta.argumentHint}`, note: 'with arguments' });
  else if (meta.contextsTracked) out.push({ command: `/${meta.name} <context>`, note: 'scope to a context' });
  return out;
}
