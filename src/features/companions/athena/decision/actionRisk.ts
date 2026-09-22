/**
 * actionRisk — how much blast radius an approval action carries, for the one
 * decision the orb makes with it: whether to recommend approving it or to tell
 * the operator to look closer.
 *
 * WHY THIS FILE EXISTS. The recommendation used to key off an eight-name `Set`
 * inlined in `useDecisionQueue`. The backend's action vocabulary
 * (`ALLOWED_ACTIONS` in `src-tauri/src/companion/dispatcher/catalog.rs`) has 56
 * entries and grows; a hand list is a second, unchecked copy of it, so every
 * action added after the list was written shipped as "look closer" whether or
 * not that was true - and `write_procedural`, the exact sibling of the
 * `write_fact` the list DID carry, is one of them.
 *
 * The map is still authored here, because the backend catalog carries no risk
 * field to derive from (it is a `&[&str]`). What changed is that the copy is
 * now GATED: `actionRisk.test.ts` reads `catalog.rs` itself and fails when an
 * action in the real vocabulary has no classification here, or when a
 * classification here names an action the backend no longer has. Drift becomes
 * a red test instead of a quietly-cautious orb. The durable fix - a `risk`
 * field on the Rust catalog, exported through a binding - is the Rust half of
 * this card and would replace the table below with a read.
 *
 * WHAT THE RECOMMENDATION IS NOT. It never gates execution. Approve / reject
 * are the same two options either way, and every real boundary (the dispatcher
 * allow-list, the autopilot's fleet gates, per-executor checks) is untouched by
 * this file. It is advice, shown only when the operator explicitly asks for it.
 */

export type ActionRisk = 'low' | 'elevated';

/**
 * Actions whose worst outcome is a row in the local database the operator can
 * edit or delete afterwards: memory writes, status flips on those same rows,
 * a registry entry, a prefilled form.
 *
 * `run_persona` is the deliberate outlier, carried over from the previous hand
 * list: it spends money on a run. It stays classified low because that is the
 * behaviour operators have today and this change is about drift, not about
 * re-litigating a judgement.
 *
 * Everything absent from this table is `elevated` - deletes, anything that
 * spawns a process or a CLI turn, anything that reaches the fleet, the browser,
 * another device or an external service, anything that changes what the
 * autonomous loop optimizes for, and anything the backend adds tomorrow.
 * Unknown means elevated, on purpose: a new verb nobody has classified is
 * exactly the one to look at.
 */
const LOW_RISK: readonly string[] = [
  'run_persona',
  'write_fact',
  'write_procedural',
  'write_goal',
  'write_ritual',
  'write_backlog_item',
  'update_goal_status',
  'set_ritual_active',
  'resolve_backlog_item',
  'register_project',
  'prefill_persona_create',
  'update_dev_goal',
];

/**
 * Everything else the backend can propose, named rather than inferred.
 *
 * An explicit list is the whole point: with only a low table, "is this action
 * classified?" is unanswerable - every string is elevated by fallthrough, so a
 * verb added to the backend tomorrow looks exactly like one that was weighed
 * and judged risky. Naming both arms makes the drift test able to fail.
 *
 * The grouping, and why each group is here: deletes and identity rewrites are
 * destructive; build / arena / breed / evolve / dev_* / analyze / browser_test
 * spawn processes or CLI turns that cost money; fleet_* type into live
 * terminals; browser_* act on real web apps; remote_instruct reaches another
 * device; reconnect_credential opens the operator's browser; the KPI verbs
 * change what the autonomous loop optimizes for; enqueue_* / ship / assign /
 * schedule / canvas_* / skill_sync / backlog_apply_triage all set work in
 * motion beyond a single row.
 */
const ELEVATED_RISK: readonly string[] = [
  'resolve_human_review',
  'update_identity',
  'delete_fact',
  'delete_procedural',
  'delete_goal',
  'delete_ritual',
  'build_oneshot',
  'run_arena',
  'companion_breed_personas',
  'companion_evolve_persona',
  'remote_instruct',
  'set_ship_scope',
  'ship_milestone_lifecycle',
  'enqueue_dev_job',
  'enqueue_runner_task',
  'open_test_env',
  'reconnect_credential',
  'calibrate_kpi',
  'evaluate_kpi',
  'scan_kpis',
  'propose_kpi',
  'schedule_proactive',
  'assign_team',
  'fleet_send_input',
  'fleet_broadcast',
  'fleet_kill',
  'fleet_spawn',
  'fleet_dispatch',
  'fleet_intervene',
  'fleet_redirect_op',
  'fleet_wake',
  'fleet_resume',
  'analyze_fleet',
  'run_browser_test',
  'dev_improve',
  'dev_merge',
  'backlog_apply_triage',
  'canvas_dispatch',
  'canvas_group_dispatch',
  'canvas_run_idea_scan',
  'skill_sync',
  'browser_act',
  'browser_login',
  'browser_request_site',
];

/**
 * Ops that never appear in `ALLOWED_ACTIONS` because they auto-fire rather than
 * creating an approval row (see the `compose_dashboard` note in `catalog.rs`),
 * yet reached the old hand list. Kept classified so a future path that DOES
 * file them as approvals is not silently cautious, and listed separately so the
 * drift test does not read them as stale entries.
 */
export const NON_APPROVAL_LOW_RISK: readonly string[] = ['compose_dashboard', 'compose_cockpit'];

const LOW_RISK_SET: ReadonlySet<string> = new Set([...LOW_RISK, ...NON_APPROVAL_LOW_RISK]);
const ELEVATED_RISK_SET: ReadonlySet<string> = new Set(ELEVATED_RISK);

/** Every action this module classifies as low risk. Test surface. */
export function lowRiskActions(): readonly string[] {
  return [...LOW_RISK, ...NON_APPROVAL_LOW_RISK];
}

/** Every action this module has an opinion about, either way. Test surface. */
export function classifiedActions(): readonly string[] {
  return [...LOW_RISK, ...NON_APPROVAL_LOW_RISK, ...ELEVATED_RISK];
}

/** True when `action` has been weighed at all, rather than merely falling
 *  through to the cautious default. What the drift test asserts. */
export function isClassified(action: string): boolean {
  return LOW_RISK_SET.has(action) || ELEVATED_RISK_SET.has(action);
}

/** An action's risk band. Unknown actions are `elevated`. */
export function actionRisk(action: string): ActionRisk {
  return LOW_RISK_SET.has(action) ? 'low' : 'elevated';
}
