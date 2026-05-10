# `tools/test-mcp/lib/` — shared helpers for live-app e2e scripts

## Why this exists

Before this lib, every `e2e_*.py` script in `tools/test-mcp/` redefined its
own:

- `post()` / `api_post()` / `p()` HTTP wrapper
- `bridge()` dispatcher over `/bridge-exec`
- `db_query()` / `db_scalar()` SQLite helpers
- 90-attempt × 5s polling loops
- `record()` step-log function with ASCII-only markers

That's ~40 LOC × 34 scripts = ~1,360 LOC of duplicated boilerplate. Retry
policies had drifted (3-attempt vs no-retry vs 2s-sleep-retry), every new
script reinvented the wheel, and flake patterns varied script-to-script.

This lib consolidates that boilerplate into 5 files. New e2e scripts should
import from here; existing scripts migrate opportunistically when next
touched (do not bulk-migrate).

## API surface

```python
from lib import Client, Bridge, DB, wait_until, WaitTimeout, EventLog
```

| Name | Purpose |
| --- | --- |
| `Client(host, port, default_timeout)` | httpx wrapper around the test-automation server. `.post()`, `.get()`, `.health()`. Reads `PERSONAS_TEST_PORT` env var. |
| `Bridge(client)` | Dispatcher over `/bridge-exec`. `.exec(method, params, timeout_secs)`. |
| `DB(path=None)` | Read-mostly SQLite wrapper. Resolves `personas.db` path via `APPDATA` (Windows), `~/Library/Application Support` (macOS), or `~/.local/share` (Linux). `.query()`, `.scalar()`, `.find_persona_by_name()`, `.latest_execution()`. |
| `wait_until(predicate, timeout, interval, message)` | Deadline-based polling. Returns truthy value or raises `WaitTimeout` with `last_value`. |
| `EventLog()` | Step-log replacement for the inline `record()` pattern. ASCII markers, optional stdout mirror, JSON summary dump. |

## Snapshot helper (added with F6)

When the `/test/snapshot` route lands, `lib/snapshot.py` will expose
`snapshot(client, include=...)` returning the rich-state JSON. Until then,
use `bridge.exec("getSnapshot", {})` (the existing coarse macro).

## Migration policy

- **New scripts:** import from `lib`. Don't copy-paste the legacy helpers.
- **Existing scripts:** migrate when touched for other reasons. Don't
  bulk-migrate — retry-policy differences across scripts are sometimes
  intentional (e.g. `e2e_30_adoption.py` retries 3× on timeout deliberately).
- **Diagnostic scripts (`_*.py`):** stay un-migrated. They're ad-hoc by
  design.

## Canonical reference

`tools/test-mcp/e2e_build_from_scratch.py` is the canonical migration
example. Read it alongside this lib to see how the four helpers slot
together.

## Smoke test

```bash
cd tools/test-mcp
python -c "from lib import Client, Bridge, DB, wait_until, WaitTimeout, EventLog; print('lib OK')"
```
