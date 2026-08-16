# Golden path — handing a credential to a child process

> Situation node: `backend-runtime/subprocess-and-io/credential-injection-into-child` ·
> [situation spine](../situation-spine.md) · recurrence 6 · risk **HIGH** · sides **server** ·
> spine label **convergence: CONVERGED** — **see §12.1; it holds on 2 clauses of 5, and the
> clause carrying this document's headline is an invention** ·
> dimensions: **security · resilience · code-quality · function**
> Composed 2026-08-16 against `master` @ `cd9d094d9`.
>
> **Sweep.** All **963** non-generated `.rs` files under `src-tauri/`. Every `Command::new` in
> the tree located and classified — **139 total, 129 outside `#[cfg(test)]`** — each of the 15
> that touch the child's environment opened by hand. Read in full: `engine/src/cli_process.rs`,
> `engine/src/cli_mcp_config.rs`, `engine/src/prompt/cli_args.rs`, `engine/src/desktop_bridges.rs`,
> `src/engine/runner/env.rs`, `src/engine/runner/credentials.rs`, `src/engine/tool_runner.rs`,
> `src/engine/mcp_tools.rs`, `src/engine/credential_broker.rs`, `src/engine/management_api.rs`,
> `src/engine/healthcheck.rs`, `src/commands/fleet/{pty,headless,external}.rs`,
> `src/commands/credentials/{auth_detect,cli_capture}.rs`, `src/browser_bridge/mod.rs`,
> `src/mcp_server/install.rs`, `core/src/crypto.rs`, `db/src/lib.rs`.
>
> **Measured by executing, not reading.**
> 1. A **read-only copy** of the operator's `personas.db` (347 MB, copied 2026-08-16 16:21 while
>    the app was running) queried for the key registry: **1,027 rows in `external_api_keys`**.
> 2. The **on-disk artefacts inspected directly** — `%TEMP%`, `%APPDATA%\com.personas.desktop`,
>    `~/.claude` — and their **Windows ACLs read with `icacls`**, then the inheritance behaviour
>    **proved with a live probe file** created and deleted in `%TEMP%`.
> 3. The §9 rule and its positive control built, run in a **private scratch registry**
>    (`cij-final-rules.json`, a filename unique to this composer), **fault-injected six ways**,
>    and **re-extracted from this finished document and re-run: identical**. The full registry
>    was **not** run; one existing rule (`unpinned-billing-account-spawn`) was re-run alone to
>    confirm a brief claim.
> 4. Two independent implementations of every headline count — the census engine (Node `RegExp`)
>    and a separately-written Python walker — agreeing exactly, with all 15 matches hand-opened.
>
> `cargo` was **not** run. **No secret value, prefix, or partial appears anywhere below.** Every
> credential is reported as shape, length, location, file mode, count and scope only. The
> keyring was not read. Nothing was spawned that could consume the operator's quota.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five checkouts exist and were read.

---

## 0. The headline

**This app hardens the file holding its encrypted secrets, and the file holding the key that
decrypts them, to owner-only. It does not harden the file holding the token that lets a caller
ask the app to use those secrets on its behalf — and it puts a copy of that token in its own
process environment, where all 127 of its 129 child-process spawn sites hand it to the child.**

Read with `icacls`, on the operator's machine, today:

| artefact | what it holds | ACL |
| --- | --- | ---: |
| `%APPDATA%\com.personas.desktop\master.key` | the AES-256-GCM master key | `DOLLARSTORE\mkdol:(F)` — **owner only** |
| `%APPDATA%\com.personas.desktop\personas.db` | 25 encrypted vault credentials | `DOLLARSTORE\mkdol:(F)` — **owner only** |
| `%TEMP%\fleet-mcp-<uuid>\mcp.json` | a live 32-char MCP session token | **inherits** `dollarstore\CodexSandboxUsers:(I)(M,DC)` |
| `%TEMP%\personas-workspace\<persona>\.claude\personas-mcp-config.json` | the plaintext bridge key + delegate API key | **inherits** the same |

`CodexSandboxUsers` is a local group whose members are **two other user accounts**
(`CodexSandboxOffline`, `CodexSandboxOnline`). The `%TEMP%` ACE is `(OI)(CI)(M,DC)` —
object-inherit, container-inherit, Modify — so **every** file this app writes there is
readable and writable by those accounts. That is not a claim from documentation: a probe file
created in `%TEMP%` and immediately deleted came back with the identical inherited ACE.

The hardening code exists. `core/src/crypto.rs:794` calls `restrict_file_permissions`, which
runs `icacls /inheritance:r /grant:r <user>:(F)` on Windows and `chmod 0600` on Unix, and
**returns an error rather than leaving the file readable** (`:808-846`). A second, independently
written copy lives at `db/src/lib.rs:1618/1640`. **Both are private `fn`s in their own module.
Neither is reachable from any of the four places this app writes a secret to disk for a child
to read.**

### The ambient copy, which no scrub can reach

```rust
// src/lib.rs:1737-1746 — at startup, in a spawn_blocking task
match engine::management_api::get_or_create_system_api_key(&bootstrap_pool) {
    Ok(key) => {
        std::env::set_var("PERSONAS_API_KEY", &key);
        std::env::set_var("PERSONAS_BRIDGE_URL", "http://127.0.0.1:9420");
```

That key is minted by `management_api.rs:591` with `expires_at = None` and
`bound_origin = None`, holding `["personas:read", "personas:execute", "proxy"]`. Verified in the
live registry: **1,027 rows, `expires_at` NULL for all 1,027, `bound_origin` NULL for all
1,027.** The broad `proxy` scope is what `authorize` (`management_api.rs:357-376`) accepts for
`POST /api/proxy/<any credential_id>` — a call the app then performs *with that credential* —
and it is the **only** scope that passes `POST /api/broker/mint/<id>`, the door that mints
further consumer identities (`:349-356`).

So the value in that environment variable is a bearer token for **all 25 credentials in the
vault** (GitHub, Gmail, Google Calendar, Notion, Linear, Sentry, Supabase, ElevenLabs, ClickUp,
Asana, Attio, Airtable, …) plus persona execution plus handle minting, with no expiry and no
origin binding.

`std::env::set_var` mutates the process environment. `tokio::process::Command` inherits it
unless told otherwise. **Exactly 2 of 129 spawn sites tell it otherwise.**

| | count |
| --- | ---: |
| `Command::new` sites in 963 `.rs` files (`#[cfg(test)]` excluded by brace-matched range) | **129** |
| …that call `.env_clear()` and build the child's environment explicitly | **2** |
| …that populate the child's environment from a map *on top of* the inherited one | **13** |
| …that touch the child's environment not at all | **114** |
| sites anywhere in the tree that remove `PERSONAS_API_KEY` from a child | **0** |

By program: `git` (**30** spawn sites), `cmd`/`sh`/`powershell` (12),
`taskkill`/`kill`/`tasklist`/`ps` (12), `ffmpeg`/`ffprobe` (9), `curl` (5), `icacls` (3), plus
`npx`, `bun`, `cargo`, `rg`, `blender`, `whisper`, `vercel`, `explorer`/`open`/`xdg-open`, and the
9 third-party health-probe CLIs (`gh`, `aws`, `gcloud`, `az`, `docker`, `kubectl`, `heroku`,
`vercel`, `netlify` — `healthcheck.rs:115-182`, spawned at `:218`). **None of them needs
`PERSONAS_API_KEY`, and all of them get it.**

### Stated plainly, as the brief asks

- **`src/engine/mcp_tools.rs:2076`** (and its Windows arm at `:2063`) spawns a **user-configured
  MCP server** — an `npx` / `docker` / `python` / `uvx` command from a gateway row — with the
  parent environment inherited. That third-party process can read `PERSONAS_API_KEY` and
  `PERSONAS_BRIDGE_URL` out of its own environment and issue
  `POST http://127.0.0.1:9420/api/proxy/<credential_id>` against any of the 25 vault
  credentials. It has no need for either variable.
- **`engine/src/desktop_bridges.rs:488`** spawns a **caller-supplied command** for the remote
  terminal bridge, same inheritance, same consequence.
- **`src/commands/infrastructure/dev_tools/git_ops.rs:58`** and 29 sibling `git` spawns run
  `git` inside a user-designated repository with the app's full environment. `git` executes
  that repository's hooks and honours its `core.*` config; anything it starts inherits the
  token. `git` has no need for it.
- **The Claude CLI child runs with `--dangerously-skip-permissions`** — **12 argv-emitting sites**
  (`cli_args.rs:107`, `:296`; `cli_process.rs:418`; `fleet/{external.rs:169, headless.rs:132,
  pty.rs:324, pty.rs:364}`; `oneshot.rs:185`; `session.rs:2174`; `fix_pass.rs:198`;
  `memory_reflection.rs:330`; `consolidator.rs:348`), against **2** sites anywhere in the tree that
  pass `--allowedTools` (`auto_cred_browser.rs:807`, `:820`). `core/src/redact.rs:3` states the
  flag as a premise of the entire redaction design. So the child has a Bash tool.
  **Every command a persona runs is a grandchild that inherits the token**, and
  the strip lists that *do* run on those spawns remove `CLAUDECODE`, `CLAUDE_CODE`,
  `DISABLE_PROMPT_CACHING*` (`cli_args.rs:184-199`) and — at 13 of 18 sites — the three
  `ANTHROPIC_*` billing vars. Nothing removes `PERSONAS_API_KEY`. A persona that runs `env`
  sees it.

### The narrow door exists, is correct, and no spawn uses it

`engine/src/credential_broker.rs:130` `mint_derived_handle` is the right answer, already
written: a fresh key scoped to exactly one credential
(`proxy:credential:<id>` + `cred:<connector>:use`), a **hard expiry** clamped into
`[5 min, 24 h]` with a 60-minute default (`:40-46`), and an audit row at mint. Its own comment
says *"'Short-lived' is a security property, not a suggestion; the mint path clamps, never
trusts."*

