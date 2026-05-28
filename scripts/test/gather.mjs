// GATHER layer (docs/test/run-protocol.md §4) — collect everything a run
// produced into an immutable bundle, read from SQLite truth (never trusting a
// command's success flag). Keyed on the run window + the team's persona ids.
import { writeFileSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openRead, MAIN_DB, USER_DB } from './db.mjs';

function inClause(n) {
  return Array.from({ length: n }, () => '?').join(',');
}

/**
 * Build a run bundle. Reads main + user DBs read-only.
 * @returns {object} summary (counts + verdict-relevant facts)
 */
export function gatherBundle({ runId, teamId, teamName, personaIds, sinceIso, repo, preRepoHead, outRoot = join('docs', 'test', 'runs') }) {
  const dir = join(outRoot, runId);
  mkdirSync(dir, { recursive: true });
  const db = openRead(MAIN_DB);

  // --- executions ---
  const ph = inClause(personaIds.length);
  const executions = db
    .prepare(
      `SELECT id, persona_id, status, business_outcome, model_used, input_tokens, output_tokens,
              cost_usd, duration_ms, error_message, started_at, completed_at, created_at,
              trigger_id, use_case_id, output_data, tool_steps, log_file_path,
              retry_of_execution_id, retry_count
       FROM persona_executions
       WHERE persona_id IN (${ph}) AND created_at >= ?
       ORDER BY created_at ASC`,
    )
    .all(...personaIds, sinceIso);

  // copy logs (bounded) into the bundle for transcript-level inspection
  const logsDir = join(dir, 'logs');
  let logsCopied = 0;
  for (const e of executions) {
    if (e.log_file_path && existsSync(e.log_file_path)) {
      try {
        mkdirSync(logsDir, { recursive: true });
        copyFileSync(e.log_file_path, join(logsDir, `${e.id}.log`));
        logsCopied += 1;
      } catch {
        /* best-effort */
      }
    }
  }

  // --- reviews ---
  const reviews = db
    .prepare(
      `SELECT id, execution_id, persona_id, title, description, severity, status, reviewer_notes,
              resolved_at, created_at, use_case_id
       FROM persona_manual_reviews WHERE persona_id IN (${ph}) AND created_at >= ? ORDER BY created_at ASC`,
    )
    .all(...personaIds, sinceIso);

  // --- memories (incl. the review-sourced `learned` ones) ---
  const memories = db
    .prepare(
      `SELECT id, persona_id, title, content, category, importance, tier, source_execution_id, tags, created_at, use_case_id
       FROM persona_memories WHERE persona_id IN (${ph}) AND created_at >= ? ORDER BY created_at ASC`,
    )
    .all(...personaIds, sinceIso);

  // --- events (handoff graph actually traversed) ---
  const events = db
    .prepare(
      `SELECT id, event_type, source_type, source_id, target_persona_id, status, processed_at, created_at, use_case_id
       FROM persona_events
       WHERE created_at >= ? AND (target_persona_id IN (${ph}) OR source_id IN (${ph}))
       ORDER BY created_at ASC`,
    )
    .all(sinceIso, ...personaIds, ...personaIds);

  // --- pipeline runs (if the team was driven as a pipeline) ---
  const pipelineRuns = db
    .prepare(`SELECT id, status, node_statuses, started_at, completed_at, error_message FROM pipeline_runs WHERE team_id = ? AND started_at >= ?`)
    .all(teamId, sinceIso);

  db.close();

  // --- approvals (companion brain, user DB) ---
  let approvals = [];
  try {
    const u = openRead(USER_DB);
    approvals = u
      .prepare(`SELECT id, kind, status, human_review_id, created_at, resolved_at FROM companion_approval WHERE created_at >= ? ORDER BY created_at ASC`)
      .all(sinceIso);
    u.close();
  } catch {
    /* user db may be locked/absent; approvals are Athena-scoped and often empty for direct runs */
  }

  // --- repo diff (code-track) ---
  let diff = null;
  if (repo?.root && preRepoHead && existsSync(repo.root)) {
    try {
      diff = execFileSync('git', ['-C', repo.root, 'diff', `${preRepoHead}..HEAD`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      // also capture uncommitted working-tree changes the run may have made
      const wt = execFileSync('git', ['-C', repo.root, 'diff'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      diff = (diff || '') + (wt ? `\n--- UNCOMMITTED WORKING TREE ---\n${wt}` : '');
      // CRITICAL: `git diff` does NOT show untracked files, and most doc-track
      // artifacts (ADRs, new tests, new docs) are brand-new untracked files.
      // Capture them explicitly as synthetic "diff --git" blocks so the
      // grounding evaluator + a reviewer can see the team's actual output.
      const untracked = execFileSync('git', ['-C', repo.root, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const TEXT_EXT = /\.(md|txt|ts|tsx|js|jsx|mjs|rs|py|go|java|json|css|sql|toml|yaml|yml|adr)$/i;
      let untrackedBlock = '';
      for (const rel of untracked) {
        if (!TEXT_EXT.test(rel)) continue;
        try {
          const abs = join(repo.root, rel);
          const content = readFileSync(abs, 'utf8');
          if (content.length > 512 * 1024) continue; // skip huge files
          // Synthetic new-file diff block so addedDocsFromPatch + tooling parse it.
          untrackedBlock += `\ndiff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n` + content.split('\n').map((l) => '+' + l).join('\n') + '\n';
        } catch {
          /* binary/unreadable — skip */
        }
      }
      if (untrackedBlock) diff += `\n--- NEW UNTRACKED FILES ---\n${untrackedBlock}`;
      writeFileSync(join(dir, 'repo.patch'), diff, 'utf8');
    } catch (e) {
      diff = `ERR computing diff: ${e.message}`;
    }
  }

  // --- write bundle ---
  const write = (name, obj) => writeFileSync(join(dir, name), JSON.stringify(obj, null, 2), 'utf8');
  write('executions.json', executions);
  write('reviews.json', reviews);
  write('memories.json', memories);
  write('events.json', events);
  write('approvals.json', approvals);
  write('pipeline_runs.json', pipelineRuns);

  const byStatus = (rows) => rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const summary = {
    runId,
    team: teamName,
    teamId,
    sinceIso,
    counts: {
      executions: executions.length,
      executionsByStatus: byStatus(executions),
      personasExecuted: [...new Set(executions.map((e) => e.persona_id))].length,
      reviews: reviews.length,
      memories: memories.length,
      events: events.length,
      eventsByStatus: byStatus(events),
      approvals: approvals.length,
      pipelineRuns: pipelineRuns.length,
      logsCopied,
    },
    cost_usd: executions.reduce((s, e) => s + (e.cost_usd || 0), 0),
    repoDiffBytes: diff && !diff.startsWith('ERR') ? diff.length : 0,
  };
  write('summary.json', summary);
  return summary;
}
