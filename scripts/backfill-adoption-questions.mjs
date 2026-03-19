#!/usr/bin/env node
/**
 * Backfill adoption_questions into existing template JSON files.
 *
 * Reads each template, sends its payload to Claude to generate domain-specific
 * adoption questions, and writes them back into the template JSON.
 *
 * Usage:
 *   node scripts/backfill-adoption-questions.mjs                  # All templates
 *   node scripts/backfill-adoption-questions.mjs --limit 5        # First 5 only
 *   node scripts/backfill-adoption-questions.mjs --dry-run        # Preview without writing
 *   node scripts/backfill-adoption-questions.mjs --skip-existing  # Skip templates that already have questions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT, 'scripts', 'templates');

// ============================================================================
// Find all template JSON files
// ============================================================================

function findTemplateFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue; // skip _debug, _tmp, etc.
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...findTemplateFiles(full));
    } else if (entry.endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

// ============================================================================
// Claude CLI Runner
// ============================================================================

function runClaudeCli(promptText, timeoutSecs = 120) {
  const tmpFile = join(TEMPLATES_DIR, '_tmp_aq_prompt.txt');
  writeFileSync(tmpFile, promptText, 'utf-8');

  try {
    const cmd = `claude -p - --dangerously-skip-permissions --max-turns 1 --model claude-sonnet-4-6 < "${tmpFile.replace(/\\/g, '/')}"`;
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutSecs * 1000,
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    return { ok: true, output };
  } catch (err) {
    if (err.stdout) return { ok: true, output: err.stdout };
    return { ok: false, error: (err.stderr || err.message || String(err)).substring(0, 200) };
  } finally {
    try { writeFileSync(tmpFile, '', 'utf-8'); } catch { /* ignore */ }
  }
}

// ============================================================================
// Extract JSON array from LLM output
// ============================================================================

function extractJsonArray(text) {
  // Try fenced blocks
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = fenced.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  // Try bare array
  const start = text.indexOf('[');
  if (start >= 0) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.substring(start, i + 1));
          } catch { /* continue */ }
        }
      }
    }
  }

  return null;
}

// ============================================================================
// Build question generation prompt
// ============================================================================

function buildQuestionPrompt(template) {
  const payload = template.payload || {};
  const sp = payload.structured_prompt || {};

  // Build a focused summary for question generation
  const summary = {
    name: template.name,
    description: template.description,
    category: template.category,
    identity: sp.identity?.substring(0, 500),
    instructions: sp.instructions?.substring(0, 1000),
    connectors: (payload.suggested_connectors || []).map(c => ({
      name: c.name, label: c.label, auth_type: c.auth_type, role: c.role,
    })),
    tools: payload.suggested_tools,
    triggers: (payload.suggested_triggers || []).map(t => ({
      trigger_type: t.trigger_type, description: t.description,
    })),
    use_case_flows: (payload.use_case_flows || []).map(f => ({
      id: f.id, name: f.name, description: f.description,
    })),
  };

  return `Generate 4-8 adoption questions for this Personas template.
These questions will be shown to users BEFORE the template is adopted into a persona.
The goal is to understand the user's specific context so the persona can be customized perfectly.

## Template Summary
${JSON.stringify(summary, null, 2)}

## Question Requirements

Generate DOMAIN-SPECIFIC questions. Generic questions like "What's your name?" are useless.
Good questions extract the information needed to customize this specific persona:
- For an invoice template: billing cycles, payment terms, tax handling
- For a security scanner: severity thresholds, compliance frameworks, notification urgency
- For a marketing tool: KPI targets, campaign types, attribution model

## Required categories (at least one each):
1. "intent" — What specific use case? (dimension: use-cases)
2. "domain" — User's context, team, industry (dimension: use-cases)
3. "boundaries" — What should it NEVER do? (dimension: error-handling)
4. "human_in_the_loop" — What needs approval? (dimension: human-review)

## Optional categories:
5. "configuration" — Operational settings (dimension: triggers or connectors)
6. "credentials" — Which workspace/project (dimension: connectors)
7. "memory" — What to remember (dimension: memory)
8. "quality" — Output preferences (dimension: use-cases)

Return ONLY a JSON array (no markdown fences, no commentary):
[{
  "id": "aq_intent_1",
  "category": "intent",
  "question": "Specific question text",
  "type": "select",
  "options": ["Option A", "Option B", "Option C"],
  "default": "Option A",
  "context": "Why this matters",
  "dimension": "use-cases"
}]

Rules:
- type: "select" | "text" | "boolean"
- For select: include 2-5 SPECIFIC options derived from the template's capabilities
- id prefix: "aq_" + category + "_" + number
- Each question MUST have dimension field
`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const opts = {
    limit: null,
    dryRun: false,
    skipExisting: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--skip-existing': opts.skipExisting = true; break;
      case '--help':
        console.log('Usage: node scripts/backfill-adoption-questions.mjs [--limit N] [--dry-run] [--skip-existing]');
        process.exit(0);
    }
  }

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Adoption Questions Backfill                    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let templateFiles = findTemplateFiles(TEMPLATES_DIR);
  console.log(`Found ${templateFiles.length} template files\n`);

  if (opts.skipExisting) {
    templateFiles = templateFiles.filter(f => {
      const tpl = JSON.parse(readFileSync(f, 'utf-8'));
      return !tpl.payload?.adoption_questions?.length;
    });
    console.log(`${templateFiles.length} templates need adoption questions\n`);
  }

  if (opts.limit) {
    templateFiles = templateFiles.slice(0, opts.limit);
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < templateFiles.length; i++) {
    const filePath = templateFiles[i];
    const relPath = relative(TEMPLATES_DIR, filePath);
    const template = JSON.parse(readFileSync(filePath, 'utf-8'));

    process.stdout.write(`[${i + 1}/${templateFiles.length}] ${relPath} ... `);

    if (opts.dryRun) {
      console.log('SKIP (dry run)');
      skipped++;
      continue;
    }

    const prompt = buildQuestionPrompt(template);
    const result = runClaudeCli(prompt);

    if (!result.ok) {
      console.log(`FAIL: ${result.error}`);
      failed++;
      continue;
    }

    const questions = extractJsonArray(result.output);
    if (!questions || questions.length < 3) {
      console.log(`FAIL: Could not extract valid questions array (got ${questions?.length || 0})`);
      failed++;
      continue;
    }

    // Validate question structure
    const valid = questions.filter(q =>
      q.id && q.category && q.question && q.type && q.dimension
    );

    if (valid.length < 3) {
      console.log(`FAIL: Only ${valid.length} valid questions (need >= 3)`);
      failed++;
      continue;
    }

    // Write back
    template.payload = template.payload || {};
    template.payload.adoption_questions = valid;
    writeFileSync(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8');

    console.log(`OK (${valid.length} questions)`);
    success++;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${success} success, ${failed} failed, ${skipped} skipped`);
  console.log(`Total: ${templateFiles.length} templates processed`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