**It has 2 call sites, both operator-initiated** — a Tauri command (`commands/credentials/broker.rs:34`)
and an HTTP route (`management_api.rs:827`). **Zero spawn paths reach it.** And in the live
database, across four months and 1,027 key rows: **0 rows carry an `expires_at`, 0 carry a
`label`, 0 are named `handle:*`.** The narrow door has never been opened.

Meanwhile the broad door is opened on every app start. 1,027 rows minted since 2026-04-07;
**1,020 have `last_used_at` NULL**; 1,026 revoked, 1 live. The `api_key_audit` table — which
records what a key actually did — holds **1 row**.

**Everything else in this document is a consequence of those two facts: the credential handed
to children is the broadest one the system can mint, and the mechanism that hands it over is
inheritance, which no call site chose.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration.
No file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** A child process's environment is a **set you choose**, not a delta you apply.
> Every runtime makes inheritance the default and subtraction the obvious edit, so the natural
> way to write this code produces a child holding everything the parent held. State what the
> child gets; do not state what it does not get. A denylist over what you *add* cannot remove
> what the child *inherits*, and the two are easy to confuse because they are edits to the same
> object.
>
> **P2 — physics, and the sharpest clause here.** The credential you hand a child must be
> **minted for that child**: scoped to the one resource it needs, and carrying an expiry. A
> credential that authorizes everything and expires never is not a convenience; it is a decision
> that the blast radius of the least-trusted child is the whole system. If you already have a
> narrow-minting facility and reach for the broad key anyway, you have paid for the security
> property and declined to take delivery.
>
> **P3 — physics.** A secret in the parent's own process environment is a secret in **every
> descendant's** environment, transitively and forever, and there is no call site at which
> anyone decided that. Process-global mutation converts a per-child decision into no decision at
> all. Set it on the child's launch descriptor or not at all.
>
> **P4 — physics.** Argument vectors are **public on every mainstream OS** — `/proc/<pid>/cmdline`
> is world-readable, and Windows exposes the command line through WMI to any process running as
> the same user. Environments are not (`/proc/<pid>/environ` is owner-only). A secret therefore
> goes on stdin or in the environment or in a file, never in argv, and this ranking is not a
> preference — it is a property of the operating systems.
>
> **P5 — physics.** A secret written to disk for a child to read must be **deleted by a value's
> lifetime, not by a task's completion.** Cleanup attached to a reaper, a completion handler, an
> exit hook or a `finally` in the happy path is cleanup that a crash, a force-kill or an early
> return skips — and those are precisely the situations in which the secret matters most.
>
> **P6 — physics.** A secret file's permissions must be set **before the content is visible at
> its final path**, and the write must **fail** if they cannot be set. Chmod-after-write leaves a
> window at whatever the ambient default is; and in a shared scratch directory, "ambient default"
> means whatever ACL that directory inherits — which is not yours to assume.
>
> **P7 — ergonomics, stated as a failure mode because that is how it appears.** A team hardens
> the artefacts it thinks of as *"the secrets"* — the key file, the encrypted store — and leaves
> the *capability* that stands in for them unhardened, because a token that merely lets you
> **ask** for a secret does not feel like a secret. It is one. Harden by what a value can
> **authorize**, not by what it looks like.
>
> **P8 — ergonomics.** A cleanup, a permission set, or an environment construction that is
> hand-copied is a control that will exist in N−1 places within a year. The place to put it is
> the function that creates the artefact, so that the artefact cannot be created without it.
>
> **Scale condition.** P2, P3, P4 and P6 are correctness on the first call. P1 and P5 begin to
> bite the moment a second spawn path exists. P7 and P8 pay the first time someone audits.

### Warrant evidence — the five siblings, censused independently

`personas-web` (2 spawns, both build-time `git` reads in `scripts/`, **no credential ever reaches
a child** — the structural negative control), `brainiac` (**zero** `std::process::Command` in the
entire Rust workspace; all child-process surface is `scripts/`, one Node tool and Docker),
`personas-cloud` (2 code spawns, 6 launch sites), `vibeman` (22 spawns), `ascent` (5 spawns).

- **P1 does NOT converge. It is a 5/5 silence and this repo is the only one of six that has ever
  written the compliant form.** Zero `env_clear()`, zero `envClear`, zero
  `spawn(…, {env: {…}})` that does not spread the parent, in all five. The three repos that
  *thought about it* all reached for **subtraction**: `personas-cloud/packages/worker/src/executor.ts:108`
  spreads `process.env` then `delete childEnv['CLAUDECODE']` at `:124`;
  `vibeman/src/lib/claude-terminal/cli-service.ts:314-316` and `:1148-1150` do the same for
  `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT`; `ascent/src/lib/llm/claude-cli.ts:99-100` does
  `const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;`. The only construction anywhere
  in five repos is not a spawn API at all — `brainiac/docker-compose.deploy.yml:62-76` enumerates
  each container's environment by name. **Three independent teams reinvented the *wrong* half of
  P1**, which is the strongest evidence the head could have that inheritance-plus-subtraction is
  the natural failure mode; but it means P1 as a *prescription* is a **house convention with one
  adherent**, and this document labels it that.
- **P3 is convergent, as a 5/5 agreement on the practice, and Personas is the outlier.** No
  non-test `std::env::set_var` / `process.env.X =` / `os.environ[…]=` puts a **secret** into the
  parent's own environment in any of the five. Two of them wrote the invariant down rather than
  merely happening to satisfy it: `personas-cloud/packages/worker/src/executor.ts:106-107`
  comments that the child env is built "never into `process.env`", and
  `brainiac/scripts/backup-offsite.sh:143-150` exports the S3 keys **inside a subshell** so only
  `aws` and its children see them. Two independent articulations of the same constraint is
  convergence. **Personas is the one repo in six that violates it** (`src/lib.rs:1744`).
- **P4 is convergent both ways, which is the most instructive result in the oracle.** Three repos
  use stdin *by design* to keep a secret out of argv, and `brainiac` wrote down the reason twice
  — `scripts/first-boot.sh:21-24` and `:236-237`: *"`/proc/<pid>/cmdline` is world-readable,
  `/proc/<pid>/environ` is not"* — implementing it as `curl -K -` at `:109-123` and
  `verify-retrieval.sh:108`. And **the same repo violates it at 4 sites in the same directory**:
  `smoke-test-env.sh:111` puts a bearer in `curl`'s argv; `backup.sh:72` and `restore.sh:77` pass
  `-e "PGPASSWORD=$…"` to `docker compose exec`; `restore-drill.sh:103` the same with a per-run
  ephemeral. **The doctrine and the defect are four files apart.** That is physics with a known
  adoption problem, not a local taste.
- **P5 converges on exactly one implementation, and its neighbour is the counterexample.**
  `brainiac/scripts/restore-drill.sh:84-89` installs `trap cleanup EXIT INT TERM`;
  `.github/workflows/deploy-test.yml:102-105` deletes the generated `.env.test` in an
  `if: always()` step. Four files away, `first-boot.sh:245-253` writes a freshly-minted token to
  `$ENV_FILE.tmp.$$` with **no trap at all**, so a failure between the write and the `mv` strands
  a plaintext token at the repo root. Nobody else in the fleet writes a secret file for a child.
- **P6 converges on one implementation and one near-miss, both in `brainiac`.**
  `first-boot.sh:227-228` does `( umask 077; … )` **then** `chmod 600` into a self-ignoring
  `secrets/` dir — correct. `first-boot.sh:252` `chmod 600`s **after** the awk write, leaving the
  default-umask window P6 names. **No other repo sets a mode on anything.**
- **P2 converges as an aspiration and diverges as a practice.** `vibeman` has the sharpest answer
  in the fleet: `VIBEMAN_HOOK_SECRET` is minted fresh per execution
  (`cli-service.ts:595`, `:1103`; `executionManager.ts:225`; `src-tauri/src/commands/claude_cmds.rs:314-317`),
  handed only to that child, and **verified on the way back in** against the execution record
  (`app/api/hooks/task-completed/route.ts:36-44`). It is a capability, not an account credential
  — though it carries no expiry and the check is a plain `!==` rather than a timing-safe compare.
  `personas-cloud` is the opposite: `dispatcher.ts:670-672` sets `ANTHROPIC_API_KEY` on every
  child from either a refreshing OAuth token or a long-lived `CLAUDE_TOKEN` (`config.ts:54`), and
  the user connector secrets decrypted at `:694-726` into `CONNECTOR_*` carry **no scope, TTL or
  expiry field at all**. **2 of 5 mint anything narrow; 0 of 5 set an expiry.**
- **P7 has no external warrant and is offered as an observation.** No sibling has the
  encrypted-store-vs-capability asymmetry to exhibit, because none of them has a local credential
  proxy. It is retained because §0 measures what it costs here.
- **P8 is convergent as a defect.** `personas-cloud/packages/worker/src/validation.ts:73`
  `sanitizeEnvVars` and `vibeman/src-tauri/src/process/manager.rs:104-107` `config.env_remove` are
  two independently-written denylists over *user-supplied* keys that never touch what is
  inherited — the same shape as this repo's two disagreeing denylists (§7.E).
- **The grandchild cascade (a corollary of P3) is unbounded in 3 of 5, and `brainiac` is the only
  structural answer.** `personas-cloud` hands the full `childEnv` to a `claude` whose default
  permission argument is `--dangerously-skip-permissions` (`packages/shared/src/prompt.ts:727-728`),
  so Bash grandchildren inherit every `CONNECTOR_*` secret; the Fly-Machine container boundary
  described in `docs/phase-2-fly-machines-workers.md` **does not exist in the tree**
  (`machinePool.ts` is absent). `ascent/src/lib/standard/doctor.ts:105` `execSync`s capability
  commands read verbatim from `.ai/manifest.yaml` with `ASCENT_CONFORMANCE_TOKEN` inherited, and
  the risk is logged as prose at `docs/harness/biz-bug-scan-2026-06-29/INDEX.md:66`. `vibeman`
  gates *which binary* may spawn (`commandSandbox.ts:45-62`) but never the environment, and
  `buildScanner.ts:181` spawns a raw `cmd.exe /c` anyway. `brainiac/scripts/first-boot.sh:122`
  runs a throwaway container that receives the bearer on **stdin** and has no secret in its
  environment at all, so its children inherit nothing.

