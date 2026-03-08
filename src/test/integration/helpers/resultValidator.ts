/**
 * Validates CLI run results against criteria and produces scores.
 */
import type { CliRunResult, ValidationCriteria, ValidationResult, WorkspaceContext, QualityDimension, QualityReport } from './types';

export function validateResult(
  result: CliRunResult,
  criteria: ValidationCriteria,
  workspace?: WorkspaceContext,
): ValidationResult {
  const details: string[] = [];
  const penalties: string[] = [];
  let totalChecks = 0;
  let passedChecks = 0;

  // 1. Exit success
  if (criteria.expectSuccess !== undefined) {
    totalChecks++;
    const succeeded = result.exitCode === 0 && !result.timedOut;
    if (criteria.expectSuccess === succeeded) {
      passedChecks++;
      details.push(`[PASS] Exit: expected=${criteria.expectSuccess}, actual=${succeeded}`);
    } else {
      details.push(
        `[FAIL] Exit: expected=${criteria.expectSuccess}, actual=${succeeded} (code=${result.exitCode}, timeout=${result.timedOut})`,
      );
      penalties.push('Unexpected exit status');
    }
  }

  // 2. Output contains ALL
  if (criteria.outputContains) {
    const text = result.assistantText.toLowerCase();
    for (const needle of criteria.outputContains) {
      totalChecks++;
      if (text.includes(needle.toLowerCase())) {
        passedChecks++;
        details.push(`[PASS] Contains: "${needle.slice(0, 80)}"`);
      } else {
        details.push(`[FAIL] Missing: "${needle.slice(0, 80)}"`);
        penalties.push(`Missing: "${needle.slice(0, 50)}"`);
      }
    }
  }

  // 3. Output contains ANY
  if (criteria.outputContainsAny) {
    totalChecks++;
    const text = result.assistantText.toLowerCase();
    const found = criteria.outputContainsAny.some((n) => text.includes(n.toLowerCase()));
    if (found) {
      passedChecks++;
      details.push('[PASS] Contains at least one expected term');
    } else {
      details.push(`[FAIL] Missing all: ${criteria.outputContainsAny.join(', ')}`);
      penalties.push('No expected terms found');
    }
  }

  // 4. Output excludes
  if (criteria.outputExcludes) {
    const text = result.assistantText.toLowerCase();
    for (const excluded of criteria.outputExcludes) {
      totalChecks++;
      if (!text.includes(excluded.toLowerCase())) {
        passedChecks++;
        details.push(`[PASS] Excludes: "${excluded.slice(0, 60)}"`);
      } else {
        details.push(`[FAIL] Should not contain: "${excluded.slice(0, 60)}"`);
        penalties.push(`Unexpected: "${excluded.slice(0, 40)}"`);
      }
    }
  }

  // 5. Regex matches
  if (criteria.outputMatchesRegex) {
    for (const regex of criteria.outputMatchesRegex) {
      totalChecks++;
      if (regex.test(result.assistantText)) {
        passedChecks++;
        details.push(`[PASS] Matches: /${regex.source.slice(0, 60)}/`);
      } else {
        details.push(`[FAIL] No match: /${regex.source.slice(0, 60)}/`);
        penalties.push('Regex not matched');
      }
    }
  }

  // 6. Tools used (with cross-provider name aliases)
  // Claude: Read, Write, Bash, Edit, Glob, Grep
  // Gemini: read_file, write_file, run_shell_command, edit_file, list_files, search_files
  // Tool name aliases across providers:
  // Claude:  Read, Write, Bash, Edit, Glob, Grep
  // Gemini:  read_file, write_file, run_shell_command, edit_file, list_files, search_files
  // Copilot: view, create/apply_patch, powershell/task, apply_patch, report_intent, sql, web_fetch
  const TOOL_ALIASES: Record<string, string[]> = {
    read: ['read', 'read_file', 'readfile', 'cat', 'view', 'task', 'report_intent', 'web_fetch', 'sql'],
    write: ['write', 'write_file', 'writefile', 'create_file', 'save_file', 'create', 'apply_patch', 'report_intent'],
    bash: ['bash', 'run_shell_command', 'shell', 'execute', 'terminal', 'run_command', 'powershell', 'task'],
    edit: ['edit', 'edit_file', 'editfile', 'replace', 'patch', 'apply_patch'],
    glob: ['glob', 'list_files', 'listfiles', 'find_files'],
    grep: ['grep', 'search_files', 'searchfiles', 'search', 'grep_search'],
    fetch: ['fetch', 'web_fetch', 'web_search', 'browse'],
  };

  if (criteria.toolsUsed) {
    for (const tool of criteria.toolsUsed) {
      totalChecks++;
      const toolLower = tool.toLowerCase();
      const aliases = TOOL_ALIASES[toolLower] ?? [toolLower];

      const found = result.toolsUsed.some((t) => {
        const tLower = t.toLowerCase();
        return aliases.some((alias) => tLower.includes(alias));
      });

      if (found) {
        passedChecks++;
        details.push(`[PASS] Tool used: ${tool}`);
      } else {
        details.push(`[FAIL] Tool missing: ${tool} (used: ${result.toolsUsed.join(', ')})`);
        penalties.push(`Missing tool: ${tool}`);
      }
    }
  }

  // 7. Tool call count
  if (criteria.minToolCalls !== undefined) {
    totalChecks++;
    if (result.toolCallCount >= criteria.minToolCalls) {
      passedChecks++;
      details.push(`[PASS] Tools >= ${criteria.minToolCalls} (actual: ${result.toolCallCount})`);
    } else {
      details.push(`[FAIL] Tools ${result.toolCallCount} < min ${criteria.minToolCalls}`);
      penalties.push('Insufficient tool usage');
    }
  }
  if (criteria.maxToolCalls !== undefined) {
    totalChecks++;
    if (result.toolCallCount <= criteria.maxToolCalls) {
      passedChecks++;
      details.push(`[PASS] Tools <= ${criteria.maxToolCalls} (actual: ${result.toolCallCount})`);
    } else {
      details.push(`[FAIL] Tools ${result.toolCallCount} > max ${criteria.maxToolCalls}`);
      penalties.push('Excessive tool usage');
    }
  }

  // 8. Files created
  if (criteria.filesCreated && workspace) {
    for (const filePath of criteria.filesCreated) {
      totalChecks++;
      if (workspace.fileExists(filePath)) {
        passedChecks++;
        details.push(`[PASS] File created: ${filePath}`);
      } else {
        details.push(`[FAIL] File not created: ${filePath}`);
        penalties.push(`Missing file: ${filePath}`);
      }
    }
  }

  // 9. File content validation
  if (criteria.fileContentContains && workspace) {
    for (const [filePath, substrings] of Object.entries(criteria.fileContentContains)) {
      const content = workspace.readFile(filePath);
      if (!content) {
        totalChecks += substrings.length;
        for (const sub of substrings) {
          details.push(`[FAIL] Cannot read ${filePath} for "${sub.slice(0, 40)}"`);
          penalties.push(`File unreadable: ${filePath}`);
        }
        continue;
      }
      const lower = content.toLowerCase();
      for (const sub of substrings) {
        totalChecks++;
        if (lower.includes(sub.toLowerCase())) {
          passedChecks++;
          details.push(`[PASS] ${filePath} contains "${sub.slice(0, 40)}"`);
        } else {
          details.push(`[FAIL] ${filePath} missing "${sub.slice(0, 40)}"`);
          penalties.push(`Content missing in ${filePath}`);
        }
      }
    }
  }

  // 10. Duration limit
  if (criteria.maxDurationMs !== undefined) {
    totalChecks++;
    if (result.totalDurationMs <= criteria.maxDurationMs) {
      passedChecks++;
      details.push(`[PASS] Duration ${result.totalDurationMs}ms <= ${criteria.maxDurationMs}ms`);
    } else {
      details.push(`[FAIL] Duration ${result.totalDurationMs}ms > ${criteria.maxDurationMs}ms`);
      penalties.push('Too slow');
    }
  }

  // 11. Custom validation
  if (criteria.custom) {
    totalChecks++;
    const customResult = criteria.custom(result);
    if (customResult.passed) {
      passedChecks++;
      details.push(`[PASS] Custom: ${customResult.detail}`);
    } else {
      details.push(`[FAIL] Custom: ${customResult.detail}`);
      penalties.push(`Custom check failed`);
    }
  }

  const score = totalChecks > 0 ? passedChecks / totalChecks : 0;
  const passed = penalties.length === 0 && totalChecks > 0;

  return { passed, score, details, penalties };
}

