#!/usr/bin/env node
/**
 * parse-transcripts.mjs — Extract behavioral signals from Claude Code session transcripts.
 *
 * Business-agnostic: captures HOW the user works, not WHAT they build.
 * Filters out automated sessions (build, test, eval pipelines).
 *
 * Usage: node parse-transcripts.mjs [--days 7] [--max-sessions 30]
 * Output: JSON to stdout
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const DAYS = parseInt(arg('days', '7'), 10);
const MAX_SESSIONS = parseInt(arg('max-sessions', '30'), 10);
const MAX_FILE_BYTES = 25 * 1024 * 1024; // skip files > 25 MB
const cutoff = Date.now() - DAYS * 86400000;
const projectsDir = join(homedir(), '.claude', 'projects');

// ── Filters ───────────────────────────────────────────────────────────

// Automated / temp sessions — not human interaction
const SKIP_DIR = /(?:build-session|build-test|integration-ws|llm-eval|test-coord|test-exec|AppData.Local.Temp)/i;

function isAutomated(dirName) {
  return SKIP_DIR.test(dirName);
}

// Extract a short project slug from the encoded directory name
// "C--Users-mkdol-dolla-personas" → "personas"
// Strips worktree suffixes
function projectSlug(dirName) {
  const clean = dirName.replace(/--claude-worktrees-.*$/, '');
  const parts = clean.split('-').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

// Strip system-injected content and detect non-human messages
function stripInjected(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[a-z][\w-]*>[\s\S]*?<\/[a-z][\w-]*>/g, '')
    .trim();
}

// Skill invocations look like user messages but are injected SKILL.md content
// They start with "Base directory for this skill:" or frontmatter "---\nname:"
const SKILL_INVOCATION_RE = /^(?:Base directory for this skill:|---\s*\nname:)/;
function isSkillInvocation(text) {
  return SKILL_INVOCATION_RE.test(text) || text.length > 2000;
}

// ── Signal detection ──────────────────────────────────────────────────

const CORRECTION_RE = [
  /^no[,.\s!]/i, /^not that/i, /^wrong/i, /^stop\b/i,
  /\bdon'?t\b.*?\b(?:do|add|use|make|create|include|put|write)\b/i,
  /\bnever\b.*?\b(?:add|do|use|make)\b/i,
  /\bactually[,\s]/i, /\binstead[,\s]/i,
  /\brevert\b/i, /\bundo\b/i, /\bthat'?s not\b/i,
  /\bI (?:said|meant|asked)\b/i, /\bnot what I\b/i,
  /\bforget (?:that|it|about)\b/i, /\bignore (?:that|it)\b/i,
];

const POSITIVE_RE = [
  /^(?:yes|yeah|yep|exactly|perfect|great|nice|good|correct|right)\b/i,
  /\bthat works\b/i, /\blooks good\b/i, /\bwell done\b/i,
  /\bkeep doing\b/i, /\bthe right call\b/i,
  /\blove it\b/i, /\bspot on\b/i, /\bnailed it\b/i,
];

const TASK_CATS = {
  debugging: /\b(?:bug|error|fix|broken|crash|fail|issue|debug|wrong)\b/i,
  feature:   /\b(?:add|create|implement|build|new feature|introduce)\b/i,
  refactor:  /\b(?:refactor|clean|simplify|extract|rename|move|reorganize)\b/i,
  research:  /\b(?:research|explore|investigate|how does|feasibility|understand|look into)\b/i,
  review:    /\b(?:review|check|verify|audit|look at|assess)\b/i,
  testing:   /\b(?:test|spec|assert|coverage|mock|e2e)\b/i,
  config:    /\b(?:config|setup|install|dependency|package|env|migration)\b/i,
  design:    /\b(?:design|architect|plan|approach|strategy|proposal)\b/i,
  ui:        /\b(?:ui|ux|layout|style|css|component|button|modal|page|theme)\b/i,
  docs:      /\b(?:doc|readme|comment|explain|describe|write.up)\b/i,
};

// ── JSONL parsing ─────────────────────────────────────────────────────

function parseTranscript(filePath) {
  let raw;
  try {
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) return null; // skip huge files
    raw = readFileSync(filePath, 'utf8');
  } catch { return null; }

  const lines = raw.split('\n');
  const userMsgs = [];
  const toolCounts = {};
  let assistantChars = 0;

  for (const line of lines) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === 'user' && obj.message?.content) {
      const text = typeof obj.message.content === 'string'
        ? obj.message.content
        : Array.isArray(obj.message.content)
          ? obj.message.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
          : '';
      const cleaned = stripInjected(text);
      if (cleaned.length > 5 && !isSkillInvocation(cleaned)) userMsgs.push(cleaned);
    }

    if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_use' && block.name) {
          const name = block.name.startsWith('mcp__')
            ? 'MCP:' + block.name.split('__')[1]
            : block.name;
          toolCounts[name] = (toolCounts[name] || 0) + 1;
        }
        if (block.type === 'text') {
          assistantChars += (block.text || '').length;
        }
      }
    }
  }

  return { userMsgs, toolCounts, assistantChars };
}

function analyzeSession(userMsgs, toolCounts) {
  const corrections = [];
  const positives = [];
  const categories = {};

  for (let i = 0; i < userMsgs.length; i++) {
    const text = userMsgs[i];
    const isFirst = i === 0;

    // Corrections are short, direct messages (< 500 chars).
    // Long messages are new instructions, not corrections.
    if (!isFirst && text.length < 500 && CORRECTION_RE.some(r => r.test(text)))
      corrections.push(text.slice(0, 300));

    if (!isFirst && text.length < 150 && POSITIVE_RE.some(r => r.test(text)))
      positives.push(text.slice(0, 200));

    for (const [cat, re] of Object.entries(TASK_CATS)) {
      if (re.test(text)) categories[cat] = (categories[cat] || 0) + 1;
    }
  }

  return {
    msgCount: userMsgs.length,
    intent: userMsgs[0]?.slice(0, 300) || '',
    corrections,
    positives,
    categories,
    toolCounts,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  let dirs;
  try {
    dirs = readdirSync(projectsDir).filter(d => !isAutomated(d));
  } catch (e) {
    console.error(JSON.stringify({ error: `Cannot read ${projectsDir}: ${e.message}` }));
    process.exit(1);
  }

  // Collect all recent JSONL files across all project dirs
  const candidates = [];
  for (const dir of dirs) {
    const dp = join(projectsDir, dir);
    let files;
    try { files = readdirSync(dp); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = join(dp, f);
      try {
        const st = statSync(full);
        if (st.mtimeMs > cutoff) candidates.push({ path: full, mtime: st.mtimeMs, dir });
      } catch { /* skip */ }
    }
  }

  // Sort by recency, cap
  candidates.sort((a, b) => b.mtime - a.mtime);
  const selected = candidates.slice(0, MAX_SESSIONS);

  const sessions = [];
  for (const { path, mtime, dir } of selected) {
    const parsed = parseTranscript(path);
    if (!parsed || parsed.userMsgs.length < 2) continue;
    const analysis = analyzeSession(parsed.userMsgs, parsed.toolCounts);
    sessions.push({
      date: new Date(mtime).toISOString().split('T')[0],
      project: projectSlug(dir),
      ...analysis,
    });
  }

  // ── Aggregate ─────────────────────────────────────────────────────
  const out = {
    meta: {
      analyzedAt: new Date().toISOString(),
      periodDays: DAYS,
      sessionsAnalyzed: sessions.length,
    },
    volume: {
      totalUserMessages: sessions.reduce((s, x) => s + x.msgCount, 0),
      avgPerSession: sessions.length
        ? +(sessions.reduce((s, x) => s + x.msgCount, 0) / sessions.length).toFixed(1)
        : 0,
    },
    corrections: {
      count: sessions.reduce((s, x) => s + x.corrections.length, 0),
      samples: sessions.flatMap(s => s.corrections).slice(0, 20),
    },
    positiveSignals: {
      count: sessions.reduce((s, x) => s + x.positives.length, 0),
      samples: sessions.flatMap(s => s.positives).slice(0, 15),
    },
    taskCategories: {},
    toolUsage: {},
    projectDistribution: {},
    sessionIntents: sessions.map(s => ({
      date: s.date, project: s.project, intent: s.intent,
    })),
  };

  for (const s of sessions) {
    for (const [c, n] of Object.entries(s.categories))
      out.taskCategories[c] = (out.taskCategories[c] || 0) + n;
    for (const [t, n] of Object.entries(s.toolCounts))
      out.toolUsage[t] = (out.toolUsage[t] || 0) + n;
    out.projectDistribution[s.project] =
      (out.projectDistribution[s.project] || 0) + 1;
  }

  // Sort descending
  const sortDesc = obj =>
    Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
  out.taskCategories = sortDesc(out.taskCategories);
  out.toolUsage = sortDesc(out.toolUsage);
  out.projectDistribution = sortDesc(out.projectDistribution);

  console.log(JSON.stringify(out, null, 2));
}

main();