---

## 1. Trigger

You are in this situation when you are about to type any of:

- "just pass the API key as an env var to the child"
- "the CLI needs the token — I'll add it to the command line"
- "write a temp config the subprocess can read"
- "set it once at startup so everything can see it"
- "strip the vars we don't want it to have"
- "it's only in `%TEMP%` / `/tmp`, and only for a second"
- **If you are about to write `Command::new`, `std::env::set_var`, `cmd.env(`, `cmd.env_remove(`,
  `tempfile::NamedTempFile` next to the word `token`, `--mcp-config`, or `fs::write` of anything
  with a `headers` or `env` block in it — you are in this situation.**
- If you are about to mint an `external_api_keys` row for anything that is not a human pressing a
  button, you are in this situation and the answer is `mint_derived_handle`.

### Boundaries with the adjacent paths

- **[`headless-model-call`](./headless-model-call.md)** owns *which billing identity pays for a
  model call* and the ceilings on it. Its `unpinned-billing-account-spawn` rule (5 files / 5
  matches, **re-run alone at `cd9d094d9` and still 5/5**) counts Claude spawns missing
  `force_subscription_auth`. **That is a different question from this leaf's**, and the
  non-overlap test is exact: a Claude spawn that strips all three `ANTHROPIC_*` vars perfectly and
  still hands the child a whole-vault bearer token is **100% compliant with that path and 0%
  compliant with this one**. This document adds no second counter for the billing strip.
- **[`secret-and-pii-redaction`](./secret-and-pii-redaction.md)** owns the secret **leaving** —
  which sink, through which redactor. This path owns the secret **arriving** at a process that did
  not ask for it. They meet at `core/src/redact.rs`, whose module doc names
  `--dangerously-skip-permissions` as the premise of its own design; this path measures what that
  same flag does to the *environment* rather than the output.
- **[`column-encryption-at-rest`](./column-encryption-at-rest.md)** owns the secret in a column.
  **Confirmed and extended here:** the column *and* the master key are ACL-hardened to owner-only,
  verified with `icacls`. This path measures the artefacts that are not.
- **[`oauth-connect-flow`](./oauth-connect-flow.md)** already owns
  `resolve_credentials: fn() -> Result<(String,String)>` end to end — §8.4 and the "where the type
  cannot reach" note. **Confirmed independently and not re-derived** (see §12.2).
- **[`spawning-a-cli-subprocess`](./spawning-a-cli-subprocess.md)** and
  **[`cancelling-in-flight-work`](./cancelling-in-flight-work.md)** own child-process *mechanics*
  — `kill_on_drop`, the reap, `CREATE_NO_WINDOW`. `unbound-child-lifetime` (12 files / 13 matches)
  owns the lifetime; this path owns the payload.

---

## 2. The one way

**Decide what the child is allowed to hold, then build exactly that — never inherit and subtract.**
Concretely: call `.env_clear()` and then `.envs(sanitized_env())`, adding only the variables this
particular child needs, because a denylist over what you *add* cannot remove what the child
*inherits*, and this repo's parent environment currently holds a whole-vault bearer token that no
child needs. **Never put a credential in your own process's environment** — `std::env::set_var` of
a secret is a decision, made once, that every descendant of this process forever holds it, and
five sibling repos independently do not do this. **Mint the credential for the child, not for the
system**: reach for `credential_broker::mint_derived_handle(pool, credential_id, consumer, ttl)`,
which is scoped to one credential and expires within 24 hours by construction, and never hand a
subprocess the `proxy`-scoped system key. **Keep it out of argv** — argument vectors are readable
by other processes on both mainstream platforms and environments are not, so pass a secret through
`stdin` (the pattern `cli_process.rs:377-383` already implements), through the child's environment,
or through a file, in that order of preference. **If it must be a file, make the function that
writes it the function that hardens and removes it**: set owner-only permissions *before* the
content is visible at its final path and fail the write if you cannot, and delete it from a
`Drop` guard rather than from a reaper task — a cleanup attached to a completion handler is a
cleanup that a force-kill skips, and this machine has the stranded token files to prove it. **And
never assume the temp directory's defaults are yours**: `%TEMP%` on this operator's machine grants
Modify to a group containing two other accounts, inherited by every file written there.

