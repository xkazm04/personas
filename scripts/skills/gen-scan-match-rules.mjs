#!/usr/bin/env node
/**
 * gen-scan-match-rules — emit the context→lens keyword matcher from
 * scan_agents.toml (the single source of truth for scan lenses).
 *
 * Replaces the hand-authored SCAN_MATCH_RULES list in presetSkills.ts, which
 * silently drifted once (bounty-hunter / business-strategist shipped without
 * rules and could never be recommended). Generating from the same TOML the
 * Rust scanner embeds makes that drift structurally impossible.
 *
 * Output: src/features/plugins/dev-tools/constants/scanMatchRules.gen.ts
 * Wired into scripts/run-codegen.mjs (predev/prebuild).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOML = join(REPO, 'src-tauri', 'src', 'commands', 'infrastructure', 'scan_agents.toml');
const OUT = join(REPO, 'src', 'features', 'plugins', 'dev-tools', 'constants', 'scanMatchRules.gen.ts');

/** Minimal parser for this flat `[[agents]]` + `key = "value"` TOML. */
function parseAgents(toml) {
  const agents = [];
  let cur = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '[[agents]]') { cur = {}; agents.push(cur); continue; }
    if (!cur) continue;
    const m = line.match(/^(\w+)\s*=\s*"(.*)"\s*$/);
    if (m) cur[m[1]] = m[2];
  }
  return agents;
}

const agents = parseAgents(readFileSync(TOML, 'utf8')).filter((a) => a.key);
const missing = agents.filter((a) => !a.match).map((a) => a.key);
if (missing.length > 0) {
  console.error(`gen-scan-match-rules: agents missing a \`match\` regex in scan_agents.toml: ${missing.join(', ')}`);
  process.exit(1);
}
for (const a of agents) {
  try {
    new RegExp(a.match, 'i');
  } catch (e) {
    console.error(`gen-scan-match-rules: invalid match regex for ${a.key}: ${e.message}`);
    process.exit(1);
  }
}

const rules = agents
  .map((a) => `  { agentKey: '${a.key}', keywords: /${a.match}/i },`)
  .join('\n');

const body = `// GENERATED FILE — do not edit.
// Source: src-tauri/src/commands/infrastructure/scan_agents.toml (\`match\` field
// per agent), emitted by scripts/skills/gen-scan-match-rules.mjs. One rule per
// scan lens, guaranteed complete: the generator fails if any agent lacks a
// \`match\` regex, so a lens can never silently become unrecommendable again.

/** Keyword patterns that map context attributes to relevant scan agents. */
export const SCAN_MATCH_RULES: { agentKey: string; keywords: RegExp }[] = [
${rules}
];
`;

writeFileSync(OUT, body, 'utf8');
console.log(`gen-scan-match-rules: wrote ${agents.length} rules -> ${OUT}`);
