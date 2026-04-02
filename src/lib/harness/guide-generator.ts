/* ==============================================================================
   Guide Generator
   Builds a reproducible playbook from completed harness iterations.
   ============================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  HarnessGuide,
  HarnessPlan,
  GuideStep,
  ModuleArea,
  ExecutorResult,
  VerificationReport,
  ParsedAreaResult,
} from './types';

// ---------------------------------------------------------------------------
//  Guide Lifecycle
// ---------------------------------------------------------------------------

export function createEmptyGuide(plan: HarnessPlan): HarnessGuide {
  return {
    title: `${plan.project} Harness Guide`,
    project: plan.project,
    scenario: plan.scenario,
    generatedAt: new Date().toISOString(),
    totalIterations: 0,
    totalDurationMs: 0,
    buildOrder: plan.areas.map((a) => a.id),
    steps: [],
    learnings: [],
    prerequisites: [
      'Node.js 18+ with npm',
      'npm install (dependencies)',
      'Claude Code CLI (claude) installed and authenticated',
    ],
  };
}

export function appendGuideStep(
  guide: HarnessGuide,
  area: ModuleArea,
  result: ParsedAreaResult,
  execResult: ExecutorResult,
  report: VerificationReport,
): void {
  const step: GuideStep = {
    phase: guide.steps.length + 1,
    areaId: area.id,
    moduleId: area.moduleId,
    label: area.label,
    description: area.description,
    actions: extractActions(result),
    filesModified: result.filesModified,
    filesCreated: result.filesCreated,
    decisions: extractDecisions(execResult.assistantOutput),
    gotchas: result.learnings.filter((l) => l.toLowerCase().includes('gotcha') || l.includes('careful') || l.includes('exception')),
    verification: formatVerification(report),
    durationMs: execResult.durationMs,
  };

  guide.steps.push(step);
  guide.totalIterations++;
  guide.totalDurationMs += execResult.durationMs;
  guide.generatedAt = new Date().toISOString();

  // Add new learnings
  for (const learning of result.learnings) {
    if (!guide.learnings.includes(learning)) {
      guide.learnings.push(learning);
    }
  }
}

// ---------------------------------------------------------------------------
//  Persistence
// ---------------------------------------------------------------------------

export function loadGuide(statePath: string): HarnessGuide | null {
  const path = join(statePath, 'guide.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as HarnessGuide;
}

export function saveGuide(statePath: string, guide: HarnessGuide): void {
  writeFileSync(join(statePath, 'guide.json'), JSON.stringify(guide, null, 2), 'utf-8');
  writeFileSync(join(statePath, 'guide.md'), renderGuideMarkdown(guide), 'utf-8');
}

// ---------------------------------------------------------------------------
//  Markdown Rendering
// ---------------------------------------------------------------------------

export function renderGuideMarkdown(guide: HarnessGuide): string {
  const lines: string[] = [];

  lines.push(`# ${guide.title}`);
  lines.push('');
  lines.push(`> Generated: ${guide.generatedAt}`);
  lines.push(`> Scenario: ${guide.scenario}`);
  lines.push(`> Iterations: ${guide.totalIterations}`);
  lines.push(`> Duration: ${Math.round(guide.totalDurationMs / 1000)}s`);
  lines.push('');

  // Prerequisites
  lines.push('## Prerequisites');
  lines.push('');
  for (const prereq of guide.prerequisites) {
    lines.push(`- ${prereq}`);
  }
  lines.push('');

  // Build Order
  lines.push('## Build Order');
  lines.push('');
  for (let i = 0; i < guide.buildOrder.length; i++) {
    lines.push(`${i + 1}. ${guide.buildOrder[i]}`);
  }
  lines.push('');

  // Steps
  for (const step of guide.steps) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## Phase ${step.phase}: ${step.label}`);
    lines.push('');
    lines.push(`**Area:** ${step.areaId}`);
    lines.push(`**Module:** ${step.moduleId}`);
    lines.push(`**Duration:** ${Math.round(step.durationMs / 1000)}s`);
    lines.push('');

    if (step.actions.length > 0) {
      lines.push('### Actions Taken');
      lines.push('');
      for (const action of step.actions) {
        lines.push(`- ${action}`);
      }
      lines.push('');
    }

    if (step.filesModified.length > 0 || step.filesCreated.length > 0) {
      lines.push('### Files Changed');
      lines.push('');
      for (const f of step.filesCreated) {
        lines.push(`- (new) ${f}`);
      }
      for (const f of step.filesModified) {
        lines.push(`- ${f}`);
      }
      lines.push('');
    }

    if (step.decisions.length > 0) {
      lines.push('### Decisions');
      lines.push('');
      for (const d of step.decisions) {
        lines.push(`- ${d}`);
      }
      lines.push('');
    }

    if (step.gotchas.length > 0) {
      lines.push('### Gotchas');
      lines.push('');
      for (const g of step.gotchas) {
        lines.push(`- ${g}`);
      }
      lines.push('');
    }

    lines.push('### Verification');
    lines.push('');
    lines.push(step.verification);
    lines.push('');
  }

  // Learnings
  if (guide.learnings.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Accumulated Learnings');
    lines.push('');
    for (const l of guide.learnings) {
      lines.push(`- ${l}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function extractActions(result: ParsedAreaResult): string[] {
  const actions: string[] = [];
  if (result.summary) actions.push(result.summary);
  if (result.filesModified.length > 0) {
    actions.push(`Modified ${result.filesModified.length} files`);
  }
  if (result.filesCreated.length > 0) {
    actions.push(`Created ${result.filesCreated.length} files`);
  }
  return actions;
}

function extractDecisions(output: string): string[] {
  const decisions: string[] = [];
  // Look for decision-like patterns in assistant output
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('Decision:') ||
      trimmed.startsWith('Chose ') ||
      trimmed.startsWith('Used ') ||
      trimmed.includes(' instead of ') ||
      trimmed.includes(' because ')
    ) {
      decisions.push(trimmed);
    }
  }
  return decisions.slice(0, 10);
}

function formatVerification(report: VerificationReport): string {
  return report.gates
    .map((g) => `- ${g.gate}: ${g.passed ? 'PASS' : 'FAIL'}${g.errors?.length ? ` (${g.errors.length} errors)` : ''}`)
    .join('\n');
}
