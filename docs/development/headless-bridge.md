# Headless bridge — driving Personas from a terminal

> Moved out of the root `README.md` (2026-10-05), where it sat between "Getting Started"
> and "Project Structure". Content is unchanged apart from heading levels.
> Related architecture: [`../architecture/in-app-http-service.md`](../architecture/in-app-http-service.md),
> [`../architecture/headless-app-master.md`](../architecture/headless-app-master.md),
> [`../architecture/app-master-e2e.md`](../architecture/app-master-e2e.md).

## Registering a project headlessly (dev-tools bridge)

Every project the Factory manages is a row in `dev_projects`. You can create that row and
run the context-map scan from a terminal or a script, without the GUI, through the loopback
**dev-tools bridge** the running app exposes. The app must be running: the bridge lives inside
its process, and it writes a handshake file `~/.personas/local-http.json` (`{pid, port, token}`)
on every bind. The port is the first free one at or above `17400`; the token is mandatory.

```bash
PORT=$(grep -o '"port"[^,]*' ~/.personas/local-http.json | grep -o '[0-9]*')
TOKEN=$(grep -o '"token": *"[^"]*"' ~/.personas/local-http.json | sed 's/.*"\([^"]*\)"$/\1/')
B="http://127.0.0.1:$PORT/dev-tools"; AUTH=(-H "X-Personas-Local-Token: $TOKEN")

curl -s "${AUTH[@]}" "$B/projects"                      # list; match on root_path, not name
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/projects"   -d '{"name":"my-app","root_path":"/abs/path/to/my-app","description":"...","tech_stack":"..."}'
#   -> the DevProject row (keep .id). Idempotent on root_path; writes .personas/project.json
#      into the repo (commit it: it lets a moved checkout heal and refuses a clone collision).
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/scan-codebase"   -d '{"project_id":"<id>","root_path":".","delta_mode":false}'      # -> {"scan_id"}
curl -s "${AUTH[@]}" "$B/scan-status/<scan_id>"         # poll; then export the artifacts:
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/export-context-map"   -d '{"project_id":"<id>"}'                             # context-map.json + CLAUDE.md block
```

`401` means a stale token (re-read the handshake), `403` a non-loopback `Host` header, `400`
on create a `root_path` that does not exist. Project create, context scan, export and the
repair routes are unattended; the use-case/KPI lanes (`/project-populate`) and passport
onboarding (`/passport-onboard`) deliberately stop to ask the operator questions. Route table:
`src-tauri/src/commands/infrastructure/dev_tools_http.rs`; identity rules:
`src-tauri/db/src/project_identity.rs`; narrative: `docs/features/plugins/dev tools/cx-map.md`.

### Creating the repository too (`POST /projects/create`)

`POST /projects` needs a folder that already exists. `POST /projects/create` makes one: it
computes `<root>/<workspace-slug>/<name>`, `git init`s it, writes a `README.md`, a `.gitignore`
and the template's skeleton, makes one `chore: scaffold <name>` commit, then registers the
project and assigns it to the workspace — resolving the workspace by id or by name, and
**creating** the workspace when the name matches none.

```bash
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/projects/create" -d '{
  "workspace": "Bank",
  "name": "bank-core",
  "description": "accounts, ledger, payments",
  "techStack": "rust",
  "template": "rust-service"
}'
#   -> { project, repositoryPath, workspaceId, created, workspaceCreated }
```

`template` is `empty` (default) | `rust-service` | `node-service` | `python-service`; the
non-empty ones write a dependency-free hello server so the skeleton builds and runs offline.
`techStack` also accepts the snake_case `tech_stack`. `root` (absolute) overrides the root for
one call; otherwise the root is the `simulation_projects_root` setting, and unset that is
`<app data dir>/sim` (`PERSONAS_DATA_DIR` overrides the app data dir, as it does for the
authoring worktrees). Set the setting once when the repositories belong somewhere specific —
the Grand Simulation's dedicated bank folder is the case this exists for.

`400` when the target directory exists and is **not empty** (the response names the path), and
when `name` is not a single directory component. A directory that already carries
`.personas/project.json` is the exception: the call is idempotent, returns the same project and
reports `"created": false`. Same operation as the Tauri command `create_project_repository`
(`src/api/devTools/projectScaffold.ts`); implementation:
`src-tauri/src/commands/infrastructure/project_scaffold.rs`.

### The never-delete tag (`GET /workspaces`, `POST /workspaces/{id}/protect`)