// ═══════════════════════════════════════════════════════════════════════════
// Quality scoring — business + technical dimensions
// ═══════════════════════════════════════════════════════════════════════════

export function scoreQuality(
  result: CliRunResult,
  featureArea: string,
  businessChecks: Array<{ name: string; weight: number; check: (text: string) => { score: number; detail: string } }>,
): QualityReport {
  const text = result.assistantText;

  // Technical dimensions (universal)
  const technical: QualityDimension[] = [
    {
      name: 'Completion',
      weight: 2,
      ...(() => {
        if (result.timedOut) return { score: 0, detail: 'Timed out' };
        if (result.exitCode !== 0) return { score: 0.3, detail: `Exit code ${result.exitCode}` };
        return { score: 1, detail: 'Completed successfully' };
      })(),
    },
    {
      name: 'Response Length',
      weight: 1,
      ...(() => {
        const len = text.length;
        if (len < 50) return { score: 0.1, detail: `Very short (${len} chars)` };
        if (len < 200) return { score: 0.5, detail: `Short (${len} chars)` };
        if (len > 10000) return { score: 0.7, detail: `Very long (${len} chars)` };
        return { score: 1, detail: `Good length (${len} chars)` };
      })(),
    },
    {
      name: 'Tool Usage',
      weight: 1,
      ...(() => {
        if (result.toolCallCount === 0) return { score: 0.5, detail: 'No tools used' };
        if (result.toolCallCount > 20) return { score: 0.6, detail: `Excessive (${result.toolCallCount} calls)` };
        return { score: 1, detail: `${result.toolCallCount} tool calls` };
      })(),
    },
    {
      name: 'Speed',
      weight: 1,
      ...(() => {
        const ms = result.totalDurationMs;
        if (ms < 10000) return { score: 1, detail: `Fast (${(ms / 1000).toFixed(1)}s)` };
        if (ms < 30000) return { score: 0.8, detail: `Normal (${(ms / 1000).toFixed(1)}s)` };
        if (ms < 60000) return { score: 0.5, detail: `Slow (${(ms / 1000).toFixed(1)}s)` };
        return { score: 0.2, detail: `Very slow (${(ms / 1000).toFixed(1)}s)` };
      })(),
    },
  ];

  // Business dimensions (feature-specific)
  const business: QualityDimension[] = businessChecks.map((bc) => {
    const result = bc.check(text);
    return { name: bc.name, weight: bc.weight, score: result.score, detail: result.detail };
  });

  // Weighted average
  const allDims = [...technical, ...business];
  const totalWeight = allDims.reduce((sum, d) => sum + d.weight, 0);
  const weightedSum = allDims.reduce((sum, d) => sum + d.score * d.weight, 0);
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const grade: QualityReport['grade'] =
    overallScore >= 0.9 ? 'A' : overallScore >= 0.75 ? 'B' : overallScore >= 0.6 ? 'C' : overallScore >= 0.4 ? 'D' : 'F';

  return { technical, business, overallScore, grade };
}

