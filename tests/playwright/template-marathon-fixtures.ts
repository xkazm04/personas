/**
 * Template inventory + vault-matching for the marathon harness.
 *
 * Single source of truth for "which templates can the user's vault
 * actually adopt?" — same logic the plan doc audits, in TS so the
 * Playwright spec + Node driver share it without divergence.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';

export interface TemplateMeta {
  /** Absolute path to the JSON file. */
  path: string;
  /** Relative path from repo root, for logging. */
  relPath: string;
  /** The template's `id` field. */
  id: string;
  /** Display name. */
  name: string;
  /** First entry from the `category` array, lowercased. */
  category: string;
  /** Number of `use_cases` (capabilities) in the template. 0 = no caps. */
  capabilityCount: number;
  /** Number of `adoption_questions`. 0 = fully preset. */
  questionCount: number;
  /** Names of the connectors the template requires (after filtering out
   *  `required: false` entries). Built-in connectors are excluded since
   *  they don't need a vault credential. */
  requiredConnectors: string[];
  /** Connectors that have no vault match — non-empty means the template
   *  would block at adoption time. */
  missingConnectors: string[];
}

const BUILTIN_CONNECTORS = new Set([
  'local_drive',
  'personas_database',
  'personas_messages',
  'personas_vector_db',
  'codebase',
  'desktop_terminal',
  'desktop_browser',
  'desktop',
]);

/** Category-name → list of vault service_types that satisfy it. The
 *  vault stores under specific service_types; templates name them by
 *  generic category in some cases. Mirror builtin_connectors' category
 *  tags. */
const CATEGORY_HINTS: Record<string, string[]> = {
  email: ['gmail'],
  messaging: ['personas_messages'],
  image_generation: ['leonardo_ai'],
  crm: ['attio'],
  knowledge_base: ['notion'],
  calendar: ['google_calendar'],
  task_tracker: ['asana', 'linear', 'clickup'],
  ticketing: ['linear', 'asana'],
  source_control: ['github'],
  observability: ['sentry'],
  scheduling: ['cal_com'],
};

/** Resolve the repo root from this file's location. Walks up until
 *  package.json is found. */
function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repoRoot: package.json not found walking up from ' + __dirname);
}

function walkJson(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkJson(p, files);
    else if (entry.endsWith('.json')) files.push(p);
  }
  return files;
}

/** Filter out locale variants (`foo.ar.json`, `foo.zh.json`, etc.) — they
 *  carry only translated strings, no structural differences. */
function isLocaleVariant(filePath: string): boolean {
  return /\.(ar|bn|cs|de|es|fr|hi|id|ja|ko|ru|vi|zh)\.json$/i.test(basename(filePath));
}

export function loadAllTemplates(): TemplateMeta[] {
  const root = repoRoot();
  const dir = join(root, 'scripts', 'templates');
  const files = walkJson(dir).filter((f) => !isLocaleVariant(f));
  const out: TemplateMeta[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as {
        id?: string;
        name?: string;
        category?: string[];
        payload?: {
          persona?: { connectors?: Array<{ name?: string; role?: string; category?: string; required?: boolean }> };
          use_cases?: unknown[];
          adoption_questions?: unknown[];
        };
      };
      if (!j.id || !j.name) continue;
      const conns = (j.payload?.persona?.connectors ?? []).filter(
        (c) => c.required !== false,
      );
      out.push({
        path: f,
        relPath: relative(root, f).replace(/\\/g, '/'),
        id: j.id,
        name: j.name,
        category: ((j.category ?? ['other'])[0] ?? 'other').toLowerCase(),
        capabilityCount: (j.payload?.use_cases ?? []).length,
        questionCount: (j.payload?.adoption_questions ?? []).length,
        requiredConnectors: conns.map((c) => c.name ?? c.role ?? c.category ?? '').filter(Boolean),
        missingConnectors: [],
      });
    } catch {
      // Skip unparseable templates — they shouldn't exist post-migration
      // but we don't want the marathon to crash on one bad file.
    }
  }
  return out;
}

/** Annotate each template with `missingConnectors` based on the given
 *  vault service_type set. Templates with zero missing connectors are
 *  marathon-eligible. */
export function matchVault(templates: TemplateMeta[], vault: Set<string>): TemplateMeta[] {
  return templates.map((t) => {
    const missing: string[] = [];
    // Re-read the source to get the per-connector category for the
    // CATEGORY_HINTS lookup. Could be cached, but cost is negligible.
    let raw: { payload?: { persona?: { connectors?: Array<{ name?: string; role?: string; category?: string; required?: boolean }> } } };
    try {
      raw = JSON.parse(readFileSync(t.path, 'utf8'));
    } catch {
      return { ...t, missingConnectors: t.requiredConnectors };
    }
    const conns = (raw.payload?.persona?.connectors ?? []).filter((c) => c.required !== false);
    for (const c of conns) {
      const name = (c.name ?? '').toLowerCase();
      if (BUILTIN_CONNECTORS.has(name)) continue;
      const candidates: string[] = [];
      if (c.name) candidates.push(c.name.toLowerCase());
      if (c.role) candidates.push(c.role.toLowerCase());
      if (c.category) {
        candidates.push(c.category.toLowerCase());
        for (const hint of CATEGORY_HINTS[c.category.toLowerCase()] ?? []) {
          candidates.push(hint.toLowerCase());
        }
      }
      if (!candidates.some((s) => vault.has(s))) {
        missing.push(c.name ?? c.category ?? '?');
      }
    }
    return { ...t, missingConnectors: missing };
  });
}

/** Default vault snapshot — the user's actual vault on 2026-05-19. The
 *  driver overrides this by reading the running app's `persona_credentials`
 *  table at start-up; the constant is the offline fallback for the spec
 *  to compile and run hermetic dry-runs. */
export const DEFAULT_VAULT = new Set([
  'airtable', 'alpha_vantage', 'asana', 'attio', 'betterstack',
  'cal_com', 'clickup', 'desktop_docker', 'elevenlabs', 'gmail',
  'github', 'google_calendar', 'leonardo_ai', 'linear', 'local_drive',
  'notion', 'personas_database', 'personas_messages', 'personas_vector_db',
  'sentry', 'supabase',
]);

/** Curated marathon target list — 50 templates, mix of categories,
 *  excluding 4 known-volatile templates for the spare pool. */
export function selectMarathonTargets(eligible: TemplateMeta[], targetCount = 50): TemplateMeta[] {
  // Sort by category then capability count (single-cap first — they're
  // simpler and surface bugs faster), then by id for stable order across
  // runs.
  const sorted = [...eligible].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.capabilityCount !== b.capabilityCount) return a.capabilityCount - b.capabilityCount;
    return a.id.localeCompare(b.id);
  });
  return sorted.slice(0, targetCount);
}