If you must get one thing right first: **the credential you hand a child should be one that would
not matter if the child leaked it.**

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/commands/credentials/auth_detect.rs:498` `sanitized_env()` | **The allowlist.** Returns `Vec<(String,String)>` containing only `PATH`, `USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`SYSTEMROOT` (Windows) or `HOME` (Unix). Its doc comment is the whole doctrine in three lines: *"We clear the full environment to avoid leaking secrets (e.g., API keys in env vars) and only pass through variables required for the CLI tools to locate their config."* Used at **2 of 129** spawn sites. |
| `src/commands/credentials/auth_detect.rs:424-433` · `cli_capture.rs:627-632` | The two-line application: `.env_clear().envs(sanitized_env())`. **The site to copy.** |
| `src/engine/credential_broker.rs:130` `mint_derived_handle(pool, credential_id, consumer_name, ttl_minutes)` | **The narrow credential.** Scopes are `proxy:credential:<id>` + `cred:<connector>:use` — not `proxy`. TTL clamped into `[5, 1440]` minutes (`:40-46`), default 60. Audit row at mint. `consumer_name` is **required and rejected if empty** (`:137-141`) — a handle cannot exist without naming who holds it. A derived handle **cannot mint further handles** (`management_api.rs:349-356` requires broad `proxy` for `/api/broker/mint/`). |
| `src/engine/credential_broker.rs:98` `authorize_credential_use(scopes, credential_id, service_type)` | Pure, default-deny scope intersection. Exact match, no substring, no case folding; an empty scope list authorizes nothing. |
| `core/src/crypto.rs:783-798` — the atomic secret write | `NamedTempFile::new_in(parent)` → write → **`restrict_file_permissions` → `persist`**. Permissions set *before* the file is visible at its final path, and the whole thing returns `Err` if they cannot be set. This is P6 implemented correctly. **Its restrictor is private (`:808`) — see §8.1.** |
| `engine/src/cli_mcp_config.rs:338` `SidecarScrubGuard::new(exec_dir)` | **RAII deletion.** Scrubs the secret-bearing sidecar config in `Drop`, so it fires on normal completion, error early-return, cancel, timeout **and panic-unwind**, without threading a call through each exit. |
| `engine/src/cli_mcp_config.rs:287` `scrub_mcp_sidecar(exec_dir)` | The idempotent explicit scrub, for the one case a `Drop` guard is too late for (§6). |
| `src/engine/runner/env.rs:83` `sanitize_env_name(name)` | Refuses to let a credential *field name* become `PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, … 30 exact names + 6 runner-config prefix families (`NPM_CONFIG_`, `UV_`, `BUN_`, `DENO_`, `PIP_`, `CARGO_`), the prefixes added because npm forwards `npm_config_node_options` as `--node-options`. Correct, tested, and **solving a different problem than this path's** — it bounds what you *add*, not what is *inherited*. |
| `src/engine/runner/credentials.rs:51` `ZeroizingFields` | Shrinks the in-memory plaintext lifetime of a decrypted credential map from "the whole execution" to "one injection", zeroizing values on `Drop` and on `replace`. |
| `src/engine/runner/credentials.rs:904-913` | The reserved-name refusal: a vault field is never injected under `ANTHROPIC_API_KEY`/`_AUTH_TOKEN`/`_BASE_URL`, with a test at `:1168-1181` that also asserts **the values do not leak under any other name**. |
| `engine/src/cli_process.rs:377-383` — the detached stdin writer | The existing, working precedent for handing a child bytes it must not have in argv. |
| `engine/src/cli_process.rs:44` `force_subscription_auth(&mut cmd)` | The one unconditional per-spawn strip, folded into `spawn_headless_claude` at `:359` with *"Mandatory … No caller may opt out."* The right *shape*; the wrong *list* for this leaf (it names 3 variables, and the one this path is about is not among them). |
| `scripts/census/` | the ratchet mechanism. §9. |

**Do not exist — this path names them:**

- **A shared "write a secret file" helper.** Two private ACL hardeners
  (`core/src/crypto.rs:808`, `db/src/lib.rs:1618`), zero call sites outside their own modules,
  and **4 secret-file writers that reach neither**.
- **Any spawn helper that constructs the child's environment.** `spawn_headless_claude` is the
  repo's one shared spawner and it inherits (`cli_process.rs:330`).
- **A per-child credential on any spawn path.** `mint_derived_handle`'s 2 call sites are both
  operator-initiated.
- **A test that would notice a child holding a credential it does not need.** There is a test
  that reserved *names* are not injected (`credentials.rs:1168`); there is none that the child's
  environment is a chosen set.
- **Any bound on what a grandchild inherits.** The Claude child runs with
  `--dangerously-skip-permissions` and no `--allowedTools` on 23 of 25 sites.

---

## 4. Steps

1. **Name the child's need before you name the variable.** Which single credential does this
   process require? If the answer is "several" or "whatever it might want", stop — you are about
   to hand over the system key.
2. **Mint for the child.** `mint_derived_handle(pool, credential_id, "<what this child is>", None)`.
   The consumer name is required, so the handle is attributable; the TTL is clamped, so it dies.
   Never `get_or_create_system_api_key` for a subprocess.
3. **Build the environment, do not edit it.** `.env_clear()` then `.envs(sanitized_env())` then
   the one or two variables this child needs. If `sanitized_env()`'s allowlist is missing something
   your child genuinely requires, **add it there with a comment** — that is one edit and one
   review, versus a fourteenth inheriting spawn.
4. **Never `std::env::set_var` a secret.** There are 4 non-test `set_var` sites in 963 files; the
   3 that are fine set `ORT_DYLIB_PATH`, `RUST_BACKTRACE` and a bridge URL. If an in-process
   consumer needs the value, pass it — a `OnceLock` inside the module, a parameter, a struct
   field. The process environment is the one place it also reaches every subprocess.
5. **Keep it out of argv.** Prefer stdin (`cli_process.rs:377-383`), then the child's own
   environment, then a file. If a third-party CLI only accepts a flag, that is a fact about the
   CLI you should write down at the call site — not a default.
6. **If it must be a file, write it through one function that does all three things**: sets
   owner-only permissions *before* the content is visible at its final path (`crypto.rs:783-798`
   is the shape), fails the write if it cannot, and returns a guard whose `Drop` removes it.
   Do not attach the removal to a reaper, a completion handler, or an `if` at the end.
7. **Do not trust the temp directory.** Its ACL is inherited from whatever else on the machine
   has configured it. Either harden the file explicitly or write it under the app's own data
   directory, which this app already hardens (`db/src/lib.rs:1598-1607`).
8. **Ask what the grandchild gets.** If the child can execute arbitrary code — a shell, an agent
   with a Bash tool, `npx`, `docker` — its environment is the environment of everything it runs.
   That is the population your allowlist is actually protecting.
9. **And then stop.** `kill_on_drop`, the reap, and the Windows console flag belong to
   [`cancelling-in-flight-work`](./cancelling-in-flight-work.md); the billing strip belongs to
   [`headless-model-call`](./headless-model-call.md). Do not re-derive either here.

### Can the type make the wrong call impossible? — asked before §9

**Yes, at two places, and both are worth more than the gate. See "Type over gate", below §9.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| **`std::env::set_var("<SECRET>", …)`** | Converts a per-child decision into no decision. Every descendant of the process, transitively, forever. **Measured: 1 site, and it reaches 127 of 129 spawn sites and every grandchild of the agent CLI. Five sibling repos have 0.** |
| **`cmd.env_remove(K)` as the environment "policy"** | Subtraction can only remove names you enumerated. `env_removals` in this repo holds exactly `CLAUDECODE`, `CLAUDE_CODE`, `DISABLE_PROMPT_CACHING`, `DISABLE_PROMPT_CACHING_1H`, `DISABLE_PROMPT_CACHING_5M` (`cli_args.rs:184-199`) — and reads, at the call site, exactly like billing hygiene. **Measured: 12 spawn sites run a removal list; 0 of them remove the whole-vault token.** |
| **Handing a subprocess the system key** | The key that exists so the app can talk to itself becomes the key every child holds. **Measured: `proxy` + `personas:execute` + `personas:read`, `expires_at` NULL on all 1,027 rows, `bound_origin` NULL on all 1,027, authorizing all 25 vault credentials and the handle-minting door.** |
| **A credential substituted into a process argument** | `/proc/<pid>/cmdline` is world-readable; Windows exposes the command line via WMI to same-user processes. `/proc/<pid>/environ` is owner-only. **Measured: 2 sites (`tool_runner.rs:637`, `:1091`), both `curl`, both also setting the same values in the env — so the argv copy buys nothing and costs the exposure.** |
| **Cleanup in the reaper instead of in `Drop`** | The reaper does not run when the app is killed. **Measured on this machine: 6 `fleet-mcp-*` temp dirs created, 0 removed, and 2 still holding a 32-char session token 7 days later — while the `fleet_sessions` table holds 0 rows. The session record was deleted and the session's credential file was not.** |
| **`fs::write` for a secret** | No mode, no ACL, no atomicity, no guard. The correct four-line shape is in this repo at `crypto.rs:783-798` and is unreachable from every site that needs it. **Measured: 4 secret-file writers, 0 hardened.** |
| **`chmod`/`icacls` after the write** | Leaves a window at the ambient default. `brainiac/scripts/first-boot.sh:252` does exactly this; `crypto.rs:794` does it before `persist` and is the counterexample. |
| **Assuming `%TEMP%` / `/tmp` is private** | It is whatever the machine says it is. **Measured and proved with a probe: `%TEMP%` here carries `(OI)(CI)(M,DC)` for a group containing two other accounts, and every file written there inherits it.** |
| **A second env denylist** | Two lists that guard the same boundary drift apart in both directions. **Measured: `runner/env.rs` 30 names + 6 prefixes vs `desktop_bridges.rs` 38 names; intersection 15; 15 only in the first, 23 only in the second; neither is a superset.** |
| **Treating a capability token as "not a secret"** | A token that lets the holder *ask* the app to use a credential is worth the credential. **Measured: `master.key` and `personas.db` are ACL-hardened to owner-only; the file holding the token that unlocks their contents through the proxy is not.** |
| **Minting a key with `expires_at: None`** | "Short-lived" is the entire security property. **Measured: 1,027 of 1,027 rows have no expiry; the facility that clamps a TTL has produced 0 rows in 4 months.** |

---

## 6. Evidence

**The one site to copy: `src/commands/credentials/auth_detect.rs:424-433`, with
`sanitized_env()` at `:498-536`.**

```rust
let mut cmd = Command::new(&bin_path);
cmd.args(&args)
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    // Clear env to prevent credential leaks to the subprocess.
    // Re-add only PATH (needed for child subprocesses) and
    // HOME/USERPROFILE (needed by many CLIs for config dirs).
    .env_clear()
    .envs(sanitized_env());
```

It is the only construction in this repository and, per the oracle, **the only one in six
repositories**. It is two method calls. It is used at **2 of 129** spawn sites — which is the same
shape as `scrub_secrets`'s 9-of-10 `&[]` call sites in
[secret-and-pii-redaction](./secret-and-pii-redaction.md) §5: the best answer in the tree,
switched off almost everywhere it belongs.

Also exemplary, each for one property:

| site | the property to copy |
| --- | --- |
| `engine/src/cli_mcp_config.rs:338-352` `SidecarScrubGuard` | **RAII deletion of a secret artefact.** Its docstring names every path it covers — *"normal completion, error early-returns, cancel, timeout, and a panic-unwind — without threading a scrub call through each site"* — and why the guard is necessary at all: *"The default `exec_dir` is a reused per-persona temp dir that is never deleted."* |
| `src/engine/runner/mod.rs:2960-2967` | **Knowing when RAII is too late.** An explicit scrub *before* the worktree finalize, because finalize runs `git add -A` onto a review branch and the `Drop` guard fires after it. The comment says so: *"this explicit call is load-bearing. Idempotent with the guard."* This is the single most careful piece of reasoning in the leaf. |
| `engine/src/cli_mcp_config.rs:163-167` | The **pre-write sweep**: scrub a stale config from a previous, possibly app-killed run *before* writing the new one. Belt-and-suspenders for exactly the failure mode §7.B measures in the fleet lanes. |
| `engine/src/cli_mcp_config.rs:129-135` | A **refusal, written down with its date**: `project_root` is deliberately not used to merge a user repo's `.claude/settings.json`, because *"that would spawn an arbitrary `command` sourced from an untrusted repo with no consent or allowlist"*. A documented non-feature is a control. |
| `core/src/crypto.rs:783-798` + `:808-846` | Permissions **before** visibility, atomic `persist`, and `Err` — not a warning — when the ACL cannot be set: *"the caller must not leave the key file world-readable."* The `#[cfg(not(any(windows, unix)))]` arm **refuses to store the key at all** rather than storing it unprotected. |
| `src/engine/credential_broker.rs:40-46` | A TTL constant whose doc comment argues for itself: *"'Short-lived' is a security property, not a suggestion; the mint path clamps, never trusts."* Plus a floor so a mistyped `0` does not mint a dead handle. |
| `src/engine/runner/env.rs:61-78` | A denylist that documents **why each entry is there** and adds *prefix families* because npm maps `npm_config_node_options` back onto a blocked exact name. The reasoning is the transferable part. |
| `src/engine/mcp_tools.rs:1778-1798` | `SHELL_METACHARACTERS` — and the comment that corrects the neighbouring code: *"The comment near the `cmd /C` call site claims the separated-argv form 'prevents metacharacter interpretation by cmd.exe'. That is false as stated."* `%` is on the list because `cmd.exe` expands `%VAR%` **out of the child's environment, which this app populates with decrypted credentials**. |
| `engine/src/cli_process.rs:26-49` | The invariant, the reason, the date, and one function that enforces it with no opt-out. |

### Two independent implementations

| | census engine (Node `RegExp`) | independent Python walker |
| --- | ---: | ---: |
| `.rs` files walked | 963 | 963 |
| `Command::new` total / non-test | — / 129 | 139 / 129 |
| env populated from a map, **no** `env_clear` | **13 matches / 10 files** | **13 matches / 10 files** |
| `env_clear` present | **2 / 2** | **2 / 2** |

Both exclude `#[cfg(test)]` by **brace-matched range**, not a line threshold. All 15 matches were
opened by hand; agreement is reported, not relied on.

### The live registry and the on-disk artefacts

Read-only copy of `personas.db`, 2026-08-16:

