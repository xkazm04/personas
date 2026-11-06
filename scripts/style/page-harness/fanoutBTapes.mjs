// console-style fan-out, partition B: synthetic tape builders for fanoutBSurfaces.tsx.
// Owned by the partition-B builder; synthetic-tapes.mjs spreads it (wired by the Director).
// Fixture CODE with fake data only. Every page is POPULATED. Built on the Dev tools overview tape
// (Factory landing projects, contexts, KPIs) plus the extra commands each page reads.
import { consoleStyleTapes } from './consoleStyleTapes.mjs';

export function fanoutBTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const D = 24 * 60 * 60_000;
  const H = 60 * 60_000;
  const sql = (ms) => new Date(T0 - ms).toISOString().replace('T', ' ').slice(0, 19);
  const iso = (ms) => new Date(T0 - ms).toISOString();
  const base = () => consoleStyleTapes({ RECORDED_AT, PERSONAS }).builders['plugins/dev-tools-overview']();
  const withCalls = (id, note, extra) => {
    const b = base();
    return { ...b, module: id, note, calls: [...extra, ...b.calls] };
  };

  // ---- projects/goals -----------------------------------------------------
  const GOALS = [
    ['go-1', 'c-login', 'Recover login success above 95%', 'in_progress', 72, 14],
    ['go-2', 'c-login', 'Cut login p95 below 400ms', 'in_progress', 35, 30],
    ['go-3', 'c-metering', 'Stop dropping metered events', 'in_progress', 55, 9],
    ['go-4', 'c-queue', 'Retry failed jobs with backoff', 'done', 100, null],
    ['go-5', 'c-forms', 'Label every form field', 'open', 0, 45],
    ['go-6', null, 'Ship the billing export for finance', 'in_progress', 20, 21],
    ['go-7', 'c-queue', 'Dead-letter queue visible in the console', 'blocked', 10, 12],
  ].map(([id, context_id, title, status, progress, due], i) => ({
    id, project_id: 'p-atlas', parent_goal_id: null, context_id, kpi_id: null, order_index: i, title,
    description: i % 2 ? 'Tracked against the weekly KPI review.' : null, status, progress,
    target_date: due ? iso(-due * D).slice(0, 10) : null, started_at: status === 'open' ? null : sql((10 - i) * D),
    completed_at: status === 'done' ? sql(2 * D) : null, created_at: sql((20 - i) * D), updated_at: sql(i * D / 2),
  }));
  function goals() {
    return withCalls('projects/goals', 'Synthetic: 7 goals over the Atlas project in five states.', [
      { cmd: 'dev_tools_list_all_goals', response: GOALS },
      { cmd: 'dev_tools_list_goals', response: GOALS },
    ]);
  }

  // ---- plugins/dev-tools/task-runner -------------------------------------
  const TASKS = [
    ['t1', 'Fix the flaky login retry test', 'running', 62, 'quick'],
    ['t2', 'Add backoff to the job runner', 'running', 28, 'campaign'],
    ['t3', 'Label checkout form fields', 'queued', 0, 'quick'],
    ['t4', 'Migrate metering writes to the batch API', 'queued', 0, 'deep_build'],
    ['t5', 'Bump the Sentry SDK', 'failed', 40, 'quick'],
    ['t6', 'Document the webhook retry policy', 'completed', 100, 'quick'],
    ['t7', 'Remove the legacy session cookie', 'completed', 100, 'campaign'],
    ['t8', 'Trim the dashboard bundle', 'cancelled', 12, 'quick'],
  ].map(([id, title, status, progress_pct, depth], i) => ({
    id, project_id: 'p-atlas', title, description: 'Scoped by the Run Desk from an approved idea.', source_idea_id: null, goal_id: i < 4 ? 'go-1' : null,
    status, session_id: status === 'running' ? `sess-${i}` : null, progress_pct, output_lines: status === 'queued' ? 0 : 120 + i * 37,
    error: status === 'failed' ? 'Build exited with code 1 (type error in sentry.ts)' : null,
    started_at: status === 'queued' ? null : sql((i + 1) * H), completed_at: ['completed', 'failed', 'cancelled'].includes(status) ? sql(i * H / 2) : null,
    created_at: sql((i + 2) * H), updated_at: sql(i * 10 * 60_000), depth, parent_task_id: null, attempt: 1,
    worktree_path: null, worktree_branch: status === 'running' ? `autopilot/task-${i}` : null, worktree_fallback_reason: null,
  }));
  const counts = { running: 2, queued: 2, failed: 1, completed: 2, cancelled: 1 };
  function taskRunner() {
    return withCalls('plugins/dev-tools/task-runner', 'Synthetic: 8 tasks across the five run states.', [
      { cmd: 'dev_tools_tasks_page', response: { tasks: TASKS, cursor: null, hasMore: false, counts } },
      { cmd: 'dev_tools_list_tasks', response: TASKS },
    ]);
  }

  return {
    builders: {
      'projects/goals': goals,
      'plugins/dev-tools/task-runner': taskRunner,
      'plugins/dev-tools/project-manager': () => withCalls('plugins/dev-tools/project-manager', 'Synthetic: the Factory landing projects as the Manage table.', []),
      'plugins/dev-tools/context-map': () => withCalls('plugins/dev-tools/context-map', 'Synthetic: the Factory landing context map (groups, contexts, use cases, KPIs).', []),
    },
  };
}
