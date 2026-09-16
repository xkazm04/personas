// simFleet — the simulated roster: 20 projects, 3 agents in each.
//
// These are DATABASE-SHAPED rows, not view models. The simulation substitutes
// at the board's props boundary (`cards` / `personas` / `teams`) and at the
// system store's `projects`, so everything downstream — `groupFleet`, the
// column ordering, `railFilter`'s project scope, the tray's fallback for
// unplaceable sessions — runs its real code against them. A simulation that
// short-circuited into the grouped result would paint a board while proving
// nothing about the board.
//
// One `persona_teams` row + one `dev_projects` row per project name, joined by
// `team_id`, because that join is exactly what a column header's scope control
// walks (`FleetGridView.scopeFor`).

import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { DevProject } from '@/lib/bindings/DevProject';
import {
  mulberry32, PROJECT_NAMES, ROLE_NAMES, SEED, SIM_AGENTS_PER_PROJECT, TEAM_COLORS,
} from './simRandom';

/** Every simulated id carries this prefix — greppable, and never a real uuid. */
export const SIM_PREFIX = 'sim';

export const simTeamId = (i: number): string => `${SIM_PREFIX}-team-${i}`;
export const simProjectId = (i: number): string => `${SIM_PREFIX}-project-${i}`;
export const simPersonaId = (team: number, slot: number): string =>
  `${SIM_PREFIX}-persona-${team}-${slot}`;

/** A fixed instant so `created_at` never drifts between two runs. */
const EPOCH = '2026-01-06T09:00:00.000Z';

function teamRow(i: number, name: string): PersonaTeam {
  return {
    id: simTeamId(i),
    project_id: null,
    parent_team_id: null,
    name,
    description: null,
    canvas_data: null,
    team_config: null,
    icon: null,
    color: TEAM_COLORS[i % TEAM_COLORS.length]!,
    enabled: true,
    shared_instructions: null,
    default_model_profile: null,
    default_max_budget_usd: null,
    default_max_turns: null,
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

function projectRow(i: number, name: string): DevProject {
  return {
    id: simProjectId(i),
    name,
    root_path: `/simulated/${name.toLowerCase().replace(/\s+/g, '-')}`,
    description: null,
    status: 'active',
    tech_stack: null,
    github_url: null,
    monitoring_credential_id: null,
    monitoring_project_slug: null,
    static_scan_config: null,
    auto_pr_on_success: false,
    pr_credential_id: null,
    llm_tracking_credential_id: null,
    support_credential_id: null,
    data_links: null,
    test_env_url: null,
    test_env_branch: null,
    main_branch: 'main',
    standards_config: null,
    team_id: simTeamId(i),
    workspace_id: null,
    enabled: true,
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

function personaRow(team: number, slot: number): Persona {
  return {
    id: simPersonaId(team, slot),
    project_id: simProjectId(team),
    // No project prefix — see `ROLE_NAMES`. The column header names the
    // project; the tile names the agent.
    name: ROLE_NAMES[(team * SIM_AGENTS_PER_PROJECT + slot) % ROLE_NAMES.length]!,
    description: null,
    system_prompt: '',
    structured_prompt: null,
    icon: null,
    color: TEAM_COLORS[team % TEAM_COLORS.length]!,
    enabled: true,
    sensitive: false,
    headless: false,
    starred: false,
    max_concurrent: 1,
    timeout_ms: 600_000,
    notification_channels: null,
    last_design_result: null,
    last_test_report: null,
    model_profile: null,
    max_budget_usd: null,
    max_turns: null,
    design_context: null,
    home_team_id: simTeamId(team),
    source_review_id: null,
    trust_level: 'manual',
    trust_origin: 'user',
    trust_verified_at: null,
    trust_score: 0,
    parameters: null,
    gateway_exposure: 'local_only',
    template_category: null,
    cli_awareness_enabled: false,
    setup_status: 'ready',
    setup_detail: null,
    disabled_dims_json: null,
    lifecycle: 'active',
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

export interface SimRoster {
  teams: PersonaTeam[];
  personas: Persona[];
  projects: DevProject[];
}

/**
 * The roster. The RNG is drawn from even though nothing here is currently
 * random — it advances the stream in a fixed order so a later generator's
 * draws stay stable when this one grows a random field.
 */
export function buildSimRoster(): SimRoster {
  const rand = mulberry32(SEED.fleet);
  const teams: PersonaTeam[] = [];
  const personas: Persona[] = [];
  const projects: DevProject[] = [];

  PROJECT_NAMES.forEach((name, i) => {
    teams.push(teamRow(i, name));
    projects.push(projectRow(i, name));
    for (let slot = 0; slot < SIM_AGENTS_PER_PROJECT; slot += 1) {
      rand();
      personas.push(personaRow(i, slot));
    }
  });

  return { teams, personas, projects };
}
