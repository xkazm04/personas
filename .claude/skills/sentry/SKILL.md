---
name: sentry
description: Fetch active Sentry issues for the Personas project, diagnose root causes from stack traces, apply code fixes, and mark issues as resolved. Covers both Rust backend (tracing::error!, panics) and React frontend (exceptions, unhandled rejections).
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Sentry Issue Triage & Fix Pipeline

You process **unresolved Sentry issues** for the `personas` project in org `d3v-center`. For each issue: fetch the stack trace, locate the offending source, propose a fix, apply it after user approval, verify it compiles, commit, and mark the issue resolved in Sentry via the API.

## Constants

- **Sentry org**: `d3v-center`
- **Sentry project**: `personas`
- **Auth**: `SENTRY_AUTH` from `.env` at repo root (user auth token, `sntryu_*` prefix)
- **API base**: `https://sentry.io/api/0`
- **Triage output**: `.claude/sentry/TRIAGE-<YYYYMMDD>.md`

## Trigger

- `/sentry` — list all unresolved issues, pick one or a batch to fix
- `/sentry list` — list only, no fixes
- `/sentry fix <issue-id>` — go straight to fixing a specific issue
- `/sentry top <N>` — triage the N issues with the highest event count (default 5)
- `/sentry stats` — summary: unresolved count, frequency buckets, affected releases

---

## Phase 0: Load auth and smoke-test the API

```bash
TOKEN=$(grep -E "^SENTRY_AUTH=" .env | cut -d= -f2-)
if [ -z "$TOKEN" ]; then
  echo "ERROR: SENTRY_AUTH not set in .env"
  exit 1
fi

# Smoke test — confirm token is valid and project is reachable
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://sentry.io/api/0/projects/d3v-center/personas/" \
  | python -c "import sys,json; d=json.load(sys.stdin); print(f\"Project OK: {d.get('slug')} — {d.get('eventProcessing',{}).get('symbolicationDegraded','symbolic ok')}\")"
```

Abort if the smoke test fails (bad token, project renamed, org changed).

Ensure `.claude/sentry/` exists: `mkdir -p .claude/sentry`.

---

## Phase 1: Fetch unresolved issues

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://sentry.io/api/0/projects/d3v-center/personas/issues/?query=is:unresolved&statsPeriod=14d&limit=100&sort=freq" \
  > .claude/sentry/issues.json
```

Parse with python/jq. Fields to keep per issue:

| Field | Source path | Use |
|---|---|---|
| `id` | `.id` | API key for resolve PUT |
| `shortId` | `.shortId` | e.g. `PERSONAS-1A` — human ref |
| `title` | `.title` | Commit message context |
| `culprit` | `.culprit` | Fast jump to file:func |
| `level` | `.level` | `error` / `fatal` / `warning` |
| `count` | `.count` | Event frequency |
| `userCount` | `.userCount` | Distinct affected users |
| `firstSeen` / `lastSeen` | `.firstSeen` / `.lastSeen` | Is it active or dormant? |
| `platform` | `.platform` | `rust` → backend, `javascript` → frontend |
| `metadata.type` | `.metadata.type` | Exception class |
| `metadata.value` | `.metadata.value` | Exception message |
| `permalink` | `.permalink` | Link to Sentry UI |

Filter out noise before presenting:
- Skip `level: warning` unless user passed `--include-warn`
- Skip issues not seen in the last 7 days (stale — probably already fixed)
- Skip issues with count == 1 AND lastSeen > 3 days ago (likely flukes)

---

## Phase 2: Present triage table — one approval gate

Write `.claude/sentry/TRIAGE-<date>.md`:

```markdown
# Sentry Triage — 2026-04-17

Total unresolved: 42
Filtered (active, >7d): 18

| # | shortId | lvl | count | users | lastSeen | platform | title |
|---|---------|-----|-------|-------|----------|----------|-------|
| 1 | PER-1A  | err | 847   | 23    | 2h ago   | rust     | ONNX Runtime panicked: LoadLibraryExW failed |
| 2 | PER-2B  | err | 412   | 17    | 4h ago   | js       | TypeError: Cannot read properties of undefined (reading 'status') |
| ...
```

Show the user this table and ask:

> Which do you want to fix? Reply with indexes (`1,2,5`), `all`, `top 3`, or `skip`.

**Do not proceed without explicit user selection.** This is the single approval gate.

---

## Phase 3: Fix each selected issue

For each issue (iterate sequentially — fixes may depend on each other):

### 3.1 Pull the latest event with full stack

```bash
ISSUE_ID="<numeric id>"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://sentry.io/api/0/issues/$ISSUE_ID/events/latest/" \
  > .claude/sentry/event-$ISSUE_ID.json
