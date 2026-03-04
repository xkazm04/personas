/**
 * Validates CLI run results against criteria and produces scores.
 */
import type { CliRunResult, ValidationCriteria, ValidationResult, WorkspaceContext } from './types';

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
  const TOOL_ALIASES: Record<string, string[]> = {
    read: ['read', 'read_file', 'readfile', 'cat'],
    write: ['write', 'write_file', 'writefile', 'create_file', 'save_file'],
    bash: ['bash', 'run_shell_command', 'shell', 'execute', 'terminal', 'run_command'],
    edit: ['edit', 'edit_file', 'editfile', 'replace', 'patch'],
    glob: ['glob', 'list_files', 'listfiles', 'find_files'],
    grep: ['grep', 'search_files', 'searchfiles', 'search', 'grep_search'],
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
