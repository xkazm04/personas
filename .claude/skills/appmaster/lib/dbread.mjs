// WP1 owns this file. WP0 stub: signatures are the contract, bodies throw.
// Read-only app DB access (mode=ro ONLY; a test greps this package for any other open). The read helpers are an intentional copy of .claude/skills/master/master.mjs (db/q/one/projects/resolveProject/masterOf/charters/openAsks/goals/ideasSummary/kpisSummary/gitBranches): that file runs a port probe and parses argv at import, so it cannot be imported.

/** () => DatabaseSync   // readOnly, busy_timeout */
export function openDb() { throw new Error('not implemented (WP1): openDb'); }

/** (db) => Array<{id,name,root_path,main_branch,workspace_id}> */
export function listProjects() { throw new Error('not implemented (WP1): listProjects'); }

/** (ref: string) => ProjectCtx   // id | name | root | slug; throws on no match */
export function resolveProject() { throw new Error('not implemented (WP1): resolveProject'); }

/** (db, projectId) => {id,name,enabled}|null */
export function masterPersona() { throw new Error('not implemented (WP1): masterPersona'); }

/** (db, projectId, brief) => Array<{slug,title,priority,need,coreAction,pacingNote,source:"db"|"template"|"slug-only"}> */
export function chartersFor() { throw new Error('not implemented (WP1): chartersFor'); }

/** (db, project: ProjectCtx) => {goals,acceptedNoTask,pendingCount,unratedCount,kpis,gitBranches} */
export function projectSnapshot() { throw new Error('not implemented (WP1): projectSnapshot'); }
