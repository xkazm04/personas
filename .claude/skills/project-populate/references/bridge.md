# The `/dev-tools` bridge

Personas exposes its scan lanes over an HTTP server bound to `127.0.0.1`. This
is how a terminal session drives the app's own machinery instead of
reimplementing it.

Everything below writes through the same repository functions the UI calls, so
work done here is indistinguishable from work done by clicking.

## Finding the port

The server takes **the first free port at or above 17400**, scanning up to 16
ports. It is therefore not a constant: a restart while another process holds
17400 moves it. A dispatch brief names the port that was live when the
dispatch was composed — start there, and if it does not answer, probe upward:

```bash
for p in $(seq 17400 17415); do
  curl -s -m 1 "http://127.0.0.1:$p/dev-tools/projects" >/dev/null && echo "$p" && break
done
```

No port answers → **Personas is not running.** Stop and say so. There is no
offline path.

## Finding the project

```bash
curl -s "http://127.0.0.1:$PORT/dev-tools/projects"
```

Returns every registered project. Match on `root_path` against the repo you
are in — do not match on name, which is not unique. The `id` field is the
`project_id` every other route wants.

If no project matches this repo, it has not been registered in Personas. That
is the operator's decision to make (`POST /projects` exists, but registering a
repo behind their back is not this skill's job).

## Routes

### Context map

```bash
# start — delta_mode false = full re-exploration, true = incremental
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/scan-codebase" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"<id>","root_path":"<abs path>","delta_mode":false}'
# → {"scan_id":"..."}

curl -s "http://127.0.0.1:$PORT/dev-tools/scan-status/<scan_id>"
# → {"scan_id":..., "status":"running|completed|failed|not_found", "error":..., "lines":[...]}
```

`lines` carries the lane's milestone output. Relay it while polling — these
scans run for minutes and silence reads as a hang.

### Features (use cases)

```bash
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/scan-use-cases" \
  -H 'Content-Type: application/json' -d '{"project_id":"<id>"}'
# → {"scan_id":"..."}   or 500 with the reason

curl -s "http://127.0.0.1:$PORT/dev-tools/use-case-scan-status/<scan_id>"
```

Two 500s are expected rather than exceptional:

- *"Scan the codebase into a context map first"* — there is no map to slice.
- *"N proposals already await review (cap …)"* — an unreviewed queue exists.
  Send the operator to Projects → Factory → Overview; that surface is built
  for reviewing use cases and this session is not.

### KPIs

```bash
# project-wide pass — up to 8 KPIs across the whole product
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/scan-kpis" \
  -H 'Content-Type: application/json' -d '{"project_id":"<id>"}'

# context-scoped pass — up to 4 KPIs, all bound to that one context
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/scan-kpis" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"<id>","context_id":"<ctx>"}'

curl -s "http://127.0.0.1:$PORT/dev-tools/kpi-scan-status/<scan_id>"

# the sweep's worklist — every context, with file_paths for ranking
curl -s "http://127.0.0.1:$PORT/dev-tools/contexts/<project_id>"

# read (omit ?status= for all statuses)
curl -s "http://127.0.0.1:$PORT/dev-tools/kpis/<project_id>?status=proposed"

# decide — one call per KPI, as each answer arrives
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/kpi-decision" \
  -H 'Content-Type: application/json' \
  -d '{"kpi_id":"<id>","status":"active","target_value":95}'
```

`status` is one of `active` (adopted), `archived` (rejected), `paused`
(deferred), `proposed` (back to the queue). `target_value` is optional and
applied in the same write, so "adopt, but at 95 not 99" is one call.

**Backpressure is per-scope.** A project pass is refused while the whole review
queue is at its cap; a context pass is refused only while THAT context has 4
untriaged proposals. So one unreviewed subsystem never blocks a sweep across
the rest — but a context you scanned and walked away from will refuse a rescan
until its queue is cleared.

Anything else is a 400. The route deliberately accepts nothing but a status
and a target: renaming or redefining a KPI belongs in the app's editor, where
the operator can see what else references it.

### Simulation

```bash
# write kpi-sim/snapshot.json (the sim refuses to run without it)
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/kpi-sim/prepare" \
  -H 'Content-Type: application/json' -d '{"project_id":"<id>"}'
# → {"snapshot_path":"...","root_path":"...","kpi_count":N}

# after /kpi-sim run has written kpi-sim/runs/<id>/result.json
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/kpi-sim/ingest" \
  -H 'Content-Type: application/json' -d '{"project_id":"<id>"}'
# → {"run_dir":"...","measurements_recorded":N,"proposals_created":N,
#    "findings_created":N,"skipped":[...]}
```

Omit `run_dir` to ingest the newest un-ingested run. `skipped` is never empty
by accident — it lists every row the validator refused, so report it rather
than treating a partial ingest as clean.

## Reading freshness

Every gate is computable over the bridge:

```bash
curl -s "http://127.0.0.1:$PORT/dev-tools/context-groups/<project_id>"   # Phase 1
curl -s "http://127.0.0.1:$PORT/dev-tools/use-cases/<project_id>"        # Phase 2
curl -s "http://127.0.0.1:$PORT/dev-tools/kpis/<project_id>"             # Phase 3
```

Compare `updated_at` against a 14-day window. **Do not substitute
`context-map.json`'s file mtime** — it is a build artifact in a git repo, so a
checkout, merge or rebase rewrites it and it will report a scan that never
happened.

Every one of these 404s when the project id matches nothing. That is
deliberate: an empty array means the project genuinely has no rows, so if you
get `[]` you can trust it rather than wondering whether you resolved the wrong
id.

In dispatched mode the gates arrive pre-computed in the brief, from the same
tables.