| | value |
| --- | ---: |
| `external_api_keys` rows | **1,027** (238 Apr · 318 May · 174 Jun · 174 Jul · 123 Aug) |
| …named `system` | **1,027** — 1,026 revoked, **1 enabled** |
| …with `expires_at` | **0** |
| …with `bound_origin` | **0** |
| …with `last_used_at` | **7** |
| …minted by `mint_derived_handle` (`handle:*`, has label + expiry) | **0** |
| `api_key_audit` rows (what a key actually did) | **1** |
| `persona_credentials` in the vault / distinct service types | **25 / 23** |
| `credential_audit_log` `decrypt` operations | **9,431** |
| `persona_tool_definitions` that are curl-shaped (`Curl:` API tools) | **163 of 170** |
| `fleet_sessions` rows | **0** |

Filesystem, read directly:

| artefact | state |
| --- | --- |
| `%TEMP%\fleet-mcp-*` | **6 directories, 0 removed.** 2 still contain `mcp.json` (206 bytes, mtime 2026-08-09), each holding a **32-character** `X-Athena-Session` header value. 4 are empty — the file was removed, the directory was not. |
| `%TEMP%\personas-workspace` | **absent.** The last persona execution on this install is dated 2026-06-26, so no live sidecar config was available to inspect; the scrub is asserted from code, not observed. |
| `~/.claude/mcp.json`, `~/.cursor/mcp.json` | **absent** — `mcp_server/install.rs` has never run here. Its defect (§7.D) is unexercised, not absent. |
| `%APPDATA%\com.personas.desktop\{master.key, personas.db}` | ACL `DOLLARSTORE\mkdol:(F)`, inheritance removed. |
| a probe file created in `%TEMP%` | inherited `dollarstore\CodexSandboxUsers:(I)(M,DC)` + a second SID, then deleted. |

The tokens in those two stranded files are registered in a `OnceLock<RwLock<TokenRegistry>>`
(`companion/orchestration/mcp/mod.rs:83-97`), so they die with the process — **the exposure is
bounded by app lifetime, and this document does not claim otherwise.** What it claims is that the
mechanism intended to remove them ran to completion **0 times out of 6**.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below reduces to one fact, and it
> is not "someone forgot a strip". **This repo's model of a child process's environment is the
> parent's environment plus a delta.** That model is why a startup `set_var` reaches 127 spawn
> sites nobody audited; why 12 sites run a removal list that reads like a policy and is a list of
> five names; why two denylists exist and disagree; and why the two sites that got it right are
> in the one module whose author was thinking about credential *leakage* rather than credential
> *delivery*. The fix that closes the most entries below is not another strip — it is
> `.env_clear().envs(…)` inside the shared spawner.

### 7.A P0 — the system key is in the process environment, and 127 spawn sites hand it over

| Path | What's wrong |
| --- | --- |
| `src/lib.rs:1744` | `std::env::set_var("PERSONAS_API_KEY", &key)` at startup. |
| `src/engine/management_api.rs:591-597` | The key is minted with `expires_at = None`, `bound_origin = None`, scopes `["personas:read","personas:execute","proxy"]`. |
| `src/engine/management_api.rs:349-376` | `proxy` authorizes `POST /api/proxy/<any credential_id>` **and** is the only scope accepted at `POST /api/broker/mint/<id>`. |
| — | **0 sites in 963 files remove it from any child.** |

The comment at `lib.rs:1740-1744` explains the intent honestly: the split engine's in-process
connector tools need the bridge env. **That is an in-process need served by a process-global
mechanism**, and the mechanism has a second, unstated consumer — every subprocess.

**Fix, in order of value.** (1) Replace the `set_var` with a module-scoped `OnceLock<String>` in
`management_api`, read by the two in-process call sites (`mcp_server/tools.rs:675`, `:1467` are
the *sidecar's* reads and are already served by the `--mcp-config` env block, so they are not
affected). (2) Until that lands, add `PERSONAS_API_KEY` and `PERSONAS_BRIDGE_URL` to
`CLI_SUBSCRIPTION_RESERVED_ENV`'s sibling — a new `CHILD_RESERVED_ENV` — and strip it in
`spawn_headless_claude`, `spawn_mcp_process`, `desktop_bridges`, `tool_runner` and the fleet lanes.
(3) Give the sidecar a **derived handle** instead of the system key: `install_mcp_sidecar` already
takes `api_key: Option<&str>`, so this is a one-line change at `runner/mod.rs:1162` from
`get_or_create_system_api_key` to `mint_derived_handle` — except that the sidecar needs several
credentials, which is the real gap (§8.3).

### 7.B P0 — the fleet lanes' credential file is cleaned up by a task, and on this machine it never finished

| Path | What's wrong |
| --- | --- |
| `src/commands/fleet/pty.rs:555-585` | Writes `%TEMP%/fleet-mcp-<session>/mcp.json` containing an `X-Athena-Session` header token. No mode, no ACL, no guard. |
| `src/commands/fleet/pty.rs:513-528` | Deletion lives inside the **reaper** `spawn_blocking` closure, after `reaper_loop` returns. |
| `src/commands/fleet/headless.rs:251-262` | The identical block, hand-copied. |

**Measured: 6 directories created, 0 removed, 2 still holding the token 7 days later, and 0 rows
left in `fleet_sessions`.** The comment at `pty.rs:515-519` states the design — *"These all need
to happen exactly once per session — coupling them to the reaper exit is simpler than coordinating
across the registry mark-exited path"* — and it is right about "exactly once" and wrong about
"every time".

**Fix.** Return a guard from `build_mcp_spawn` instead of a bare `McpSpawn { config_path }`, with
`Drop` calling `release_session_tokens` + `remove_dir_all`. That also deletes the duplicate block
in `headless.rs`. The pattern is already in this repo at `cli_mcp_config.rs:338`.

### 7.C P0 — four secret-file writers, zero permission hardening, and the hardener is private

| writer | secret | cleanup | permissions |
| --- | --- | --- | --- |
| `engine/src/cli_mcp_config.rs:263` | plaintext `PERSONAS_API_KEY` + `PERSONAS_DELEGATE_API_KEY` | **`SidecarScrubGuard` (Drop)** ✔ | **none** |
| `src/commands/fleet/pty.rs:587` | 32-char MCP session token | reaper task ✘ | **none** |
| `src/browser_bridge/mod.rs:204` | browser-session token | `NamedTempFile` (Drop) ✔ | **none on Windows, and not fixable through the crate** — see below |
| `src/mcp_server/install.rs:78` (env block) / `:110` (write) | a **permanent** `pk_` capability token, into `~/.claude/mcp.json` | **never deleted** ✘ | **none** |

**`NamedTempFile` is not a permission control on Windows, and this is worth knowing before
reaching for it.** Read from the locked crate source (`tempfile 3.26.0`, per `Cargo.lock:8389`,
in the vendored registry copy — not from memory): the Unix arm defaults the mode to `0o600`
(`src/file/imp/unix.rs:22`), but the Windows arm opens with
`create_new(true).read(true).write(true).custom_flags(FILE_ATTRIBUTE_TEMPORARY)` and **no security
descriptor** (`src/file/imp/windows.rs:35-39`), so the file takes the directory's default DACL —
`%TEMP%`'s, with its inherited group ACE. Worse, that same function **returns
`not_supported("changing permissions is not supported on this platform")`** if you ask it for
permissions (`windows.rs:31-33`). So on the app's primary platform a `NamedTempFile` cannot be
hardened by the crate at all; it must be hardened afterwards, before the content is visible —
which is exactly the dance `crypto.rs:783-798` performs and the only reason that site is correct.

`core/src/crypto.rs:794` and `db/src/lib.rs:1604` both do this correctly and both are private
`fn`s in their own module (`crypto.rs:808`, `db/src/lib.rs:1618`). **Zero callers outside those
modules exist, in either case.**

**Fix.** Promote one of them: `personas_core::crypto::write_secret_file(path, bytes) -> Result<SecretFileGuard>`
that does the atomic-write + harden + `Drop`-remove in one call, and route all four writers
through it. That is the type change §9's "Type over gate" names.

### 7.D P1 — `mcp_server/install.rs` writes a never-expiring token into a user-config file it never removes

`install.rs:61-67` calls `external_api_keys::create(…, None /* expires_at */, None /* bound_origin */, …)`
and writes the plaintext into `~/.claude/mcp.json` or `~/.cursor/mcp.json` under an `env` block
(`:78`), via `std::fs::write` at `:110` with default permissions. There is no uninstall path and
no expiry. The module doc (`:1-7`) claims the token is *"never logged, never persisted
elsewhere"* — true, and it omits that where it *is* persisted is an unhardened, never-cleaned
config file that other tools also read.

**Not observed live** — neither file exists on this machine. Reported as a code defect, not a live
leak.

### 7.E P1 — two env denylists guard the same boundary and neither is a superset

| | `src/engine/runner/env.rs:25-78` | `engine/src/desktop_bridges.rs:336-380` |
| --- | ---: | ---: |
| exact names | **30** | **38** |
| prefix families | **6** (`NPM_CONFIG_`, `UV_`, `BUN_`, `DENO_`, `PIP_`, `CARGO_`) | **0** |
| intersection | **15** | |
| only in this one | **15** — `SHELL`, `USER`, `LOGNAME`, `SYSTEMROOT`, `COMSPEC`, `WINDIR`, `TEMP`, `TMP`, `NODE_PATH`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`, `JAVA_OPTIONS`, `DOTNET_STARTUP_HOOKS`, `ZDOTDIR` | **23** — `LD_AUDIT`, `LD_DEBUG*`, `LD_PROFILE`, `LD_DYNAMIC_WEAK`, `LD_ORIGIN_PATH`, `LD_SHOW_AUXV`, `LD_USE_LOAD_BIAS`, `DYLD_FRAMEWORK_PATH`, `DYLD_FALLBACK_*`, `DYLD_IMAGE_SUFFIX`, `DYLD_FORCE_FLAT_NAMESPACE`, `DYLD_PRINT_LIBRARIES`, `USERPROFILE`, `XDG_*` (6), `IFS`, `CDPATH` |

So the remote terminal bridge accepts `NPM_CONFIG_NODE_OPTIONS` (a documented re-arm of a name the
other list blocks) and the persona-execution path accepts `IFS` and `XDG_CONFIG_HOME`. **Neither
list can express this leaf's actual problem**, which is not a hostile *name* the caller supplies
but a credential *value* the child inherits.

**Fix.** One `personas_core::child_env` module exporting the union plus the prefix families, with
the two call sites reduced to imports — and, separately, `.env_clear()`, which makes both lists
almost redundant.

### 7.F P1 — decrypted credentials are interpolated into `curl`'s argument vector

```rust
// src/engine/tool_runner.rs:625-655 (invoke_api) and :1069-1094 (execute_test_curl)
let resolved_tokens: Vec<String> = raw_tokens[1..]
    .iter()
    .map(|token| resolve_placeholders(token, env_map, input_val.as_ref()))
    .collect();
