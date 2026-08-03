/**
 * Preset skills — the visual + matching catalog for the app-owned `scan-*`
 * system skills (one per Idea Scanner lens, generated from scan_agents.toml
 * by scripts/skills/scan-agents-to-skills.mjs and bundled into the installer).
 *
 * Each preset inherits its lens's visual identity (emoji / Lucide icon / hex
 * color / category group) from SCAN_AGENTS so the Skills UI can render preset
 * rows with icons while user-authored skills stay plain.
 *
 * Also home of the context→lens keyword matcher (moved from the retired
 * sub_scanner/ideaScannerHelpers.ts) — used by the coverage pipeline and the
 * Context Map to pick which presets apply to a given context.
 */
import type { DevContext } from '@/lib/bindings/DevContext';
import { Compass, type LucideIcon } from 'lucide-react';

import { parseJsonArray } from '../sub_context/contextMapTypes';
import { SCAN_AGENTS, type ScanAgentDef } from './scanAgents';
import { SCAN_MATCH_RULES } from './scanMatchRules.gen';

export interface PresetSkillDef {
  /** Skill directory name, e.g. `scan-code-optimizer`. */
  name: string;
  /** The originating scan-agent key (`code-optimizer`) — links legacy
   *  dev_ideas/dev_scans rows (keyed by agent) to the preset skill. */
  agentKey: string;
  label: string;
  emoji: string;
  icon: LucideIcon;
  color: string;
  categoryGroup: ScanAgentDef['categoryGroup'];
  description: string;
}

export const PRESET_SKILL_PREFIX = 'scan-';

/** The consolidated multi-lens sweep — a preset with no scanner lens behind
 *  it (it composes the 22 lenses), so it lives outside SCAN_AGENTS and must
 *  never join the Idea Scanner roster. Board renders it as the hero row. */
export const SWEEP_SKILL_NAME = 'scan-sweep';
const SWEEP_SKILL: PresetSkillDef = {
  name: SWEEP_SKILL_NAME,
  agentKey: 'sweep',
  label: 'Context Sweep',
  emoji: '🧭',
  icon: Compass,
  color: '#7C3AED',
  categoryGroup: 'technical',
  description:
    'Reads one context once and evaluates it through every matched scan lens. The efficient default; single-lens scans are the focused deep-dive form.',
};

/** All preset scan skills, keyed by skill name. */
export const PRESET_SKILLS: ReadonlyMap<string, PresetSkillDef> = new Map([
  ...SCAN_AGENTS.map((a): [string, PresetSkillDef] => [
    `${PRESET_SKILL_PREFIX}${a.key}`,
    {
      name: `${PRESET_SKILL_PREFIX}${a.key}`,
      agentKey: a.key,
      label: a.label,
      emoji: a.emoji,
      icon: a.icon,
      color: a.color,
      categoryGroup: a.categoryGroup,
      description: a.description,
    },
  ]),
  [SWEEP_SKILL_NAME, SWEEP_SKILL],
]);

/**
 * Synthesize a library row for a preset that isn't materialized in the user's
 * global library — the Preset tab always shows the full catalog; adopting one
 * installs from the app bundle via `installSystemSkill`.
 */
export function presetSkillEntry(p: PresetSkillDef): {
  name: string; path: string; description: string | null;
  referenceFileCount: number; referenceFiles: string[];
  syncState: 'in_sync'; sourceKind: null;
  category: string; memory: 'project'; contextTracked: boolean;
} {
  return {
    name: p.name,
    path: '',
    description: p.description,
    referenceFileCount: 0,
    referenceFiles: [],
    syncState: 'in_sync',
    sourceKind: null,
    category: 'Preset',
    memory: 'project',
    contextTracked: true,
  };
}

/** Is this library entry an app-owned preset (vs a user-authored skill)? */
export function isPresetSkill(name: string): boolean {
  return PRESET_SKILLS.has(name);
}

/** Visual identity for a preset skill row; null for custom skills. */
export function presetVisual(name: string): PresetSkillDef | null {
  return PRESET_SKILLS.get(name) ?? null;
}

/** Reverse lookup: scan-agent key (legacy dev_scans/dev_ideas rows) → preset. */
export function presetByAgentKey(agentKey: string): PresetSkillDef | null {
  return PRESET_SKILLS.get(`${PRESET_SKILL_PREFIX}${agentKey}`) ?? null;
}

// Context→lens keyword matcher — GENERATED from scan_agents.toml (each agent's
// `match` field) by scripts/skills/gen-scan-match-rules.mjs. The former
// hand-authored list drifted once (bounty-hunter / business-strategist shipped
// without rules); the generator hard-fails on a missing `match`, so the old
// dev-only parity invariant is no longer needed.
export { SCAN_MATCH_RULES };

/** Searchable haystack for a context's match rules. */
function contextHaystack(ctx: DevContext): string {
  return [
    ctx.name,
    ctx.description ?? '',
    ...parseJsonArray(ctx.keywords),
    ...parseJsonArray(ctx.tech_stack),
    ...parseJsonArray(ctx.api_surface),
    ...parseJsonArray(ctx.file_paths),
  ].join(' ');
}

/** Agent keys relevant to a context (legacy scanner lane still uses these). */
export function matchAgentsToContext(ctx: DevContext): string[] {
  const searchable = contextHaystack(ctx);
  const matched = SCAN_MATCH_RULES
    .filter((rule) => rule.keywords.test(searchable))
    .map((rule) => rule.agentKey);
  // Always include at least architecture-analyst and code-optimizer as baseline
  if (matched.length === 0) return ['architecture-analyst', 'code-optimizer'];
  return [...new Set(matched)];
}

/** Preset skill names relevant to a context — the coverage pipeline's picker. */
export function matchSkillsToContext(ctx: DevContext): string[] {
  return matchAgentsToContext(ctx).map((k) => `${PRESET_SKILL_PREFIX}${k}`);
}