A workspace can be tagged as the **last working version** — the state Personas must keep. While
the tag is set, four delete doors refuse with
`workspace <name> is protected as the last working version`: deleting one of its projects,
deleting the workspace, deleting a member project's team, and the `replace` branch of a dev
project import (which wipes a project's whole working graph without touching the project row).

```bash
curl -s "${AUTH[@]}" "$B/workspaces"          # -> [{ id, name, protected, projectCount }]
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" \
  "$B/workspaces/<workspace-id>/protect" -d '{"lastWorkingVersion":true}'   # -> the workspace row
```

Guards: `src-tauri/db/src/repos/workspaces/protection.rs`; the column arrives in migration
`e24_workspace_protection`.

## Registering an App Master headlessly

An **App Master** is the accountable owner of one registered project: a persona pinned to that
project's codebase, holding one standing charter per recipe you name, enrolled in the
living-agent attention loop. `POST /dev-tools/app-master/adopt` builds it with no GUI, using the
same handshake as above.

```bash
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/app-master/adopt" -d '{
  "project": "my-app",
  "recipes": [ {"slug":"codebase-architecture-review","priority":2},
               {"slug":"accepted-idea-delivery"} ],
  "model": "opus", "maxConcurrent": 2, "scopeRung": 2, "enabled": false }'
#   -> { personaId, personaName, projectId, created, charters[], suspended[], manifestPath, notes[] }
curl -s "${AUTH[@]}" "$B/app-master/<project_id>"    # the current adoption, or `null`
```

`project` accepts an id, a name or a `root_path`. Everything but `project` is optional:
`model` defaults to `sonnet` (a tier slug or a full `claude-*` id), `maxConcurrent` to 2,
`scopeRung` to 2 (the mandate ceiling — rung 3/4 are never granted), `enabled` to **false**
(adoption prepares the App Master; enabling it is a separate act), `name` to
`App Master <project name>`.

### Write-back routes for workers

A dispatched App Master run is a headless session in an isolated worktree: it has a repository and a
model, and these four routes are its **only** way back into Personas. Without them a run's work ends
at a git commit — the idea it delivered stays `accepted` with no task, so the next wake's
"accepted ideas with no task" sensor offers it again. Every dispatch brief names them, along with the
handshake file and the header above.

```bash
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/ideas/<idea_id>/outcome" -d '{"outcome":"delivered","note":"what shipped","branch":"autopilot/x","commit":"abc1234","pr_url":"..."}'
#   outcome: delivered | declined | blocked. Finds (or mints) the idea's dev_tasks row and closes it
#   -> completed / cancelled / failed respectively; `declined` also rejects the idea through the one
#   verdict door, with `note` as the reason. -> { ideaId, ideaStatus, task, taskCreated, taskStatus }
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/ideas"   -d '{"project_id":"<id>","title":"...","description":"...","reasoning":"...","category":"technical","effort":2,"impact":4,"risk":1}'
#   -> { idea, created, dedupKey }. Deduped on a normalized title, so re-filing is safe and
#   `created:false` hands back the row that already holds the key (in ANY status, rejected included).
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/kpis"   -d '{"project_id":"<id>","name":"Rust clippy findings","measure_kind":"codebase","unit":"findings","direction":"down","target_value":0}'
#   -> the DevKpi row. `status` defaults to `proposed` (pass `active` to claim it is readable now).
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/kpis/<kpi_id>/measure"   -d '{"value":5,"evidence":"cargo clippy -> 5","source":"scan"}'
#   -> the measurement row. `env` defaults to `production` and rolls current_value forward;
#   `local`/`test` route to the simulation door and deliberately do not.
```

`400` names the offending token and the vocabulary it had to come from (task, KPI and measurement
fields are all schema CHECK-constrained); `404` means the idea, project or KPI id does not exist.
Everything lands through the same repo functions the UI uses — a worker-written row is
indistinguishable from one written by a click. Code: `app_master_writeback.rs`.

The call is idempotent: the persona is keyed by its codebase pin plus name, each charter by its
recipe slug, so re-running with the same body updates in place. A slug you drop from `recipes`
**suspends** its charter rather than deleting it — the charter carries the coverage memory the
attention loop writes between wakes. `400` means the project did not resolve or a field is out of
range (priority is 1..5); `404` names the recipe slugs nobody has seeded, and nothing is written
when it fires. Partial outcomes are reported, never rounded up — read `notes` and `manifestPath`
before treating an adoption as complete. The same operation is the `adopt_app_master` Tauri
command; the code is `src-tauri/src/commands/infrastructure/app_master_adopt.rs`.

## Headless App Master doors

A headless App Master (`/appmaster`, see
[`../architecture/headless-app-master.md`](../architecture/headless-app-master.md)) never writes
`personas.db`: it queues every app-owned write in its outbox and replays it through these routes when
the app is up. Same handshake as above. Bodies are camelCase and an absent optional key means "not set"
(never send `null` placeholders). Statuses: `400` a malformed payload or a value outside its
vocabulary, `404` an id or name that resolves to nothing, `409` things that exist but do not belong
together, `422` a council run the door read and refused. Code: `headless_doors.rs`,
`headless_report.rs`.

```bash
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/milestones" -d '{"projectId":"<id>","name":"Ten masters","goal":"...","targetDate":"2026-10-31"}'
#   -> { milestoneId }. Born planned (cutting it is the operator's act). 404 project, 400 empty name.
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/goals" -d '{"projectId":"<id>","title":"...","description":"...","milestoneId":"<mid>"}'
#   -> { goalId }. Optional targetDate, parentGoalId, milestoneId. With milestoneId the goal is bound
#   into that milestone (item_kind goal, bucket core); a milestone or parent goal of ANOTHER project is
#   a 409 and nothing is written.
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/projects/<id>/workspace" -d '{"workspaceName":"Core"}'
#   -> { workspaceId } (null when cleared). workspaceId OR workspaceName, or neither to clear. A name
#   must match an existing workspace exactly: 404 when none does (this door never creates one), 409
#   when two share it. Both keys, or a blank one, is a 400.
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/reports" -d '{
  "projectId":"<id>", "title":"Checkout ships", "content":"## What changed\n...",
  "attachments":[{"path":"C:/repo/shots/after.png","caption":"after the fix"}],
  "approval":{"title":"Ship checkout?","description":"...","severity":"high"} }'
#   -> { reportId, reviewId? }. See below.
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/council/ingest" -d '{"projectId":"<id>","runDir":"C:/.../headless/council/2026-10-07-checkout-r1"}'
#   -> the dev_tools_council_ingest summary { projectId, runsIngested, runsSkipped, subjectsCreated, refused }.
curl -s -X POST -H "Content-Type: application/json" "${AUTH[@]}" "$B/use-cases/<use_case_id>/tier" -d '{"tier":"major"}'
#   -> { useCaseId, tier }. major | standard; 400 otherwise, 404 an unknown feature.
```

**Reports.** `personaId` defaults to the project's App Master persona (409 when the project has none
and none is named). The report is stored as markdown with
`metadata = {"projectId","source":"headless-app-master","attachments":[{"path","caption"}],"attachmentsCleaned":false}`.
Each attachment must be an existing file under the `~/.personas` tree or a registered project root, at
most 12 files and 8 MB each, png/jpg/jpeg/gif/webp/mp4/webm/pdf/md only; it is COPIED to
`<app data dir>/reports/<reportId>/NN-<name>` (the directory the database lives in, which the Reports
UI can load through the asset protocol) and the copy's path is what the metadata records. An
`approval` raises a pending manual review for the same persona (severity `info` by default, one of
`info|low|medium|high|warning|critical`) with `context_data = {"reportId"}` and no execution behind it
(migration `e60_review_execution_optional`). When that review is decided - by any path, or by the
stale-review sweep - the copies directory is deleted and the metadata gains `attachmentsCleaned: true`
and `cleanedAt`. Everything is validated before the first write and a later failure undoes the report,
so a replayed entry finds the whole report or nothing; a replay of one that already landed returns the
same `reportId` and `reviewId`.

**Council ingest.** `runDir` must sit under the project's own `.personas/council/runs/`, or under the
headless App Master's durable copy for THIS project:
`<personas checkout>/.claude/master/<slug>/headless/council/<runDirName>/`, where `<slug>` is the
project root's last path segment. Nothing broader is accepted. Every other check of the door applies to
both (1 MiB cap, the slug must be a feature of the project, the arithmetic is recomputed). A run read
and refused is a `422` whose body is the summary with the reason in `refused`; a run already ingested
is a `200` with `runsSkipped: 1`. Results carry `mode` (`full` | `lite`; absent = full) since registry
council 0.4.0, rounds are counted per mode (migration `e61_council_run_mode`), a lite run never
supersedes a full one in the subject's state, and the human gate decides only a full `ready` run.
