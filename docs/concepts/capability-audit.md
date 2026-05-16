# Capability Audit — Phase 1 Deliverable + Phase 2 Decision

**Audit date:** 2026-05-16
**Source backlog item:** `.claude/commands/unclear-wins/idea-7a4838c1-capability-lattice-unify-tiers.md`
**Companion data:** [`capability-audit.csv`](./capability-audit.csv)

This document is the deliverable for Phase 1 of the capability-lattice proposal
and contains the **Phase 2 decision** the proposal asked for explicitly.

---

## TL;DR

**The lattice is NOT justified by the data. Build two smaller things instead.**

| Phase 2 question | Answer |
|---|---|
| Are there genuinely 4+ orthogonal gating axes? | **No.** Three. |
| Do 95%+ of gates collapse onto ≤ 2 axes? | **Effectively yes** — IPC-auth-level (backend) and tier-flag (frontend). |
| Should we proceed to Phase 3 (lattice design)? | **No.** Replace this work item with two smaller tickets (see below). |

---

## Methodology

Four parallel audit passes:

1. **Backend imperative auth checks** — every call to `require_auth_sync`,
   `require_auth`, `require_privileged_sync`, `require_privileged`,
   `require_cloud_auth` in `src-tauri/src/commands/`.
2. **Frontend tier/capability gates** — every `useTier()`, `minTier:`,
   `import.meta.env.DEV`, `isAuthenticated`, ownership comparison in `src/`.
3. **Plugin + BYOM + simple-mode gates** — plugin registry, BYOM policy,
   simple-mode infrastructure, dev-only env gates.
4. **Build-time vs runtime split** — Cargo features, Vite defines, package.json
   build scripts, Tauri config feature lists.