```

Extract:
- **Exception class + message**: `entries[].data.values[0].type` + `.value`
- **Frames**: `entries[].data.values[0].stacktrace.frames[]` — each has `filename`, `function`, `lineNo`, `colNo`, `inApp`, `context`
- **Breadcrumbs**: `entries[] | select(.type=="breadcrumbs") | .data.values[]` — UI/state just before the crash
- **Tags**: `tags[]` — release, OS, environment
- **Request** (frontend only): `entries[] | select(.type=="request") | .data.url`

Focus on `inApp: true` frames — those are our code. Skip library internals.

### 3.2 Locate the source

Map Sentry paths to local paths. Common patterns:

| Sentry frame | Local source |
|---|---|
| `src/features/.../Foo.tsx` | Same path in repo |
| `app_lib::commands::foo::bar` | `src-tauri/src/commands/foo.rs` (search for `fn bar`) |
| `./src/...` (Vite) | Strip leading `./` |
| Minified JS (no sourcemap) | Fallback: grep for unique string fragments from the message |

Read the file at the reported line. If source maps are missing for a frontend issue, grep for a distinctive string in the exception message.

### 3.3 Diagnose

Write a short diagnosis (4-6 bullet points) covering:
- What the user was doing (from breadcrumbs + `request.url` for frontend)
- Why the crash happens (null deref, race, missing guard, type mismatch, etc.)
- Whether it's a **real bug** or **expected failure that needs better handling** (e.g., network down)
- Scope: is this a one-line guard or a structural fix?

If the issue is **not actionable** (hardware failure on one user's machine, third-party API flake, dev-only code path), mark for resolution with justification and skip code changes — jump to Phase 3.6 with a `resolution: "wontfix"` body.

### 3.4 Apply the fix

Use Edit directly on the source. Style guidance (inherits from CLAUDE.md):
- No extraneous comments; only add one if the WHY is non-obvious
- For user-facing frontend text, respect i18n (go through `t.*`, never hardcode English)
- For backend errors, prefer `tracing::error!` with structured fields over bare `anyhow::bail!`
- No backwards-compat shims — fix it cleanly

Verify locally:

```bash
# If frontend-only:
npx tsc --noEmit                              # must be 0 errors
# If backend:
cd src-tauri && cargo check 2>&1 | tail -30
```

Do not resolve the Sentry issue until the check passes.

### 3.5 Commit

One commit per issue, referencing the shortId:

```bash
git add <fixed files>
git commit -m "$(cat <<'EOF'
fix(<area>): <one-line summary>

Sentry: <shortId> — <permalink>
Root cause: <1-2 sentences>
Fix: <1 sentence describing the change>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Follow the repo's commit style (lowercase conventional commits, see `git log --oneline -10`).

### 3.6 Mark resolved in Sentry

```bash
curl -sS -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://sentry.io/api/0/issues/$ISSUE_ID/" \
  -d '{"status":"resolved","statusDetails":{"inNextRelease":true}}'
```

`inNextRelease: true` means Sentry auto-reopens the issue if it recurs after the next release is deployed — that's what we want for a code fix that ships in a future CI build. For `wontfix`, use `{"status":"ignored"}` instead.

Record in the triage file:

```markdown
## PER-1A — Fixed ✅
- Commit: abc1234
- Files: src/features/.../Foo.tsx
- Strategy: Added null guard around `session.metadata`
```

---

## Phase 4: Summary report

After all selected issues are processed, append to the triage file:

```markdown
## Summary — 2026-04-17 15:42

- Issues triaged: 18
- Fixed and resolved: 12
- Ignored (wontfix): 2
- Skipped (needs design decision): 4
- Commits created: 12
- Files changed: 19
```

Print this summary to the console. Done.

---

## Safety rails

1. **Never resolve an issue you didn't fix.** If the user says "skip this one", leave the Sentry status untouched.
2. **Never commit without the sanity check passing** (`tsc --noEmit` for frontend, `cargo check` for backend).
3. **Never bulk-resolve without individual inspection** — Sentry's API can resolve in bulk, but that defeats the purpose.
4. **Never fetch more than 100 issues per call** — paginate via the `Link` response header if needed.
5. **Don't log the PAT.** Read it once into `$TOKEN`, never `echo` it. If the user shares the transcript, they shouldn't see it.
6. **Respect CLAUDE.md "Do Not Fix Unless Asked" list** — if a Sentry issue points at a file on that list, mark it for user triage rather than auto-fixing.

## References

- Sentry API docs: https://docs.sentry.io/api/
- Issue status values: `resolved`, `unresolved`, `ignored`
- Project error reporting config: `docs/devops/guide-error-reporting.md`
- PII scrubbing: `src-tauri/src/main.rs` (Rust `before_send`), `src/lib/sentry.ts` (JS `beforeSend`)