…
for token in &resolved_tokens { cmd.arg(token); }
for (k, v) in env_map { cmd.env(k, v); }        // ← the SAME values, in the env
```

`resolve_placeholders` (`:725-757`) substitutes `${VAR}` and `$VAR` from the decrypted credential
map into each token. **163 of 170 tool definitions in the live database are curl-shaped**, so this
is the shape of 96% of the tool catalog. Both sites also set the identical values in the child's
environment two lines later — **so the argv copy buys nothing and costs the exposure**, since
`/proc/<pid>/cmdline` is world-readable and `/proc/<pid>/environ` is not.

Everything else about this code is careful: no shell, per-token substitution so metacharacters are
inert, `--proto =https,http` injected, a blocked-flag list (`-o`, `-K`, `-T`, `--proto`), and user
input `$`-escaped before credential substitution so a user value cannot trigger secondary
expansion. **The one remaining hole is the transport, and the fix is `--config -` on stdin** —
the technique `brainiac/scripts/first-boot.sh:109-123` uses, with its rationale written down.

### 7.G P1 — 13 spawns add to the child's environment; 2 construct it

`engine/src/cli_process.rs:330` (`spawn_headless_claude`, **9 callers**) · `:579`
(`CliProcessDriver::spawn`) · `engine/src/desktop_bridges.rs:488` · `src/commands/artist/mod.rs:676`
· `src/commands/credentials/ai_artifact_flow.rs:455` ·
`src/commands/design/n8n_transform/cli_runner.rs:698` ·
`src/commands/infrastructure/standards_scan.rs:225` ·
`src/commands/obsidian_brain/revitalize.rs:249` · `src/companion/athena_reaction.rs:559` ·
`src/engine/mcp_tools.rs:2076` · `src/engine/tool_runner.rs:526`, `:634`, `:1088`.

Against `src/commands/credentials/auth_detect.rs:424` and
`src/commands/credentials/cli_capture.rs:627`.

**The highest-leverage single edit in this document is `cli_process.rs:330`**, because
`spawn_headless_claude` already folds in one unconditional guarantee that no caller may opt out of
(`force_subscription_auth` at `:359`) and has **9 callers**. Adding `.env_clear().envs(child_env())`
there is the same move, at the same place, for the larger secret.

### 7.H P2 — 114 spawns never consider the child's environment at all

They are invisible to §9's rule by design, and they are the majority of the exposure: 30 `git`
invocations, 9 third-party cloud CLIs, `ffmpeg`, `blender`, `bun`, `cargo`, `rg`, `npx`, and 12
shell vehicles. `git` is the sharpest case — it is spawned inside user-designated repositories,
where `.git/config` and hooks are content the app did not author, and it passes its environment to
everything it starts.

**This is a backlog of named fixes, not a ratchet**, because a rule at 114 would fire on every
correct `Command::new` in the tree. The correct instrument is §9's type change: a
`spawn_child(program) -> Command` factory that has already called `.env_clear()`.

### 7.I What this path CLEARED

Four things the brief or the obvious reading predicts, which the measurement refutes:

- **"The MCP sidecar config leaks the key between runs."** No — `SidecarScrubGuard` (`Drop`) plus
  an explicit pre-finalize scrub (`runner/mod.rs:2967`) plus a pre-write sweep of a stale config
  (`cli_mcp_config.rs:167`) is the most complete cleanup in the tree, and it is the *only* place
  in six repos that reasons about a `Drop` guard firing too late relative to a `git add -A`. **Its
  real defect is that the copy it so carefully removes is redundant with the ambient copy nobody
  removes** — the sidecar would find `PERSONAS_API_KEY` in its inherited environment anyway.
- **"A vault credential could be injected as `ANTHROPIC_API_KEY` and flip the billing account."**
  No — `runner/credentials.rs:904-913` refuses the three reserved names before injection, with a
  test at `:1168-1181` that also asserts the values do not leak under a different name.
- **"`cmd /C` lets a credential be exfiltrated by naming it `%VAR%`."** Closed 2026-08-15 for the
  MCP command (`mcp_tools.rs:1796` added `%` and `"` to `SHELL_METACHARACTERS` after an executed
  experiment) and 2026-08-16 for URL opening (`629a914af`). The general hazard survives at the 12
  `cmd`/`sh`/`powershell` spawn sites that are not gated by that list.
- **"Nothing zeroizes the decrypted plaintext."** No — `ZeroizingFields`
  (`runner/credentials.rs:37-82`) scrubs on `Drop` *and* on `replace`, deliberately narrowing the
  plaintext lifetime to a single injection, with the reasoning written down.

---

## 8. Gaps in the primitives

### 8.1 The correct secret-file write exists twice and is private both times

`core/src/crypto.rs:808` and `db/src/lib.rs:1618/1640` are `fn`, not `pub fn`. Between them they
implement atomic-write, permissions-before-visibility, `Err`-on-failure, the Unix `0600` arm and
the Windows `icacls /inheritance:r /grant:r` arm — everything §7.C's four writers need. **The
duplication is itself the evidence**: the second author could not reach the first one's, so they
wrote it again, and the two now disagree (crypto's uses `/grant:r`, which *replaces*; db's uses
`/grant` then `/inheritance:r`, ordered that way so a failed grant cannot lock the user out).
Neither is exported. Until one is, every new secret-file writer will be the fifth unhardened one.

### 8.2 `sanitized_env()` is private to a credential-detection module

It lives at `src/commands/credentials/auth_detect.rs:503` as `pub(crate) fn`, in a module about
detecting which CLIs a user is logged into. Nothing about it is specific to that; it is the
repo's child-environment policy. Its allowlist is also **minimal to the point of being unusable
for the Claude lanes** — no `TEMP`/`TMP`, no `PATHEXT`, no `SystemDrive`, no proxy variables — so
a call site that needs more has no incremental path and reverts to inheritance. **The gap is not
the technique; it is that there is one allowlist and it is sized for one caller.**

### 8.3 A derived handle is scoped to *one* credential, and a persona needs several

`mint_derived_handle(pool, credential_id, …)` takes a single `credential_id` and mints
`proxy:credential:<id>` + `cred:<connector>:use`. A persona execution's sidecar may legitimately
need Gmail *and* Calendar *and* Drive. There is no `mint_derived_handle_for(credential_ids: &[…])`,
so the only expressible alternatives are "one credential" or "all of them" — and the code picks
all of them. **This is the concrete reason §7.A's one-line fix is not actually one line, and it is
the highest-value primitive gap in this document.** The scope vocabulary already supports it
(`authorize_credential_use` accepts any number of `proxy:credential:<id>` grants); only the mint
signature does not.

### 8.4 Nothing bounds a grandchild

`--dangerously-skip-permissions` is emitted at **12** argv sites; `--allowedTools` at **2**
(`auto_cred_browser.rs:807`, `:820`). The Claude child's Bash tool's children get its
environment. No type, no allowlist and no census rule can reach a process this app did not
spawn — **the only instrument that reaches a grandchild is what you put in the child's environment
in the first place**, which is why P1 is the head's first clause. The oracle confirms the shape:
3 of 5 siblings have the same unbounded cascade and the only structural answer anyone found was
`brainiac`'s throwaway container that receives its bearer on stdin.

### 8.5 The census cannot see the number that matters

The exposure is *"how many distinct processes can read this token"*, which is a property of a
running process tree, not of source text. §9 counts a proxy for it — spawn sites that construct
versus inherit — and that proxy is blind to the 114 sites that never touch the environment at all
(§7.H) and to every grandchild. **The absence-shaped facts in this document are not gateable**:
"no site removes `PERSONAS_API_KEY`", "no spawn mints a handle", "no secret-file writer sets a
mode". Per the doctrine, the census ratchets things present; those need a different instrument,
specified in §9.

### 8.6 `api_key_audit` records one row, so nothing can answer "who used it"

The table exists, the schema is right (`key_id`, `method`, `path`, `status`, `persona_id`,
`origin`), and it holds **1 row** against 1,027 minted keys and 9,431 credential decryptions.
`last_used_at` is set on 7 of 1,027. If the token in §0 were used by an unexpected child, **there
is no record that would show it.** That is not a defect of this leaf's primitives; it is the reason
this leaf's prevention has to work.

---

## 9. The missing gate

### Where it runs

`npm run census:check` is wired into **two** places: `npm run check` (the local aggregate gate) and
the **`golden-path-census` pre-push job in `lefthook.yml:74-75`**, added 2026-08-16 precisely
because the census "was enforced NOWHERE" before that. So this rule executes on every developer
push, on the machine, before the branch leaves — not only in CI, which per this batch's calibration
is currently red on 10 pre-existing failures and therefore effectively runs nowhere.

### Checked first — the existing 119 census rules

