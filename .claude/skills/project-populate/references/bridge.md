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
# scan
curl -s -X POST "http://127.0.0.1:$PORT/dev-tools/scan-kpis" \
  -H 'Content-Type: application/json' -d '{"project_id":"<id>"}'
curl -s "http://127.0.0.1:$PORT/dev-tools/kpi-scan-status/<scan_id>"

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

Anything else is a 400. The route deliberately accepts nothing but a status
and a target: renaming or redefining a KPI belongs in the app's editor, where
the operator can see what else references it.

## Reading freshness without the app

For the 14-day gates in standalone mode, `GET /dev-tools/projects` does not
carry scan timestamps. Use the scan lanes' own surfaces instead: run the
context scan gate off whether a map exists at all (a fresh registration has
none), and when in doubt ask the operator rather than guessing — an
unnecessary full scan is expensive, and they know when they last scanned.

In dispatched mode this problem does not arise: the app computes every verdict
before composing the brief, from the same tables.