export function formatQualityReport(report: QualityReport): string {
  const lines: string[] = [`Grade: ${report.grade} (${(report.overallScore * 100).toFixed(0)}%)`];
  lines.push('  Technical:');
  for (const d of report.technical) {
    lines.push(`    ${d.name}: ${(d.score * 100).toFixed(0)}% — ${d.detail}`);
  }
  lines.push('  Business:');
  for (const d of report.business) {
    lines.push(`    ${d.name}: ${(d.score * 100).toFixed(0)}% — ${d.detail}`);
  }
  return lines.join('\n');
}

/** Build a diagnostic string for assertion messages when validation fails. */
export function formatDiagnostic(result: CliRunResult, validation: ValidationResult): string {
  const lines: string[] = [
    `--- Validation FAILED ---`,
    `Provider: ${result.provider}`,
    `Exit code: ${result.exitCode}, Timed out: ${result.timedOut}`,
    `Duration: ${result.totalDurationMs}ms`,
    `Tools used: [${result.toolsUsed.join(', ')}] (${result.toolCallCount} calls)`,
    `Assistant text (${result.assistantText.length} chars): "${result.assistantText.slice(0, 500)}"`,
  ];
  if (result.stderr) {
    lines.push(`Stderr (first 300): "${result.stderr.slice(0, 300)}"`);
  }
  lines.push(`Penalties: [${validation.penalties.join('; ')}]`);
  lines.push(`Details:`);
  for (const d of validation.details) {
    lines.push(`  ${d}`);
  }
  return lines.join('\n');
}
