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
import { Compass, Languages, type LucideIcon } from 'lucide-react';

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

/** Copywriting-grade localization loop — like the sweep, a hand-authored
 *  system skill outside SCAN_AGENTS (no scanner lens, no match rules; the
 *  coverage pipeline never proposes it). Repo specifics live in the target
 *  repo's docs/i18n/contract.md, which the skill bootstraps on first run. */
export const I18N_SKILL_NAME = 'i18n-translate';
const I18N_SKILL: PresetSkillDef = {
  name: I18N_SKILL_NAME,
  agentKey: 'i18n-translate',
  label: 'i18n Translate',
  emoji: '🌐',
  icon: Languages,
  color: '#0D9488',
  categoryGroup: 'user',
  description:
    'Copywriting-grade localization: draft → typed MQM audit → gated refine, with a per-repo contract, glossary, style guides and gold exemplars maintained in the target repo.',
};

/** Lens visual identities keyed by `scan-<key>` — NOT installable skills.
 *  The 22 single-lens scan skills were retired (2026-08-04) in favor of the
 *  consolidated sweep; these defs survive purely as the visual vocabulary for
 *  lens chips, historical usage rows, and deep-scan recommendations. */
const LENS_VISUALS: ReadonlyMap<string, PresetSkillDef> = new Map(
  SCAN_AGENTS.map((a): [string, PresetSkillDef] => [
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
);

/** Installable preset skills — the sweep is the ONLY scan entry point. */
export const PRESET_SKILLS: ReadonlyMap<string, PresetSkillDef> = new Map([
  [SWEEP_SKILL_NAME, SWEEP_SKILL],
  [I18N_SKILL_NAME, I18N_SKILL],
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
  version: null;
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
    version: null,
  };
}

/** Is this library entry an app-owned preset (vs a user-authored skill)? */
export function isPresetSkill(name: string): boolean {
  return PRESET_SKILLS.has(name);
}

/** Visual identity for a skill row — resolves the sweep AND retired lens
 *  names (historical usage rows keep their icons); null for custom skills. */
export function presetVisual(name: string): PresetSkillDef | null {
  return PRESET_SKILLS.get(name) ?? LENS_VISUALS.get(name) ?? null;
}

/** Reverse lookup: scan-agent key (lens chips, dev_scans/dev_ideas rows). */
export function presetByAgentKey(agentKey: string): PresetSkillDef | null {
  return LENS_VISUALS.get(`${PRESET_SKILL_PREFIX}${agentKey}`) ?? null;
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