| Rule | Overlaps? |
| --- | --- |
| `unpinned-billing-account-spawn` (5 / 5, `headless-model-call.md`) | **Same anchor family, different middle, and deliberately no second counter.** It keys on the presence of `force_subscription_auth` / `CLI_SUBSCRIPTION_RESERVED_ENV`; this one keys on `env_clear`. Overlap in files: `artist/mod.rs`, `standards_scan.rs`, `revitalize.rs` (3 of its 5, 3 of my 10). Overlap in *condition*: none — a site can strip all three billing vars and still inherit the vault token, and 13 of my 13 do exactly that. |
| `unbound-child-lifetime` (12 / 13, `cancelling-in-flight-work.md`) | Counts a piped child with no `kill_on_drop`. Orthogonal: `auth_detect.rs` is compliant with mine and irrelevant to it; `ffmpeg.rs:950` is the reverse. |
| `shell-vehicle-nonliteral-arg` (5 / 8) | Counts a shell interpreter with a non-literal command slot. Its own description already names the credential-bearing environment as the reason `%VAR%` matters — adjacent, and the two are complements: it guards the *command*, this guards the *environment*. No file overlap with my 10. |
| `settings-key-holding-secret` (1 / 3) · `secret-as-bare-string-field` (10 / 12) | A credential in the settings table; a credential in a bare `String` field. Both are about where a secret *rests*; this is about where it *travels*. Different roots (`src-tauri/db/src`) or different anchors (struct fields). |
| `redirect-portable-credential-header` (9 / 22) · `undiscriminated-credential-rejection` (6 / 17) | Credentials on outbound HTTP. No subprocess involvement. |
| `env-default-conflates-unset-with-empty` (4 / 4) | `??` on an env read, roots `src`/`scripts`, TS/JS only. Different language, different condition. |
| `machine-specific-path-in-tooling`, `unauthenticated-transport-route`, `unkeyed-billable-spawn`, `unaddressable-agent-spawn`, `process-global-caches-a-failure` | Checked; no overlap with any condition here. |

### The semantic conditions, stated stack-free

**C1 — a child's environment is the parent's environment plus a delta, rather than a set the
parent chose.** *Gated below.*

**C2 — a credential is placed in the parent process's own environment.** *Measured, and declined
as a gate — see below.*

**C3 — a credential value is placed in a child's argument vector.** *Measured, declined on
population.*

**C4 — a secret is written to a file for a child with no permission restriction.** *Measured,
declined on precision.*

**C5 — a subprocess is given a broad credential where a narrow one is available.** *Not gateable;
specification below.*

### Conditions deliberately NOT gated, each with the number that decided it

- **C2 (`set_var` of a credential) — declined, and the number is why it is interesting.** There
  are **4** non-test `env::set_var` sites in 963 files (`ORT_DYLIB_PATH`, `PERSONAS_API_KEY`,
  `PERSONAS_BRIDGE_URL`, `RUST_BACKTRACE`) and **exactly 1** sets a credential. A rule with a
  baseline of 1 is a one-shot: it fires once, gets fixed, and must then be deleted rather than
  baselined at 0 (`assertRule` treats a zero-match rule as a structural failure). A `#[test]`
  asserting that `env::set_var` is called with none of a named set of credential keys is the
  better instrument and costs one function. **The finding is that the population is 1, which is
  what makes §7.A a fix rather than a campaign.**
- **C3 (credential in argv) — declined on population, with the fix named.** 2 sites
  (`tool_runner.rs:637`, `:1091`) out of **203** non-test `.arg(`/`.args(` calls, and **0** in
  `scripts/`. 100% precision, population too small to ratchet, and both are one function
  (`resolve_placeholders`) away from a single fix. The convergence result raises this from
  housekeeping to doctrine — `brainiac` violates it 4 times and documents the correct answer twice
  in the same directory — so it lives in §2 and §5, not in the registry.
- **C4 (unhardened secret file) — designed, run, and rejected on precision.** Anchoring on a
  `fs::write`/`write_all`/`persist` whose preceding 1,500 characters bind a credential noun in
  *code* (comment lines stripped) scores **5 matches**, of which **3 are false positives**
  (`data_portability.rs:2184` and `:9658` write *encrypted* export envelopes; `connector_use.rs:1301`
  writes an audio file). **60% precision** — and the two true positives are already named in §7.C.
  The contract forbids a gate that fires on correct content. The right instrument here is the
  **type** (`write_secret_file` returning a guard), not a matcher, because the condition is
  "this write went through the wrong function" and the census cannot see which function a write
  *should* have used.
- **C5 (broad credential where a narrow one exists) — not gateable, and the honest §9 says so.**
  The whole finding is an **absence**: no spawn path calls `mint_derived_handle`; no row carries
  an expiry; no site removes the token. The census ratchets things present. The instrument that
  *would* catch this is a **schema constraint plus a test**: make `expires_at` `NOT NULL` on
  `external_api_keys` for every `name` other than a single allowlisted bootstrap row, and add a
  `#[test]` asserting `get_or_create_system_api_key` has no caller outside `lib.rs` and
  `commands/credentials/external_api_keys.rs`. Both are cheap; neither is a census rule.

### The rule — validated

```json
{
  "rules": [
    {
      "id": "wholesale-inherited-child-env",
      "goldenPath": "docs/concepts/golden-paths/credential-injection-into-child.md",
      "title": "A child process is given env values on top of a wholesale-inherited parent environment",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "Command::new\\s*\\((?:(?!env_clear|Command::new)[\\s\\S]){0,2500}?\\.\\s*env\\s*\\(\\s*&?\\*?(?:k|key|name)\\b",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A child-process spawn region that populates the child's environment from a VARIABLE key (a map/loop binding named k / key / name -- i.e. the author programmatically decided what this child should be told) with NO .env_clear() anywhere between Command::new and that write. PROXY FOR the stack-free condition: a process hands a child a credential the child never asked for, because the child's environment is the parent's environment plus a delta instead of a set the parent chose. Precision 13/13, every match opened. The negative-tempered middle is what makes this a fact rather than a style opinion: the SAME anchor with the middle inverted to REQUIRE env_clear (the positive control) scores 2 matches in 2 files, and the two halves partition the anchor population 15/15 exactly -- so the count measures CONSTRUCTION-vs-INHERITANCE, not 'how many spawns exist' (there are 129 non-test Command::new sites in 963 files; 114 of them never touch the child's env at all and are deliberately invisible here). WHY THIS MATTERS IN THIS REPO: src/lib.rs:1744 calls std::env::set_var(\"PERSONAS_API_KEY\", &key) at startup with a never-expiring, origin-unbound key carrying the broad `proxy` scope, so every one of those children inherits a bearer token that authorizes POST /api/proxy/<any credential id> against all 25 vault credentials and POST /api/broker/mint/<id>. RECALL is deliberately partial: a spawn whose loop binding is named something other than k/key/name reads as compliant, and so does one whose env write lands more than 2500 chars after Command::new. PRECONDITION (must be re-derived per repo): this repo spawns child processes with an OS-inherited environment and puts a credential in the parent's own environment. A repo that spawns with an explicitly constructed env object, or that never mutates its own process env, has the SAME condition wearing different syntax and scores ZERO here -- which is what all five sibling repos audited for this path do (0 env_clear / 0 explicit-env spawns in personas-web, brainiac, personas-cloud, vibeman, ascent; three of them reach for subtraction -- `delete childEnv.X` -- exactly as this repo reaches for env_remove)."
      },
      "exclude": [],
      "baseline": { "files": 10, "matches": 13 },
      "floor": 900
    },
    {
      "id": "wholesale-inherited-child-env-positive-control",
      "goldenPath": "docs/concepts/golden-paths/credential-injection-into-child.md",
      "title": "Positive control — the identical anchor with the child's environment CONSTRUCTED",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "Command::new\\s*\\((?:(?!Command::new)[\\s\\S]){0,2500}?\\.\\s*env_clear\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the COMPLIANT half of wholesale-inherited-child-env: same anchor, same window, middle inverted from 'no env_clear' to 'env_clear present'. Scores 2 matches in 2 files (auth_detect.rs:424, cli_capture.rs:627 -- both then call .envs(sanitized_env()), the repo's only allowlist env builder) against the violating rule's 13/10. It must stay materially non-zero, must not overlap the violating set, and the two together must account for the whole anchor population (15 of 15) -- otherwise the violating rule is measuring 'is this a spawn' rather than 'was this child's environment chosen'. It carries NO baseline by design: a ratchet is monotone-downward and a control counting compliant code would fail the build every time adoption improved."
      },
      "floor": 900
    }
  ]
}
```

### Validation — reproduced, fault-injected, positive-controlled, re-extracted

Run against a private registry with a filename unique to this composer
(`cij-final-rules.json`), never `scripts/census/rules.json`, per the contract's concurrent-writer
warning. **The full registry was not run.**

