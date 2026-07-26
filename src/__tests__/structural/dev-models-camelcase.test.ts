/**
 * Structural ratchet: every ts-rs-exported struct in the dev-tools model file
 * must declare `#[serde(rename_all = "camelCase")]`, so its binding presents
 * camelCase to the frontend like the rest of the codebase.
 *
 * 38 legacy structs predate the rule and are baselined below — that list may
 * only SHRINK (each rename phase of the migration removes entries). Adding a
 * NEW struct without the rename fails this test the day it's written, which is
 * exactly the drift mechanism that produced the 38.
 *
 * Why here and not Clippy: the check is a cross-attribute source pattern that
 * needs no compile, and vitest runs on every `npm run test` locally and in CI.
 *
 * ADR: Architect/decisions/2026-07-26-dev-tools-camelcase-phased (Obsidian).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MODEL_FILE = resolve(__dirname, '../../../src-tauri/src/db/models/dev_tools.rs');

/** Legacy structs shipped before the rule. Shrink-only — never add to this. */
const LEGACY_SNAKE_CASE_BASELINE = new Set([
  'DevProject', 'DevWorkspace', 'WorkspaceKnowledge', 'WorkspacePracticeAdoption',
  'WorkspaceImportItem', 'DirectoryScanResult', 'DevGoal', 'DevGoalDependency',
  'DevGoalSignal', 'DevGoalItem', 'DevUseCase', 'DevKpi', 'DevKpiBinding',
  'DevKpiMeasurement', 'PendingAcceptanceGoal', 'GoalProgressSuggestion',
  'DevContextGroup', 'DevContext', 'DevContextGroupRelationship', 'DevMemory',
  'DevIdea', 'DevScan', 'DevStandard', 'DevTask', 'DevCompetition',
  'DevCompetitionSlot', 'DevStrategyStats', 'ScanAgentMeta', 'TriageRule',
  'DevPipeline', 'CrossProjectRelation', 'PortfolioHealthSummary',
  'ProjectHealthEntry', 'TechRadarEntry', 'RiskMatrixEntry', 'TestRunResult',
  'GitOperationResult', 'ContextHealthSnapshot',
]);

interface StructAttrs {
  name: string;
  hasCamelRename: boolean;
}

/** Pull every derive-annotated `pub struct` and whether its attribute block
 *  carries the serde camelCase rename. */
function parseStructs(source: string): StructAttrs[] {
  const structs: StructAttrs[] = [];
  const re = /#\[derive\([^)]*\)\]((?:\s*#\[[^\]]*\])*)\s*pub struct (\w+)/g;
  for (const m of source.matchAll(re)) {
    const attrs = m[1] ?? '';
    structs.push({
      name: m[2],
      hasCamelRename: attrs.includes('rename_all') && attrs.includes('camelCase'),
    });
  }
  return structs;
}

describe('dev_tools models — camelCase binding ratchet', () => {
  const source = readFileSync(MODEL_FILE, 'utf-8');
  const structs = parseStructs(source);

  it('parses the model file (sanity: the file moved → update MODEL_FILE)', () => {
    expect(structs.length).toBeGreaterThan(30);
  });

  it('every struct outside the legacy baseline declares #[serde(rename_all = "camelCase")]', () => {
    const offenders = structs
      .filter((s) => !s.hasCamelRename && !LEGACY_SNAKE_CASE_BASELINE.has(s.name))
      .map((s) => s.name);
    expect(
      offenders,
      `New dev-tools struct(s) without #[serde(rename_all = "camelCase")]: ${offenders.join(', ')}. ` +
        'Bindings must present camelCase — add the rename (and regen bindings). ' +
        'See ADR 2026-07-26-dev-tools-camelcase-phased.',
    ).toEqual([]);
  });

  it('the baseline only shrinks — renamed structs must be removed from it', () => {
    const stale = [...LEGACY_SNAKE_CASE_BASELINE].filter((name) => {
      const s = structs.find((x) => x.name === name);
      return s === undefined || s.hasCamelRename;
    });
    expect(
      stale,
      `Baseline entries that no longer need it (renamed or deleted): ${stale.join(', ')}. ` +
        'Remove them from LEGACY_SNAKE_CASE_BASELINE so the ratchet holds.',
    ).toEqual([]);
  });
});
