/* ==============================================================================
   Executor
   Spawns Claude Code sessions for each area and parses structured results.
   ============================================================================== */

import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  ExecutorConfig,
  ExecutorResult,
  HarnessPlan,
  ModuleArea,
  ParsedAreaResult,
  ProgressEntry,
} from './types';

// ---------------------------------------------------------------------------
//  Result Markers
// ---------------------------------------------------------------------------

const RESULT_START = '@@HARNESS_RESULT';
const RESULT_END = '@@END_HARNESS_RESULT';

// ---------------------------------------------------------------------------
//  Prompt Assembly
// ---------------------------------------------------------------------------

export function buildAreaPrompt(
  plan: HarnessPlan,
  area: ModuleArea,
  learnings: string,
  recentProgress: ProgressEntry[],
): string {
  const sections: string[] = [];

  // Section 1: Project context
  sections.push(`# Project: ${plan.project}
Path: ${plan.projectPath}
Tech: React 19 + TypeScript + Tailwind 4 + Zustand + Tauri v2 (Rust backend)
Build: npx tsc --noEmit (typecheck), npm run lint (ESLint), npx vite build (production)

## Rules
- Read existing code before modifying — understand the patterns in use
- Follow existing conventions (import style, naming, file structure)
- Do NOT add features beyond what the area spec requires
- Do NOT modify files outside the area scope unless absolutely necessary
- Preserve all existing functionality — this is a migration, not a rewrite
- Run typecheck after your changes: npx tsc --noEmit`);

  // Section 2: Accumulated learnings
  if (learnings.trim()) {
    sections.push(`## Accumulated Learnings (from previous sessions)
${learnings}`);
  }

  // Section 3: Recent progress
  if (recentProgress.length > 0) {
    const progressLines = recentProgress
      .slice(-10)
      .map((p) => `- [${p.outcome}] ${p.areaId}: ${p.summary}`)
      .join('\n');
    sections.push(`## Recent Progress
${progressLines}`);
  }

  // Section 4: Area specification
  sections.push(`## Your Task: ${area.label}
Module: ${area.moduleId}
Area ID: ${area.id}
Description: ${area.description}

### Scope (files/directories to work in)
${area.scope.map((s) => `- ${s}`).join('\n')}

### Features to Complete
${area.features.map((f) => `- [ ] ${f.name} (status: ${f.status})`).join('\n')}

### Dependencies (already completed)
${area.dependsOn.length > 0 ? area.dependsOn.map((d) => `- ${d}`).join('\n') : '- none'}

${area.retries > 0 ? `### Previous Attempts: ${area.retries} (review errors and try a different approach)` : ''}`);

  // Section 5: Completion format
  sections.push(`## Completion
When you are done, output the following block exactly (replace values):

${RESULT_START}
{
  "areaId": "${area.id}",
  "completed": true,
  "features": {
${area.features.map((f) => `    "${f.name}": "pass"`).join(',\n')}
  },
  "filesCreated": [],
  "filesModified": [],
  "learnings": [],
  "summary": "Brief summary of what was done"
}
${RESULT_END}

Set any feature to "fail" if you could not complete it, and explain why in "learnings".`);

  return sections.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
//  Result Parsing
// ---------------------------------------------------------------------------

export function parseAreaResult(output: string): ParsedAreaResult | null {
  const startIdx = output.indexOf(RESULT_START);
  const endIdx = output.indexOf(RESULT_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  const jsonStr = output.slice(startIdx + RESULT_START.length, endIdx).trim();

  try {
    const parsed = JSON.parse(jsonStr) as ParsedAreaResult;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
//  Execution
// ---------------------------------------------------------------------------

export async function executeArea(
  config: ExecutorConfig,
  plan: HarnessPlan,
  area: ModuleArea,
  learnings: string,
  recentProgress: ProgressEntry[],
): Promise<ExecutorResult> {
  const prompt = buildAreaPrompt(plan, area, learnings, recentProgress);
  const startTime = Date.now();
  const errors: string[] = [];

  const args = ['-p', prompt, '--output-format', 'stream-json'];

  if (config.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (config.bareMode) {
    args.push('--bare');
  }

  if (config.allowedTools.length > 0) {
    args.push('--allowedTools', config.allowedTools.join(','));
  }

  return new Promise<ExecutorResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let sessionId: string | null = null;
    let costUsd: number | null = null;
    let timedOut = false;

    const proc = spawn('claude', args, {
      cwd: plan.projectPath,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, config.sessionTimeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;

      // Extract metadata from stream-json output
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.session_id) sessionId = msg.session_id;
          if (msg.cost_usd != null) costUsd = msg.cost_usd;
        } catch {
          // not all lines are JSON
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;

      if (timedOut) {
        errors.push(`Session timed out after ${config.sessionTimeoutMs}ms`);
      }

      if (code !== 0 && code !== null) {
        errors.push(`Process exited with code ${code}`);
      }

      if (stderr.trim()) {
        errors.push(stderr.trim().slice(0, 2000));
      }

      // Extract assistant text from stream-json
      let assistantOutput = '';
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text') {
                assistantOutput += block.text + '\n';
              }
            }
          }
        } catch {
          // raw text fallback
          assistantOutput += line + '\n';
        }
      }

      resolve({
        completed: code === 0 && !timedOut,
        sessionId,
        durationMs,
        assistantOutput,
        touchedTsx: /\.(tsx|jsx)/.test(assistantOutput),
        touchedCss: /\.(css|scss)/.test(assistantOutput),
        touchedStore: /store|slice|zustand/i.test(assistantOutput),
        touchedI18n: /i18n|translation|useTranslation|\.ts\b/.test(assistantOutput),
        exitCode: code,
        costUsd,
        errors,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      errors.push(`Spawn error: ${err.message}`);
      resolve({
        completed: false,
        sessionId: null,
        durationMs: Date.now() - startTime,
        assistantOutput: '',
        touchedTsx: false,
        touchedCss: false,
        touchedStore: false,
        touchedI18n: false,
        exitCode: null,
        costUsd: null,
        errors,
      });
    });
  });
}

// ---------------------------------------------------------------------------
//  Learnings (AGENTS.md)
// ---------------------------------------------------------------------------

export function readAgentsMd(statePath: string): string {
  const path = join(statePath, 'AGENTS.md');
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

export function appendAgentsMd(statePath: string, learnings: string[]): void {
  if (learnings.length === 0) return;
  const path = join(statePath, 'AGENTS.md');
  const date = new Date().toISOString().slice(0, 10);
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '# Harness Learnings\n\n';
  const newContent = learnings.map((l) => `- [${date}] ${l}`).join('\n');
  writeFileSync(path, existing + '\n' + newContent + '\n', 'utf-8');
}