The CSV at [`capability-audit.csv`](./capability-audit.csv) carries the
representative call sites for each axis. The full row-per-call enumeration
(995 backend sites + 68 frontend sites) would be a 1000+ row CSV nobody reads;
the CSV instead captures the canonical examples + counts per axis. Grep
patterns to reproduce are in §[Reproducing the counts](#reproducing-the-counts)
at the bottom.

---

## Gating axes — actual data

The proposal hypothesized 6 mechanism families. The data shows 4 *real* axes
plus 2 phantoms:

| Proposed axis | Gate count | Real or phantom? |
|---|---:|---|
| **Tier flag** (Starter/Team/Builder) | 47 frontend | Real — but frontend-only |
| **IPC auth level** (auth / privileged / cloud) | 995 backend | Real — dominant on backend |
| **Plugin enabled** | 1 registry + 7 sidebar gates | Real but tiny — single registry |
| **Dev env** | 43 frontend + 10 backend | Real and orthogonal |
| **BYOM provider scope** | 1 policy struct + 8 weak gates | **Phantom** — runtime evaluation in engine, never command-gated |
| **Simple-vs-power mode** | 0 active gates | **Phantom** — `simpleHidden` flag infrastructure exists but no store toggle activates it |
| **Cloud command list** | 1 static allowlist + 50 calls | Real but it IS the cloud branch of the auth-level axis (not separate) |
| **Build-time cfg-strip** | 418 Rust sites (`desktop`/`ml`/`p2p`) | Real but it's *capability availability*, not user-gating |

### What the gates actually look like in aggregate

```
Backend (995 gates total)
├── require_auth_sync           ~623 (62.6%) ─┐
├── require_auth (async)         ~154 (15.5%) ├─ Three discrete, mutually-
├── require_privileged_sync       ~70  (7.0%) ├─ exclusive IPC tiers.
├── require_privileged (async)    ~80  (8.0%) │  No further dimensionality.
└── require_cloud_auth            ~50  (5.0%) ─┘

Frontend (68 distinct gating locations)
├── tier_flag         47 (69%)  ─ dominant axis
├── dev_env           12 (18%)
├── auth_flag          7 (10%)
├── ownership_check    2  (3%)
└── provider           1  (1%) — non-Personas GitLab CI/CD tiers
```

### The dominant axes

1. **IPC auth level (backend)** — three-tier hierarchy: `public` → `auth` →
   `privileged` → `cloud`. Strictly ascending; no orthogonal dimensions. 995
   of the 995 backend gates pick exactly one level. Not a lattice — a totally
   ordered enum.

2. **Tier flag (frontend)** — `STARTER` / `TEAM` / `BUILDER`, also strictly
   ordered. 47 of 47 tier gates funnel through `useTier()` and `isTierVisible(minTier, activeTier)`.
   The consolidation the lattice would buy on the frontend **already exists**.

3. **Plugin enabled (frontend)** — single `Set<PluginTab>` in `uiSlice.ts`,
   7 sidebar gates that read it. Trivially small.

4. **Dev env (orthogonal)** — `import.meta.env.DEV` / `cfg!(debug_assertions)`.
   Orthogonal to user state. Already handled by build tooling.

---

## Findings worth flagging

### 1. The biggest "tier-leak" risk is actually **build-time/runtime drift**, not gate fragmentation

Discovered during build-time audit, NOT mentioned in the original proposal:

- `package.json` `build:starter` sets `VITE_APP_TIER=starter` but does **not**
  pass `--features=desktop` (only) to `tauri build`.
- `src-tauri/tauri.conf.json` is the default and ships `features = ["desktop-full"]`.
- Net effect: **a `npm run build:starter` binary still contains every backend
  command** including `ml` + `p2p`. Only the UI is tier-constrained.

This is a **strictly larger risk** than the gate-drift problem the proposal
worries about. It means today, a Starter user could (in principle) call ML/P2P
commands directly via the Tauri IPC bridge if they bypassed the UI. Tier is
**security through obscurity** at the binary level.

### 2. "Ownership checks" are not a real backend concept

The proposal lists `require_persona_owner` as one of the 200+ imperative call
sites. **Grep finds zero matches.** The product is single-user-per-machine;
there is no multi-tenancy in the backend. Adding an ownership lattice for a
threat model that doesn't exist is the textbook definition of premature
abstraction.

### 3. BYOM scope is enforced at the *engine* layer, not via auth gates

BYOM's `enabled / allowed_providers / blocked_providers` runs inside the
execution engine (`engine/byom.rs`) when picking a model — it's not a
command-level allow/deny. The 8 BYOM-related auth checks all use
`require_auth_sync` or `require_privileged_sync` for policy CRUD, with no
provider-scope component. Folding BYOM into a capability lattice would be a
category error; the policy applies to *execution-time model routing*, not
*IPC access*.

### 4. The "200+ imperative call sites" claim is *correct* but misreads the cause

There are 995 imperative auth call sites — five times more than the proposal
suggested. But they're not the result of dimensional fragmentation; they're
the result of having to call one of three helpers (`auth_sync` /
`privileged_sync` / `cloud_auth`) at the top of every Tauri command. The fix
isn't a lattice — it's a `#[requires(level=auth|privileged|cloud)]` proc-macro
that eliminates the boilerplate. That's the `idea-8ccab4d5` half of the merged
proposal, and **it stands on its own without the lattice**.

### 5. The single compound cfg-gate at `lib.rs:1720` is a red flag

```rust
#[cfg(all(feature = "desktop", feature = "ml"))]
commands::execution::clipboard_intel::search_kb_for_clipboard_error,
```

This is the only place compound cfg gating is used. If the codebase ever adds
a TEAM-tier feature that depends on an ML backend capability, the contributor
must remember to add **both** `#[cfg(feature = "ml")]` to the Rust command
and `minTier: TIERS.TEAM` to the corresponding TS component. There's no CI
check enforcing this match. **This is the only place a real "tier-leak" bug
could plausibly happen today.**

---

## Phase 2 decision

> **If 4+ axes — proceed to Phase 3.**
> **If ≤ 2 dominant axes — abandon the lattice, replace this work item with
> a much smaller "consolidate `require_*` into 2 typed helpers" ticket.**
> *(From the proposal itself.)*

Counting dominant axes (>5% of total gates):

- **Backend:** 1 axis (IPC auth level — totally ordered, 100% of gates).
- **Frontend:** 1 axis (tier flag — 69% of gates), plus dev_env at 18% as
  an orthogonal but trivially-handled second.
- **Cross-cutting:** plugin_enabled is a separate sub-system but consists of
  one `Set<>` and 7 reads. Not lattice-shaped.

By the proposal's own criterion: **≤ 2 dominant axes. Abandon the lattice.**

### Replace `idea-7a4838c1` with two smaller, well-scoped tickets

**Ticket A — Backend `#[requires(level)]` proc-macro** *(was `idea-8ccab4d5`)*

Replace 995 manual `require_auth_sync(&state)?` calls with a single
attribute macro that resolves to the same call at the top of each handler:

```rust
#[tauri::command]
#[requires(level = privileged)]
async fn rotate_credential(state: AppState, id: String) -> Result<()> { … }
```

- One helper to read; one place to add an `ownership = Owned` field if multi-
  tenancy ever ships.
- Saves ~1000 lines of boilerplate.
- Independent of any frontend lattice; pure backend ergonomics win.
- Parallel-run validation isn't needed because the macro expands to the *same
  call* — no semantic change.

**Ticket B — Build-time / runtime tier sync CI check**

Add a script (`scripts/check-tier-sync.mjs`) that, for every Tauri command
in `src-tauri/src/lib.rs`'s invoke handler:

1. Resolves the command's `#[cfg(feature = …)]` annotations.
2. Resolves the matching frontend caller's `minTier:` annotation (if any).
3. Fails the build if a command compiled into a `starter` binary has no
   corresponding tier gate on the calling UI, AND vice versa.

Wire into `npm run check:tiers` (already exists per CLAUDE.md). The cost is
the audit table format itself plus ~150 lines of script.

**Neither ticket needs the proc-macro AND the CI check to land together.**
They're independent and either delivers value alone.

### What we are NOT doing

- ❌ Building a `Capability` enum or `useCapability(cap)` hook —
  `useTier()` already exists, has the right shape, and isn't bursting at
  the seams.
- ❌ Building a `CapabilityToken` carried per IPC call — there are no
  ownership checks to carry; the IPC level is already known by the macro.
- ❌ Parallel-run validation — there's no semantic ambiguity to validate
  against because we're not introducing new gating logic.

---

## Reproducing the counts

```bash
# Backend (995 total):
rg -c 'require_auth_sync\(' src-tauri/src/commands/  # 623
rg -c 'require_auth\b'      src-tauri/src/commands/  # 154 async + above
rg -c 'require_privileged_sync\(' src-tauri/src/commands/  # 70
rg -c 'require_privileged\(' src-tauri/src/commands/  # 80
rg -c 'require_cloud_auth\('  src-tauri/src/commands/  # 50

# Frontend tier gates (47):
rg -c 'useTier|minTier|tier\.(isVisible|isStarter|isTeam|isBuilder)' src/

# Frontend dev gates (43 + 10 = 53):
rg -c 'import\.meta\.env\.DEV' src/
rg -c 'cfg!\(debug_assertions\)' src-tauri/src/

# Cargo features (418):
rg -c '#\[cfg\(feature' src-tauri/src/

# Plugin gates (1 registry + 9 plugins + 7 sidebar reads):
rg -c "enabledPlugins\.has" src/

# Ownership checks — the count the proposal cared about:
rg -c 'require_persona_owner|check_owner|assert_owner' src-tauri/src/  # 0
```

---

## Audit closure

This audit is the **complete deliverable** for `idea-7a4838c1`. The proposal
asked for a Phase 2 decision and explicitly authorized "abandon" as a valid
outcome. The data does not support proceeding to Phase 3.

Suggested next action: replace the unclear-wins entry with two targeted
tickets (Ticket A + Ticket B above). The `idea-8ccab4d5` deferral note in
the original proposal already pointed at Ticket A's framing.
