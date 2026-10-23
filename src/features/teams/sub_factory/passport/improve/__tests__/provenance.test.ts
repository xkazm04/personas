import { describe, it, expect } from 'vitest';
import type { CrossProjectProjectMetadata, RepoEvidence } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import en from '@/i18n/locales/en.json';
import cs from '@/i18n/locales/cs.json';
import type { Translations } from '@/i18n/useTranslation';

import { derivePassportFromMetadata } from '../../passportDerive';
import type { AppPassport } from '../../passportModel';
import type { ImproveRaw } from '../ImproveContext';
import { dimensionReason } from '../provenance';

// The shipped catalogs as the runtime proxy would merge them; the JSON is the
// source of the generated `Translations` type, so the shape matches by construction.
const tEn = en as unknown as Translations;
const tCs = { ...en, plugins: { ...en.plugins, dev_tools: { ...en.plugins.dev_tools, ...cs.plugins.dev_tools } } } as unknown as Translations;

function mkRaw(project: Partial<DevProject>, evidence: Partial<RepoEvidence>, dbTables: string[] = []): ImproveRaw {
  return {
    meta: {
      project_id: 'p1', name: 'Proj', summary: '', keywords: [], api_surface: [],
      tech_layers: ['typescript'], db_tables: dbTables,
      context_count: 0, group_count: 0, active_goal_count: 0,
    } as CrossProjectProjectMetadata,
    project: {
      id: 'p1', name: 'Proj', root_path: 'C:/x', description: null, status: 'active',
      tech_stack: 'react', github_url: null, monitoring_credential_id: null,
      pr_credential_id: null, llm_tracking_credential_id: null, test_env_url: null,
      standards_config: null, team_id: null,
      ...project,
    } as DevProject,
    evidence: { scanned: true, package_scripts: [], ci_workflows: [], ...evidence } as RepoEvidence,
  };
}

const passportOf = (raw: ImproveRaw): AppPassport =>
  derivePassportFromMetadata(raw.meta, raw.project, { evidence: raw.evidence });

// What the derive itself says about each row the "why this rating" line covers.
const SIGNAL: Record<string, (p: AppPassport) => boolean> = {
  tests: (p) => p.productionReadiness.tests.level !== 'none',
  evals: (p) => p.automationReadiness.artifacts.evals !== 'none',
  security: (p) => p.productionReadiness.security.level === 'scanning',
  migrations: (p) => p.productionReadiness.delivery.migrations !== 'none',
  instructions: (p) => p.automationReadiness.artifacts.agentInstructions.length > 0,
  aiflow: (p) => p.automationReadiness.aiInWorkflow,
};

// "No X detected" / "…, but no scanning detected": a sentence denying a signal.
const DENIES_SIGNAL = /(^No |\bno [^.]*detected)/i;

describe('dimensionReason agrees with the derive it explains', () => {
  // Every signal present: the row shows a rung above "none", so a provenance
  // line claiming nothing was detected contradicts the cell it sits under.
  const rich = mkRaw(
    { team_id: 'team-1', standards_config: '{}' },
    { has_tests: true, test_file_count: 30, has_eval: true, has_codeql: true, has_migrations: true, has_claude_md: true },
  );
  // No team: instructions then come from CLAUDE.md alone.
  const claudeMdOnly = mkRaw({}, { has_claude_md: true });

  it.each(Object.keys(SIGNAL))('%s: never says "No ..." when the derive saw a signal', (row) => {
    for (const raw of [rich, claudeMdOnly]) {
      const p = passportOf(raw);
      if (!SIGNAL[row]!(p)) continue;
      const reason = dimensionReason(row, raw, tEn);
      expect({ row, reason: reason && DENIES_SIGNAL.test(reason) ? reason : 'ok' }).toEqual({ row, reason: 'ok' });
    }
  });

  it('keeps the "No ..." sentence when the derive saw nothing', () => {
    const empty = mkRaw({}, {});
    const p = passportOf(empty);
    for (const row of Object.keys(SIGNAL)) {
      expect(SIGNAL[row]!(p)).toBe(false);
      expect(dimensionReason(row, empty, tEn)).toMatch(/^No /);
    }
  });
});

describe('dimensionReason is worded through the catalog', () => {
  it('speaks Czech, not English, when the locale is Czech', () => {
    const empty = mkRaw({}, { scanned: true });
    const en1 = dimensionReason('skills', empty, tEn);
    const cs1 = dimensionReason('skills', empty, tCs);
    expect(en1).toBe(en.plugins.dev_tools.improve_why_skills_none);
    expect(cs1).toBe(cs.plugins.dev_tools.improve_why_skills_none);
    expect(cs1).not.toBe(en1);
  });
});