| Check | Result |
| --- | --- |
| Baseline reproduces | `OK` — 10 files / 13 matches / 963 walked / floor 900 · **exit 0** |
| Runtime | **437 ms** for both rules. No lookbehind; both anchors forward-chained with a bounded, negatively-tempered `{0,2500}` lazy quantifier — no nested quantifier, no backtracking cliff |
| Precision | **13/13** — all opened: `cli_process.rs:330,579`, `desktop_bridges.rs:488`, `artist/mod.rs:676`, `ai_artifact_flow.rs:455`, `n8n_transform/cli_runner.rs:698`, `standards_scan.rs:225`, `revitalize.rs:249`, `athena_reaction.rs:559`, `mcp_tools.rs:2076`, `tool_runner.rs:526,634,1088` |
| **Positive control** | **2 matches / 2 files** (`auth_detect.rs:424`, `cli_capture.rs:627`). 13 + 2 = **15 of 15** — a complete partition of the anchor population |
| Second implementation | an independently-written Python walker: **13/10 and 2/2**, identical, 963 files, 139 total / 129 non-test `Command::new` |
| Fault: baseline `9/12` (a new violation) | `[drift] files rose 9 -> 10 (+1)`, `matches rose 12 -> 13 (+1)` · **exit 1** |
| Fault: baseline `11/14` (a silent drop) | `[drift] files dropped 11 -> 10 (-1) without the baseline moving` · **exit 1** |
| Fault: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` + `zero-matches` + both drift codes · **exit 1** |
| Fault: `extensions` → `.kt` | `[structural] walked 11 files but floor is 900` + `matched zero files anywhere` · **exit 1** |
| Fault: a stale `exclude` entry | `[structural] exclude "…/does_not_exist.rs" matched no file. The exemption is stale` · **exit 1** |
| Fault: the positive control given a `baseline` | `rules[1] … a positive control must NOT carry a baseline` at `validateRule` · **exit 1**, 0 rules scanned |
| **Re-extraction** — rule pulled back out of this document's fenced block and re-run | **identical: 10 files / 13 matches / 2 control matches / exit 0** |

**The positive control is the load-bearing check.** The bare anchor — a `Command::new` region that
programmatically touches the child's environment — is 15. Requiring the *absence* of `env_clear`
gives 13; requiring its *presence* gives 2; 13 + 2 = 15 exactly. A complete partition is stronger
evidence than a ratio: it proves the rule discriminates on **construction versus inheritance**,
not on "is this a spawn".

### How it fails loudly if its own precondition is absent

`floor: 900` against 963 Rust files means a repo whose `roots`/`extensions` no longer describe it
reports **"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"** rather than a clean run — verified by
two independent fault injections. The `zero-matches` structural check means a port to a repo that
constructs child environments (or spawns nothing) fails immediately rather than baselining at 0,
which is the correct outcome: **all five siblings score 0 here and the condition is present in
three of them in different syntax.** `exclude` is empty by design, so there is no
stale-exemption surface.

### The census cannot express "must be zero"

This condition **should** reach zero: there is no spawn in this app that benefits from inheriting
the parent's whole environment. The runner cannot say that — a rule pinned at 0 is a gate that can
never fail — so the sequence is: fix `cli_process.rs:330` first (9 callers behind one edit),
ratchet 13→12→…, and when the last one lands, **delete the rule and this section** and let
`.env_clear()` inside the shared spawner hold the line. That is the type doing the work the gate
was renting.

### Prefer a type over a gate — held against all seven qualifications

Two type changes are proposed. Both were checked against the doctrine's seven qualifications, and
one of them fails a qualification and is proposed anyway, for a stated reason.

**Type 1 — `spawn_child(program) -> Command`, a factory that has already called `.env_clear()`.**
- **Q1** (a required prop carries only what it encodes): it encodes exactly "this child's
  environment starts empty", and nothing more. It does **not** encode which variables the child
  should get; that stays a call-site decision, correctly.
- **Q3** (a type nobody constructs constrains nothing): there are **129** construction sites to
  migrate, of which 9 collapse into one (`spawn_headless_claude`). Not a phantom.
- **Q4** (a type anyone can construct authenticates nothing): `Command::new` remains public in
  `std`, so the factory is a convention unless paired with the ratchet — **which is exactly why
  §9 ships both**, and why the rule is the ratchet rather than the goal.
- **Q5/Q6** (withholding beats requiring; withhold the dangerous freedom, not the answer): the
  dangerous freedom is *inheritance*, and the factory withholds it while leaving the caller the
  answer (`.env(K, v)` for what the child needs). This is the correct half.
- **Verdict: ship it.** One edit at `cli_process.rs:330` covers 9 callers.

**Type 2 — `write_secret_file(path, bytes) -> Result<SecretFileGuard>` in `personas_core::crypto`.**
- **Q5/Q6**: withholds the two dangerous freedoms (writing without hardening, and deleting from
  somewhere other than a `Drop`) while returning the guard the caller must hold — which is the
  answer, not a restriction.
- **Q7** (withholding a requirement is inert when the caller supplies the bad value voluntarily):
  passes — the callers are not supplying a bad value, they are calling a different function
  entirely (`fs::write`), so the fix is to make the right function reachable, not to constrain the
  wrong one.
- **Q2** (requiredness is orthogonal to closedness): making the guard `#[must_use]` is
  requiredness; it does **not** close the possibility of calling `fs::write` directly. §9 does not
  gate that (C4 was declined at 60% precision), so this type ships **without** a ratchet behind it
  and that is a known weakness, stated rather than hidden.
- **Verdict: ship it.** It closes 4 sites permanently and it is the only fix for §7.C that does
  not depend on four authors remembering.

**Type 3, considered and rejected — a `ScopedCredential` newtype that the spawn API demands.**
Fails **Q4**: any caller can construct `ScopedCredential(system_key)` and the compiler is content.
Fails **Q1**: the scope lives in the `external_api_keys` row, not in the Rust value, so the type
would name a property it does not carry — the same error `successRateSource` made with units. The
real instrument for C5 is the **schema** (`expires_at NOT NULL`), named above.

---

## 12. Corrections to the brief

### 12.1 The `CONVERGED` label does not hold as stated — it holds on 2 clauses of 5

The brief warned that four CONVERGED labels have been tested in this campaign and all four failed.
This one is the best result so far and still does not survive intact:

| clause | oracle result | verdict |
| --- | --- | --- |
| **P3** — never put a secret in the parent's own environment | 5/5 do not; **2 of them wrote the invariant down** (`personas-cloud/executor.ts:106-107`, `brainiac/backup-offsite.sh:143-150` subshell export) | **CONVERGED — and Personas is the sole violator in six repos** |
| **P4** — keep secrets out of argv | 3 repos use stdin by design; `brainiac` states the `/proc` rationale twice **and violates it 4 times in the same directory** | **CONVERGED, as doctrine and as defect** |
| **P5** — delete by lifetime, not by task | 1 repo has `trap cleanup EXIT INT TERM` + an `if: always()` CI step; its neighbour 4 files away has no trap | **PARTIAL — one adherent, one counterexample, three silent** |
| **P6** — permissions before visibility | 1 repo sets a mode at all; it gets it right once and wrong once | **PARTIAL — one adherent** |
| **P1** — construct the child's environment, do not inherit and subtract | **0 of 5.** Zero `env_clear` / zero explicit-env spawn in any sibling. Three reach for `delete childEnv.X` | **SILENCE 5/5 — this is an INVENTION, labelled a house convention** |

**So the clause that carries this document's headline is the one with no external warrant at all.**
The oracle's contribution is sharper than a yes/no: three independent teams reinvented the *wrong*
half of P1, which is strong evidence that inheritance-plus-subtraction is the natural failure mode
— but "construct the environment" as a prescription has exactly one adherent in six repos, and
that adherent is this repo, at 2 of its own 129 spawn sites. An adopting repo should treat P1 as
untested and P3/P4 as physics.

### 12.2 `resolve_credentials` is already fully owned by an adjacent path — confirmed, not re-derived

The brief listed `resolve_credentials: fn() -> Result<(String,String)>` as a finding. It is
`connector_strategy.rs:592`, applied at `:453` and `:487`, resolving through
`engine/src/google_oauth.rs:112` → `resolve_env_value` (`:57-63`: compile-time `option_env!` →
runtime env → `.env` file search of `.env`, `../.env`, `../../.env`). **I confirmed all of it by
reading — and [`oauth-connect-flow`](./oauth-connect-flow.md) §8.4 and its "where the type cannot
reach" note already state it exactly**, including the consequence that a credential connected with
a user's own OAuth app can never be refreshed. Composed 2026-08-16, one commit before this one.
**Re-reporting it here would have been a second path on one leaf.** What this path adds is the
mechanical link the other could not see: `resolve_env_value` is the same ambient-environment
channel that `src/lib.rs:1744` writes into, so the *dotenv fallback* means a `.env` file in the
app's working directory can supply OAuth client credentials to a process whose environment every
child inherits. Two paths, one mechanism, and the composition is worth naming.

### 12.3 The live key counts have moved, and the direction is the finding

Brief: **1,021 rows, 1,014 never used.** Measured 2026-08-16 16:21: **1,027 rows, 1,020 with
`last_used_at` NULL.** The drift is not an error in the brief — it is the app minting a fresh
system key on every start, six times since the brief was written. Monthly: 238 (Apr) · 318 (May)
· 174 (Jun) · 174 (Jul) · 123 (Aug). **7 keys in 1,027 have ever recorded a use, and
`api_key_audit` holds 1 row.** The rotation-on-start design is *correct* — old keys are revoked at
`management_api.rs:581-585` — but it means the table is a 1,027-row ledger of a credential nothing
observably consumes through the front door, while the copy that everything consumes goes out
through the environment where nothing counts it.

### 12.4 The brief's framing of the temp-dir write understates one thing and overstates another

- **Understates:** "written plaintext into every persona run's temp dir" is true, and the file's
  ACL is the part that matters. `%TEMP%` on this machine grants Modify to a group containing two
  other user accounts, inherited object-and-container — **proved with a probe file**, not assumed.
  The same directory holds the fleet lanes' session tokens.
- **Overstates:** the sidecar config is the **best-managed** secret file in the tree — RAII guard,
  explicit pre-`git add -A` scrub, pre-write sweep of a stale copy. Its real defect is that the
  copy it removes so carefully is **redundant with the ambient copy nobody removes**: the sidecar
  is a grandchild of the app process and would find `PERSONAS_API_KEY` in its inherited
  environment whether or not the config file named it. The careful control guards the cheap copy.

### 12.5 The brief's `5 of 18` clause holds, is already gated, and is not this leaf's

Verified at `cd9d094d9` by running that one rule alone: `unpinned-billing-account-spawn` is **5
files / 5 matches**, unchanged. The `env_removals` trap is real and exactly as described
(`cli_args.rs:184-199` — five names, none of them auth). **That condition belongs to
[`headless-model-call`](./headless-model-call.md) §7.A and this document adds no second counter
for it.** Its relevance here is as the sharpest available illustration of P1: a loop that *looks*
like an environment policy and contains five names, on a child that inherits several hundred.
