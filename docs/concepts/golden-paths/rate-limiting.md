# Golden path — Rate limiting

> Situation node: `backend-runtime/resilience-policies/rate-limiting` ·
> [situation spine](../situation-spine.md) · recurrence 11 · risk **MEDIUM** ·
> sides: **both** (`twoSided: true`, `fusedAcrossSides: true`) · convergence: **mixed** ·
> dimensions: **resilience · cost · performance · security**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` (the census engine's own walk agrees at
> 963; `shared-facts.json#rust.files` = 963) and all **4,829** `.ts`/`.tsx` under `src/`
> (`shared-facts.json#frontend.tsFiles`, re-verified by the same walk). Read in full:
> `engine/src/rate_limiter.rs`, `engine/src/inflight_guard.rs`, `engine/src/tier.rs`,
> `engine/src/p2p/messaging.rs`, `src/engine/api_proxy.rs`, `src/engine/webhook.rs`,
> `src/engine/management_api.rs`, `src/engine/mcp_tools.rs`, `src/engine/tool_runner.rs`,
> `src/engine/smee_relay.rs`, `src/engine/automation_runner.rs`, `src/notifications.rs`,
> `src/commands/communication/events.rs`, `src/commands/infrastructure/tier_usage.rs`,
> `src/companion/tts/pocket.rs`, `core/src/error.rs`, `core/src/error_taxonomy.rs`,
> `db/src/builtin_connectors.rs` (135 seed rows, parsed as JSON), plus the frontend half:
> `src/stores/slices/pipeline/triggerSlice.ts`, `src/features/triggers/sub_speed_limits/RateLimitDashboard.tsx`,
> `src/features/triggers/sub_triggers/RateLimitControls.tsx`, `src/lib/utils/apiError.ts`,
> `src/api/system/tierUsage.ts`, and the two direct third-party clients in `research-lab/sub_literature/`.
>
> **Two independent implementations of every count**, one importing
> `scripts/census/lib/instruments/`, one bespoke. Every disagreement is recorded where it occurred
> (§12.6). **`cargo` was not run** — every Rust claim is static and traces to a file read during
> composition.
>
> **Row counts are historical.** The 2026-08-17 purge deleted 20,342 rows across 25 tables including
> all 351 triggers, so *"how many triggers have a rate-limit policy today"* is unanswerable against
> the live file and was not asked. Nothing in this document depends on a row count; every claim here
> is about code, and the backup at
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db` was not needed.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It produced §10, and it **inverted** the leaf's
> `convergence: mixed` label on the clause that matters most.
>
> **Settles:** where the window lives, who owns the policy, what a refused caller is handed, what
> happens when somebody else refuses *us*, and which of the app's two rate-limit dashboards is
> showing a measurement.

---

## 0. The headline

**This binary holds four independent rate limiters running four different algorithms on two
different clocks. The only rate-limit policy a user can author is enforced by neither side — its
Rust reader does not exist and its TypeScript enforcer has zero callers — so the tab named *Rate
limits* renders three counters that are structurally always zero. Meanwhile the limiter that does
work computes a retry-after seven times and puts it somewhere a machine can read exactly once.**

### 0.1 — four limiters, four algorithms, two clocks

| # | limiter | algorithm | clock | keyed by | policy source | call sites |
|---|---|---|---|---|---|---|
| 1 | `RateLimiter` (`engine/src/rate_limiter.rs:25`) | sliding window of timestamps | `Instant` | caller-built string | **the caller's arguments** | **7** |
| 2 | `TokenBucket` + `RATE_LIMITERS` (`src/engine/api_proxy.rs:178`, `:247`) | token bucket, continuous refill | `Instant` | `credential_id` | `rate_limit_rpm` in connector metadata, else `DEFAULT_RATE_LIMIT = 60` (`:167`) | 1 (`:777`) |
| 3 | `TEST_DELIVERY_RATE_LIMIT` (`src/notifications.rs:1173`) | minimum interval | `Instant` | `type:credential:config-hash` | `RATE_LIMIT_WINDOW = 1s` (`:1177`) | 1 (`:1219`) |
| 4 | `check_rate_limit` (`engine/src/p2p/messaging.rs:228`) | fixed window + CAS reset | **`SystemTime`** | `peer_id` | `MAX_MESSAGES_PER_SECOND = 10` (`:30`) | 1 (`:146`) |

Three of the four are monotonic. **The fourth is on the wall clock**, and its window test is
`now_ms.saturating_sub(window) >= 1000` (`messaging.rs:251`) — so a backwards clock step saturates
the subtraction to `0`, the window never resets, and the peer stays limited until real time catches
up. (Limiter 4 compiles only under the `p2p` feature.)

Only limiter 1 is shared: one `Arc<RateLimiter>` constructed at `lib.rs:1133` and held on
`AppState.rate_limiter` (`lib.rs:397`). **The answer to "is the limiter per-caller or shared" is
"shared, for the lane that has one, and there are three other lanes each with a private one."**
Limiters 2 and 3 are `LazyLock` module-scope statics — the doctrine's second place a type cannot
reach (`golden-path-doctrine.md` §1, *"through a `OnceLock` or other global"*), and it shows: nothing
can ask either of them what a key's limit is without re-deriving it from the caller's side.

### 0.2 — one limiter, seven call sites, five ways of saying no

`RateLimiter::check(key, max_events, window) -> Result<(), u64>` returns the retry-after as its
`Err`. Here is what each of the seven call sites does with it:

| site | key | limit comes from | the refusal | retry-after reaches |
|---|---|---|---|---|
| `commands/communication/events.rs:74` | `event:{source_type}` | `tier_config.event_source_max` | `Err(AppError::RateLimited(format!(…)))` | an English sentence |
| `commands/communication/events.rs:208` | `event:test` | `tier_config.event_source_max` | same | an English sentence |
| `engine/management_api.rs:459` | `apikey:{id}` | `API_KEY_RATE_MAX = 120` (`:276`) | `Ok(rate_limited_response(retry_after))` | **the `Retry-After` header** ✓ |
| `engine/mcp_tools.rs:784` | `mcp_tool:{cred}:{tool}` | `TOOL_EXECUTION_MAX_PER_MINUTE = 30` | `Err(AppError::RateLimited(format!(…)))` | an English sentence |
| `engine/tool_runner.rs:187` | `tool:{id}` | `TOOL_EXECUTION_MAX_PER_MINUTE = 30` | `Ok(ToolInvocationResult{ error_kind: RateLimited, retryable: true })` | an English sentence |
| `engine/webhook.rs:340` | `webhook:{trigger_id}` | `tier_config.webhook_trigger_max` | HTTP 429 with **`no_headers()`** | the JSON `error` string |
| `engine/smee_relay.rs:526` | `event:smee_relay:{key}` | `tier_config.event_source_max` | `.is_err()` → **`continue`** | **nowhere — the event is dropped** |

**Five distinct refusal shapes for one limiter.** One is silence. One — and only one — puts the
number in a place a program can parse. And the same file that omits the header on its **429**
(`webhook.rs:349`, `no_headers()`) sets one a hundred lines later on its **422** for an
out-of-active-window request (`webhook.rs:438-441`). The branch that most needs `Retry-After` is
the branch that lacks it, in the file that demonstrably knows how.

The limiter also **does not own the policy**: `max_events` and `window` are parameters of every
`check` call, stored nowhere. Four different sources supply `max_events` across the seven sites, and
all four windows happen to be 60 s. That is why §7.C's dashboard has to *guess* a bucket's limit
from a prefix of its key — there is nothing to ask.

### 0.3 — the policy the user can author is enforced by nobody

`RateLimitControls` (`src/features/triggers/sub_triggers/RateLimitControls.tsx`) is a shipped,
user-reachable form — `TriggerListItem` → `TriggerDetailDrawer.tsx:45` — that writes
`{ max_per_window, window_seconds, max_concurrent, cooldown_seconds }` into a trigger's `config`
JSON (`src/lib/utils/platform/triggerConstants.ts:381-396`).

- **Rust readers: zero.** `"rate_limit"` as a config key appears nowhere in 963 `.rs` files; the only
  hits are `FailureCategory::RateLimit => "rate_limit"` mappings. `core/src/models/trigger.rs` — the
  single file that parses every trigger config into `TriggerConfig` — contains no `rate`, `throttl`,
  `cooldown` or `concurren` identifier at all.
- **TypeScript enforcer: zero callers.** `recordTriggerFiring` (`triggerSlice.ts:198`) is a complete,
  carefully-commented, twice-bugfixed client-side sliding-window limiter. Nothing calls it. Nor
  `recordTriggerComplete` (`:257`).

So `triggerRateLimits` is permanently `{}`, and `RateLimitDashboard`
(`src/features/triggers/sub_speed_limits/RateLimitDashboard.tsx`, rendered at
`TriggersPage.tsx:151` for the `rate-limits` tab) derives `totalQueued`, `totalConcurrent` and
`throttledCount` from that map. All three are structurally zero; the throttle bar
(`RateLimitDashboard.tsx:128-131`) is `throttledCount / rateLimitedCount`, structurally 0 %. The
single number on that surface that is not zero is `rateLimitedCount` — a count of triggers whose
*config* carries a limit. **The tab reports configuration and calls it throttling.**

### 0.4 — the outbound half: nothing in this tree reads a `Retry-After`

Every rate limit this app *receives* is somebody else's. Measured across both languages:

- **`Retry-After` is written twice and read zero times.** The only `RETRY_AFTER` / `"retry-after"`
  writes are `management_api.rs:548` and `webhook.rs:440`. No response header is ever parsed for it.
  The tree is not incapable of reading response headers — `resource_listing.rs:477` reads `link` for
  pagination.
- **The Claude CLI hands us one in structured JSON and the parser throws it away.**
  `build_session/parser.rs:86` matches `"system" | "rate_limit_event" => return vec![]`, and its own
  regression test at `:542` uses the fixture `{"type":"rate_limit_event","retry_after":30}`. The
  number is in the test and discarded by the code.
- **Jitter: zero.** No `rand`, `thread_rng` or `jitter` appears anywhere near a retry or sleep in
  `src-tauri/{src,engine,core}`; every `jitter` hit in `src/` is visual layout or a competition
  simulator. This independently re-derives
  [`retry-with-backoff`](./retry-with-backoff.md)'s headline on a different sweep.
- **`automation_runner.rs:356-364` names the gap in a code comment**: 429 was added to the retryable
  set on 2026-08-16, with the note that *"the connector docs shipped to agents already claim '429
  responses include a Retry-After header you must honor', while nothing in this tree reads that
  header."* That comment is correct and still correct.

### 0.5 — 135 connectors, one rate limit

`parse_rate_limit_from_metadata` (`api_proxy.rs:251`) reads `rate_limit_rpm` out of a connector's
metadata JSON. **The string `rate_limit_rpm` occurs exactly twice in the whole tree — lines 250 and
254 of `api_proxy.rs`, i.e. the reader and its docstring.** Zero of the **135** `BuiltinConnector`
seed rows declare it, so `.unwrap_or(DEFAULT_RATE_LIMIT)` fires for every credential and every
connector gets the same 60 requests/minute bucket.

Meanwhile **9 of those 135 seeds state a real rate limit in the `llm_usage_hint` prose shipped to
the model** (7 name the concept, 7 state a numeric rate, 5 do both). arXiv's reads *"Rate limit: max
1 request per 3 seconds. arXiv will block IPs that exceed this."* That is 20/minute. The proxy will
let an agent through at 60. **The real limit is written down for a language model to read and not
for the limiter to read.**

---

## Principle (stack-free head)

A rate limit is a **policy object**, not a number at a call site. It has four parts and all four
must be nameable in one place: the **key** (whose budget is this), the **window**, the **budget**,
and the **refusal**. Write them together, keyed by something the caller cannot forge, and make the
refusal carry the one datum the caller needs to obey it — *when to come back* — in a field, not in
a sentence.

Then decide the symmetric question before you ship: **what do you do when somebody rate-limits
you?** The answers are not independent. A system that refuses politely and retries blindly has
solved half a problem and made the other half worse, because the fleet it protects is the fleet
that hammers everyone else.

Five clauses, in dependency order:

1. **One limiter per process, not one per module.** Concurrent callers must share the window or it
   is not a limit; N private limiters are N budgets. If a subsystem cannot reach the shared one, that
   is a wiring problem, not a reason to declare a second static.
2. **The clock must be monotonic.** A window measured on the wall clock is a window the user can
   move by changing the time zone.
3. **The policy belongs to the limiter, not the caller.** If `check(key, max, window)` takes the
   budget as an argument, nothing can answer *"what is this key's limit?"* — which is exactly what
   every dashboard, every error message and every operator needs.
4. **The refusal is a classification carrying a retry-after, and the retry-after is a number.** Not
   a formatted string, not an inference from a key prefix. A caller that must regex your English to
   back off correctly will not back off correctly.
5. **Read the other side's answer.** `Retry-After` exists precisely so you do not have to guess.
   Read it, clamp it, jitter around it. Where the remote is documented rather than observed, put its
   documented rate in a **machine-readable field beside the documentation**, or the documentation is
   the only thing that knows.

---

## 1. Trigger

You are in this situation when you catch yourself saying or typing any of:

- *"we should stop personas hammering this endpoint"* / *"this connector keeps 429ing"*
- *"how many events a minute is too many for a webhook trigger?"*
- *"let me add a `static LAST_CALL: LazyLock<Mutex<HashMap<String, Instant>>>`"* — **stop; that is
  limiter number five**
- *"the API returned 429, retry in a bit"* — and the *bit* is about to be a literal
- *"the user should be able to configure the throttle"* — before checking whether anything reads it
- **the "if you are about to write X" test:** if you are about to write a `HashMap<String, Instant>`,
  a `.elapsed() < SOME_DURATION` comparison, a `sleep(Duration::from_secs(N))` after a failed HTTP
  call, or a `max_per_*` field on a config struct, you are here.

You are **not** here if the question is *"is there room for this work right now"* — that is
[`admission-control`](./admission-control.md), which owns capacity, queueing and the
`AdmitResult` classification. This leaf owns **frequency over a window**. The two leaves currently
share one error variant and §7.G is the cost of that.

## 2. The one way

Reach for the process's one `RateLimiter` through `AppState.rate_limiter`, build the key from
server-assigned identifiers only, and return a refusal that carries the retry-after as a number.
Concretely: (a) **do not declare a limiter** — `state.rate_limiter` already exists, is `Arc`-shared
across every concurrent caller, prunes itself, and warns once per rejection streak rather than once
per rejection; a new `LazyLock<Mutex<HashMap<..>>>` is a second budget for the same resource and
nothing will ever reconcile them. (b) **Build the key from values the server assigned** — the
credential id, the trigger id, the API-key row id — never from a caller-supplied name;
`mcp_tools.rs:781-789` is the exemplar and its comment records the attack it closes (a
caller-influenced `<member>::` prefix minted a fresh bucket per prefix). (c) **Name the budget and
the window as constants beside each other**, the way `TOOL_EXECUTION_MAX_PER_MINUTE` and
`TOOL_EXECUTION_WINDOW` sit together at `rate_limiter.rs:172-175`; a tier-derived budget is fine, an
integer literal at the `check(` call is not. (d) **Refuse with a classification, not prose** —
today that is `AppError::RateLimited`, and today it can only hold a `String`, so until §9's type
change lands you must *also* put the seconds somewhere structured: an HTTP `Retry-After` header if
you are on a transport that has one (`management_api.rs:544-549` is the only correct instance),
otherwise a typed field on your own result (`ToolInvocationResult` already carries `retryable`, and
wants `retry_after_secs` beside it). (e) **Never `continue`** — a dropped request with no record is
indistinguishable from a request that never arrived; `smee_relay.rs:526-540` at least logs, which is
the floor, not the goal. (f) On the **outbound** side, read `Retry-After` before you invent a delay,
clamp it, add jitter, and if the remote's limit is documented rather than observed, write it into
`rate_limit_rpm` on the connector so the proxy's bucket is sized from the same fact the docs state.
(g) **Do not build an authoring surface until the reader exists** — write the enforcement first, the
form second; §7.A is what the other order produces.

## 3. Mandated primitives

| primitive | what it gives you |
|---|---|
| **`AppState.rate_limiter: Arc<RateLimiter>`** (`src/lib.rs:397`, built `:1133`) | The one shared sliding window. Per-key `Vec<Instant>`, automatic prune every 100 `check` calls (`rate_limiter.rs:95-127`), poison-recovering lock, and a **warn latch** that signals the *crossing* rather than the level (`:78-88`) — a caller hammering a limit produces one log line per streak, not per request. |
| **`RateLimiter::check(key, max_events, window)`** (`rate_limiter.rs:50`) | `Ok(())` or `Err(retry_after_secs)`, computed from the oldest in-window timestamp. **Rejected requests are not recorded** (the `return Err` at `:89` precedes the `push` at `:93`) — this is the self-perpetuation bug `ascent` had to fix in its own limiter and this one never had. |
| **`EVENT_SOURCE_WINDOW` / `WEBHOOK_TRIGGER_WINDOW` / `TOOL_EXECUTION_WINDOW` / `TOOL_EXECUTION_MAX_PER_MINUTE`** (`rate_limiter.rs:166-175`) | The named windows and the one named budget. Use these; do not pass `Duration::from_secs(60)` inline. |
| **`TierConfig`** (`engine/src/tier.rs:8`) | `event_source_max`, `webhook_trigger_max`, `max_queue_depth` per plan. The tier-derived budget source. Read it through `state.tier_config`, not by re-deriving from a plan string. |
| **`InflightGuard` / `InflightGuard::guard`** (`engine/src/inflight_guard.rs:69`) | **The primitive you want when the answer is "one at a time", not "N per minute".** RAII, releases on every early return. Its own module docstring names the boundary: *"where the rate limiter caps frequency over a window, this guard enforces that at most one operation per key is in flight."* Reach for this instead of a rate limit whenever the real constraint is exclusivity. |
| **`api_proxy::check_rate_limit`** (`src/engine/api_proxy.rs:274`) | The per-credential outbound bucket. Already called by `execute_api_request` (`:777`) — you get it for free by routing an outbound connector call through the proxy instead of `reqwest`. |
| **`management_api::rate_limited_response`** (`src/engine/management_api.rs:544`) | The only correct HTTP refusal in the tree: 429 + `Retry-After`. Copy it. |

**Explicitly not primitives.** `getTierUsage()` (`src/api/system/tierUsage.ts:8`) has zero call
sites and its `limit` field is inferred from a key prefix (§7.C). `recordTriggerFiring`
(`triggerSlice.ts:198`) has zero call sites (§7.A) — do not wire it as-is; it is a *client-side*
limiter for a server-side event, and the fix is on the server. `LoadingSpinner`-style: a thing being
present and documented is not the same as it working.

## 4. Steps

1. **Decide which of the two questions you are asking.** *How often* → this leaf. *Is there room
   right now* → `admission-control`'s `AdmitResult`. *One at a time* → `InflightGuard`. Getting this
   wrong is how `AppError::RateLimited` came to name three things (§7.G).
2. **Write the four parts down together before any code**: key, window, budget, refusal. If you
   cannot say what the key is in one noun phrase, you do not yet know whose budget you are spending.
3. **Derive the key from server-assigned identifiers.** Then ask the adversarial question out loud:
   *can the caller change any component of this key?* If yes, they can mint a fresh bucket.
4. **Name the budget and the window as `const`s next to each other**, or read the budget from
   `TierConfig`. Never inline.
5. **Call `state.rate_limiter.check(...)` before anything that persists or spends.** A refusal must
   be a no-op on the world; this is the same ordering rule `admission-control` §4.5 states for
   capacity, and it is the same rule for the same reason.
6. **Turn the `Err(u64)` into a classification with the number intact.** On HTTP: 429 +
   `Retry-After`. On IPC: `AppError::RateLimited` today, and add the seconds to your own typed result
   until §9's variant change lands. **And then stop** — the limiter has already logged the crossing;
   do not add a second `warn!` per rejection, that is the bug `rate_limiter.rs:73-77` was written to
   fix.
7. **On the outbound side, before you write a delay**: read `Retry-After`; if absent, exponential
   from a named base; either way multiply by a jitter factor. See
   [`retry-with-backoff`](./retry-with-backoff.md) §2 for the three numbers that must be named.
8. **If the remote's limit is known, encode it.** For a connector that means `rate_limit_rpm` in the
   seed's metadata JSON — the same object whose `gotchas` array already states the limit in English.

## 5. Anti-patterns

| the wrong move | the failure it produces |
|---|---|
| **A new `LazyLock<Mutex<HashMap<String, Instant>>>`** | A second budget for the same resource. This tree has four limiters; nothing can compute the total spend of a persona across them, and only one of them appears on any surface. |
| **A rate-limit window on `SystemTime`** | The window is user-adjustable. `messaging.rs:229` measures a 1-second peer budget on the wall clock; a backwards step saturates `now_ms.saturating_sub(window)` to 0 and the peer is limited until real time catches up. |
| **`check(key, max, window)` with the policy as arguments** | Nothing can answer *"what is this key's limit?"*. The tier-usage dashboard has to infer it from `key.starts_with("webhook:")` and gets 3 of 7 key families wrong (§7.C). |
| **A retry-after interpolated into a message** | The consumer must regex your English. **8 of 12 `AppError::RateLimited` construction sites are `format!`; 0 of 12 carry a structured retry-after; the one frontend consumer hardcodes 5000 ms** (`apiError.ts:112`) rather than parse it. |
| **`.is_err()` on a limiter check** | The retry-after is discarded at the point it is produced. `smee_relay.rs:526` then `continue`s, so an over-limit event is gone with no dead-letter row and no counter. |
| **429 without `Retry-After`** | You have told the caller to come back and refused to say when, so they will poll. `webhook.rs:349` does this on its 429 while `:438` does it correctly on its 422, in the same function chain. |
| **Mapping a 429 onto a validation error** | `pocket.rs:473` turns the TTS sidecar's 429 into `AppError::Validation` → `ErrorCategory::Validation` → severity **Low**, `is_failover_eligible` **false**. And the message it mints (*"is at capacity (queue full)"*) contains none of the five strings `classify_error` looks for, so the string ladder cannot recover the classification either. Backpressure is reported as the user's mistake. |
| **Using `RateLimited` for "already running"** | The tag stops meaning frequency. 6 of 12 constructions are mutual exclusion, and the frontend receives `category: "rate_limit"`, `auto_fixable: true`, `failover_eligible: true` for a duplicate button press. |
| **`usize::MAX` as "unlimited"** | `TierConfig::enterprise` (`tier.rs:41`) sets it, so `check` never rejects — but the bucket still pushes every admitted timestamp and `retain`s over the whole 60-second window on **every** call. Unbounded-in-rate work hidden behind a sentinel. |
| **Building the authoring surface first** | You ship a form, a store slice, a dashboard tab and 14 locales of copy for a policy nothing enforces. §7.A. |
| **Documenting the remote's limit only in prose** | 9 of 135 connector seeds state a real rate limit in the text shipped to the model; 0 state it in the field the limiter reads. |

## 6. Evidence

**The one site to copy: `src/engine/management_api.rs:459-470` together with `:544-549`.** It is the
only refusal in the tree that is complete: a named budget and window (`API_KEY_RATE_MAX`,
`API_KEY_RATE_WINDOW`, `:276-277`), a key built from a server-assigned row id (`apikey:{key.id}`), a
`tracing::warn!` carrying the retry-after as a field, an **audit row recording the 429**, and a
response that puts the seconds in `header::RETRY_AFTER` where a client can obey them.

| site | what it is exemplary for |
|---|---|
| `engine/src/rate_limiter.rs:50-130` | The limiter itself. Rejections are not recorded (`:89` before `:93`) — the self-perpetuation trap `ascent/src/lib/rate-limit.ts` documents having shipped and fixed. Auto-prune amortised into `check` under the lock already held (`:96-127`). The warn latch (`:73-88`) signals the crossing, resets on admission, and has two regression tests pinning both halves. |
| `src/engine/mcp_tools.rs:775-789` | **Key derivation done adversarially.** Eight lines of comment explaining why the key is `credential_id` and not the caller-influenced `tool_name`, and why gateway recursion still lands in the same bucket. This is the reasoning every keyed limiter needs and the only place in the tree that wrote it down. |
| `engine/src/inflight_guard.rs:1-12, :56-80` | The right primitive for exclusivity, with a docstring that names its own boundary against the rate limiter. RAII means the key releases on `?` early-returns. |
| `src/engine/api_proxy.rs:186-217, :235-244, :286-296` | A token bucket with three separate memory bounds: idle sweep at 600 s, sweep throttled to once per 60 s, and a hard LRU eviction at `MAX_BUCKET_ENTRIES = 1024`. Capacity changes are applied to a live bucket without resetting its tokens (`:303-310`). |
| `src/engine/automation_runner.rs:352-365` | A retryable-set decision with its evidence in the comment: which sibling repos include 429, and the fact that the docs promise something the code does not do. **A correct fix that names its own remaining gap is worth more than a silent one.** |
| `src/stores/slices/pipeline/triggerSlice.ts:90-106, :198-255` | The best-reasoned limiter in the repo — `computeThrottled` derives status purely from live signals, and two commented bugfixes (a sticky `isThrottled`, a `queueDepth` that leaked) are pinned in prose. It has zero callers, which is §7.A, and it is still the shape to port **to the server**. |

## 7. Deviations

### 7.A — The only user-authorable rate-limit policy is read by nothing, on either side (P1)

`RateLimitControls.tsx` persists `rate_limit: { max_per_window, window_seconds, max_concurrent,
cooldown_seconds }` into a trigger's `config`. Two independent checks agree that nothing reads it:

1. `"rate_limit"` as a JSON key appears in **zero** of 963 `.rs` files (the only `rate_limit` string
   literals are `FailureCategory` display mappings and `api_proxy`'s `rate_limit_rpm`).
2. `core/src/models/trigger.rs`, the sole parser of trigger config into `TriggerConfig`, contains no
   `rate` / `throttl` / `cooldown` / `concurren` identifier anywhere in the file.

And the client-side enforcer that *would* have consumed it, `recordTriggerFiring`
(`triggerSlice.ts:198`), has **zero call sites** in 4,829 files — as does its partner
`recordTriggerComplete`.

**Fix:** delete the client-side limiter or wire the server one. The policy is meaningful and the
server already has the machinery: a `webhook:{trigger_id}` bucket already exists at
`webhook.rs:340`, and `schedule_hourly_cap_exceeded` (`background.rs:1944`) already enforces a
per-persona hourly ceiling. Reading `cfg.rate_limit` in `TriggerConfig` and passing it to
`state.rate_limiter.check` is the smaller half of this; the larger half is deciding whether a
throttled scheduled fire is *dropped* or *deferred*, which is `admission-control`'s question.
**Not applied** — this changes what a live surface does.

### 7.B — The tab named "Rate limits" shows three counters that are structurally zero (P1)

`RateLimitDashboard` reads `usePipelineStore(s => s.triggerRateLimits)`. That map's only writer is
`recordTriggerFiring`, which per 7.A is never called. Therefore, for every trigger:

| what it renders | source | value it can ever have |
|---|---|---|
| `{stats.totalConcurrent} running` (`:96`) | `state.concurrentCount` | **0** |
| `{stats.totalQueued} queued` (`:105`) | `state.queueDepth` | **0** |
| `{stats.throttledCount} throttled` (`:114`) | `state.isThrottled` | **0** |
| the throttle bar width (`:128-131`) | `throttledCount / rateLimitedCount` | **0 %** |
| `{stats.rateLimitedCount} triggers configured` (`:88`) | parsed from `trigger.config` | real |

Three of the four runtime numbers are hidden behind `> 0` guards, so the surface renders as a bar
that says *"N triggers configured"* and a permanently-empty green track. **It is not lying loudly;
it is lying quietly**, which is worse — an operator reading it concludes nothing is being throttled,
which is true, because nothing is being limited. The brief asked whether the number this dashboard
shows is measured or assumed: **one of the five is measured, from configuration, and the other four
are structurally unreachable.**

### 7.C — The surface that *does* measure has zero consumers, and mis-attributes 3 of 7 key families (P2)

`get_tier_usage` (`commands/infrastructure/tier_usage.rs:51`) is real: it calls
`rate_limiter.usage_snapshot(EVENT_SOURCE_WINDOW)` and returns live per-bucket counts with a
3-second cache. Its TypeScript door, `getTierUsage()` (`src/api/system/tierUsage.ts:8`), has **zero
call sites** in 4,829 files. The `RateBucketUsage` / `TierUsageSnapshot` bindings are generated,
exported from `src/lib/bindings/index.ts`, and imported by nothing but the dead API module.

It also has a defect waiting for its first consumer. The `limit` field is inferred from a key
prefix (`:83-87`):

```rust
let limit = if key.starts_with("webhook:") { tier.webhook_trigger_max } else { tier.event_source_max };
```

The shared limiter holds **seven** key families — `event:*`, `event:test`, `event:smee_relay:*`,
`webhook:*`, `apikey:*`, `mcp_tool:*`, `tool:*`. Three of them are governed by constants, not by the
tier: `apikey:` by `API_KEY_RATE_MAX = 120`, `mcp_tool:` and `tool:` by
`TOOL_EXECUTION_MAX_PER_MINUTE = 30`. All three would render against `event_source_max` (30 on free,
120 on pro, `usize::MAX` on enterprise), and `approaching_limit` (`:109`) is computed from those
percentages. This is the direct consequence of §0.2's structural point: **the policy is not stored
with the key, so the only way to recover it is to guess from the key's spelling.**

### 7.D — 135 connectors, one rate limit, and the real numbers are in the prose (P1)

`rate_limit_rpm` is read at `api_proxy.rs:254` and declared nowhere. Two implementations agree:
a literal string search over the whole tree returns exactly two hits (both in `api_proxy.rs`), and a
JSON parse of all **134** `r##"…"##` metadata blobs in `builtin_connectors.rs` finds the key in
**zero** of them. (A third count of `BuiltinConnector {` struct literals returns **135**; the extra
row's metadata uses a different literal form. 135 is the connector count; 134 is the count of blobs
the JSON parser could reach. Both are reported because they answer different questions.)

Nine of those seeds state a real limit in the `llm_usage_hint` an agent reads:

| connector | documented limit | what the bucket allows |
|---|---|---|
| arXiv | *"max 1 request per 3 seconds. arXiv will block IPs that exceed this"* → **20/min** | **60/min** |
| Airtable | *"5 requests per second per base — 429 responses lock the base for 30 seconds"* → 300/min | 60/min |
| GitHub | *"5000/hr authenticated"* → ~83/min | 60/min |
| Granola | *"25 req/5s burst, 5 req/s sustained"* → 300/min | 60/min |
| Semantic Scholar | *"100 requests per 5 minutes"* without a key → 20/min | 60/min |
| Jira | *"Rate limit is dynamic; 429 responses include a Retry-After header you must honor"* | 60/min, and nothing reads the header |

The arXiv and Semantic Scholar rows are the ones that matter: the default is **3× more permissive
than a documented policy whose stated penalty is an IP block.** **Fix:** add `"rate_limit_rpm": N`
to the nine metadata blobs that already state a rate. **Not applied** — a seed change alters what the
running app enforces against live third parties.

### 7.E — The retry-after is computed seven times and reaches a machine once (P1)

Per §0.2. `RateLimiter::check` computes `retry_after_secs` from the oldest in-window timestamp on
every rejection — a genuinely correct sliding-window figure, not a flat window (the degenerate
empty-bucket arm at `:64-66` is the one place it falls back to the whole window). Of the seven
consumers, one puts it in `Retry-After`, five interpolate it into English, and one discards it.

Downstream, `src/lib/utils/apiError.ts:112` — the frontend's only rate-limit-aware retry — reads:

```ts
const retryMs = kind === 'rate_limited' ? 5000 : 2000;
```

A constant, chosen without reference to the number the backend just computed and put in the message
two fields away. `withRetry` (`:154`) then retries **once**, with **no jitter**. That module is
imported by exactly **one** of 4,829 files (`stores/slices/overview/overviewSlice.ts:24`), so the
Overview dashboard is the only surface in the app that reacts to a rate limit at all.

### 7.F — The highest-volume attacker-reachable producer drops over-limit events silently (P2)

`smee_relay.rs:526-540` calls `check(...).is_err()` and `continue`s. The comment above it is
accurate about why the limit exists (*"smee.io has no authenticity guarantee — a leaked channel URL
lets anyone flood events"*) and the `tracing::warn!` is the right floor. But there is no
dead-letter row, no counter, and no retry-after — so the difference between "we dropped 4,000 events
from this relay" and "this relay was quiet" is a log grep. Compare `p2p/messaging.rs:145-152`, which
increments `messages_rate_limited` and surfaces it in `NetworkDashboard.tsx:140-143`: the only
rate-limit rejection in the app with a **counter a human can see**.

### 7.G — `RateLimited` now names three different refusals, and 5 of 12 are rate limits (P2)

Two independent enumerations of `AppError::RateLimited` construction sites (12 by hand-filtered
grep, 15 by an instruments-based scan whose three extra hits are `RateLimited(_) =>` **match arms**
in `error.rs:115`, `error.rs:195` and `tool_outcome.rs:108` — see §12.6):

| what it means | sites | count |
|---|---|---|
| frequency over a window — **this leaf** | `events.rs:77`, `events.rs:211`, `mcp_tools.rs:794`, `api_proxy.rs:314`, `p2p/messaging.rs:153` | **5** |
| capacity — there is no room | `p2p/messaging.rs:179` | 1 |
| mutual exclusion — already in flight | `background_job.rs:233/252/404`, `platforms/github.rs:566`, `team_preset_adopter.rs:235/631` | **6** |

**This is a §6 neighbour interaction, and it is the good kind of cost.**
[`admission-control`](./admission-control.md) §7.A measured ten of eleven capacity refusals typed as
`AppError::Validation` (`retryable = false`) and correctly prescribed `RateLimited`, *"already
`retryable = true`, already mirrored on the frontend"*. Commit `17d059b1f` applied exactly the
prescribed two-literal fix. It was right — `retryable = true` is the truthful answer for a duplicate
job press — and its price is paid here: `ErrorCategory::RateLimit` now covers two disjoint
populations, so a consumer branching on it cannot tell *"the provider is throttling you"* from
*"you clicked twice"*. The healing engine's `FailureCategory::RateLimit` arm
(`core/src/healing.rs:303-324`) escalates with the suggestion *"Check API rate limits, consider
reducing execution frequency or upgrading your plan"* — advice that is correct for five sites and
nonsense for six.

The fix is not to revert; it is the missing third variant. `admission-control` §2 already names it —
*"make 'no room' a distinct, retryable error kind"* — and `InflightGuard` already exists for the
exclusivity case. **Three variants, three meanings, one `retryable = true` between them.**

### 7.H — A 429 from our own sidecar becomes a validation error (P2)

`src/companion/tts/pocket.rs:473-478` reads the status, recognises 429, and maps it to
`AppError::Validation("Pocket TTS service is at capacity (queue full) — try again in a moment")`.
`AppError::Validation` → `ErrorCategory::Validation` (`error.rs:123`) → severity **Low**
(`error_taxonomy.rs:399`), `is_failover_eligible` **false** (`:381-389`), `retryable = false`
(`tool_outcome.rs:113`). The minted message contains none of `rate limit` / `too many requests` /
`quota exceeded` / `usage limit` / `429`, so the string ladder at `error_taxonomy.rs:151-158` cannot
recover it either. The module's own header comment (`pocket.rs:21`) says the service *"replies 429
under overload, so no client-side semaphore is needed"* — the design is deliberate and the type is
wrong. **One-line fix**, and it is the same class as `admission-control` §7.A.

### 7.I — Four limiters is four budgets, and no surface adds them up (P2)

Per §0.1. Beyond the clock divergence, the practical cost is that a persona's total request spend is
not computable: `usage_snapshot` sees limiter 1 only, `get_api_proxy_metrics` sees limiter 2's
metrics ring, `MessagingMetrics` sees limiter 4's counters, and limiter 3 has no reader at all. The
in-flight guards (`INFLIGHT_TRIGGERS`, `REBUILD_INFLIGHT`, `CONTEXT_GEN_INFLIGHT`, `ADOPT_INFLIGHT`,
`PATCH_RELEASE_INFLIGHT`, and `execution_review`'s) are a sixth family of module-scope statics on the
same axis. **This is the shape `admission-control` found for capacity (eight lanes, seven verdicts)
reproduced for frequency**, which is itself evidence that the split is structural rather than
accidental: the app grew a limiter wherever a subsystem could not reach `AppState`.

### 7.J — Nothing reads `Retry-After`, including where it arrives parsed (P1)

Per §0.4. The sharpest instance is `build_session/parser.rs:86`: the Claude CLI's own
`rate_limit_event` envelope carries `retry_after` as a JSON number, the parser matches it in the same
arm as `"system"` and returns `vec![]`, and the repo's regression test at `:542` — titled
`system_and_rate_limit_envelopes_stay_silent` — pins that behaviour with a fixture that literally
contains `"retry_after":30`. **Staying silent in the event stream is correct; discarding the number
is not.** The build session is exactly the place that would benefit: it is a long-running CLI job
that can be paused rather than failed.

### 7.K — All four limiters are in-memory, and none says so on its surface (P2)

Every window in this app resets on process start. For limiters 2 and 3 that is documented in the
declaration (`notifications.rs:1172`: *"in-memory only, resets on app restart"*). For limiter 1 — the
shared one, the one behind the tier budgets a user could believe they are paying for — it is not
stated anywhere, and `TierConfig` presents `event_source_max` as a plan entitlement. On a desktop app
in daily development this is a restart away from unlimited. `ascent/src/lib/rate-limit.ts` writes
this limitation into the module docstring in six lines including the mitigation
(*"for a hard cross-instance limit, back it with Redis/Upstash"*). Copy that habit: **a limiter's
scope is part of its contract.**

## 8. Gaps

Things the primitives genuinely cannot do, several of which are upstream of the deviations above.

1. **`AppError::RateLimited(String)` cannot carry a retry-after.** This is the root of 7.E and half
   of 7.G. It is a one-line enum change with a 12-site blast radius, and §9 argues it is the highest
   value edit available on this leaf. The tuple variant is also why 8 of 12 sites reach for `format!`:
   the only field available is prose, so everything becomes prose.
2. **`RateLimiter` cannot answer "what is this key's limit?"** because the policy is a parameter, not
   state. Every consumer that needs the limit — the tier dashboard, the error message, an operator —
   must reconstruct it from the caller's side. 7.C is not a bug in `tier_usage.rs` so much as the
   only thing `tier_usage.rs` could have done.
3. **`usage_snapshot(window)` has the same shape**, so the read path cannot know a key's real window
   either. Today all four windows are 60 s and that hides the gap; the first 5-minute window makes
   every reported `current` wrong.
4. **The census cannot assert an absence**, and 7.D is an absence: *no connector declares
   `rate_limit_rpm`*. A rule matching zero files fails structurally, and a positive control pointed at
   the compliant form would return 0 because **no compliant instance exists in the tree**. §9.
5. **No limiter survives a process boundary**, so a budget cannot be expressed per hour or per day
   in any meaningful way on a desktop app the user restarts. `SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR`
   (`background.rs:1918`) is the counter-example and shows the answer: it counts rows in the database
   rather than timestamps in memory. **Where a budget must outlive the process, count the durable
   evidence, not the requests.**
6. **The client half is genuinely thin, and correctly so.** The two direct third-party clients
   (`arxivClient.ts:80`, `crossrefClient.ts:88`) fetch from the webview with a timeout and an abort
   signal but no limiter — and the right fix is not a client-side limiter, it is routing them through
   the Rust proxy that already has one. `ArxivSearchModal.tsx:38-40` is the one place in the frontend
   that branches on `status === 429`, and all it does is choose a different sentence.

## 9. The missing gate

**No census rule. The defect can be made unspellable, and the enforcement surface is too small for a
ratchet to earn a slot.** Both halves, with numbers.

### 9.1 — Why not a ratchet

Every countable population on this leaf, measured:

| candidate signal | matches | why it fails |
|---|---|---|
| `AppError::RateLimited(format!(` — a retry-after formatted into prose | **8** in 6 files | The right end state is **zero**, and the census cannot express "must be zero" (a rule matching zero files fails structurally). More importantly the fix is §9.2, which removes all 8 at once by making the string constructor not compile. |
| `RateLimiter::check(` call sites with an anonymous budget | **0** of 7 | All seven already name their budget. There is nothing to ratchet — which is a good finding and the reason `anonymous-retry-budget` and `anonymous-deadline` have populations and this does not. |
| a module-scope `LazyLock` limiter or in-flight ledger | ~8 | High conceptual overlap with `alert-dedupe-and-cooldown`'s `process-global-suppression-ledger` (12 matches / 8 files today) and `process-global-command-state`'s `process-global-caches-a-failure` (4 / 3). Neither currently matches `api_proxy.rs` or `notifications.rs`, so the overlap is not *literal* — but the doctrine a third rule would carry is already carried, and an in-flight guard has no legitimate home other than a process-wide static. |
| a 429 status inspection that does not read `Retry-After` | **6** | Six sites, and the two implementations agree. Too small, and every one of them is a *different* transport (reqwest response, a formatted message prefix, a ledger classifier). One regex cannot see them all. |
| a connector declaring `rate_limit_rpm` | **0** of 135 | **The positive control would return zero, because no compliant instance exists.** Per the doctrine, a control returning ~0 means the pattern is not discriminating on what you think — here it means the compliant form has never been written. That is the finding; it is not gateable. |

### 9.2 — What to do instead: close the variant, and the compiler is the gate

Hold the proposal against the seven qualifications (`golden-path-doctrine.md` §1):

- **Q1 — a required field carries only what it encodes.** `retry_after_secs` encodes *when to come
  back*. It does **not** fix "RateLimited means three things" (§7.G), so this is **two** edits, not
  one. Q1 earns its place immediately.
- **Q2 — requiredness is orthogonal to closedness.** Making the seconds a required non-`Option` field
  is wrong: `None` is legitimate for the six exclusivity sites. **Closedness of the variant set** is
  the whole win; requiredness of the field is not.
- **Q3 — a type nobody constructs constrains nothing.** 12 construction sites. Passes.
- **Q4 — a type anyone can construct authenticates nothing.** Not an authenticity concern here.
- **Q5 — withholding beats requiring.** The strongest form: change
  `RateLimited(String)` to a **struct variant** `RateLimited { message: String, retry_after_secs: Option<u64> }`.
  `AppError::RateLimited("…".into())` then does not compile, at all 12 sites, and every author is
  forced to answer the question at the moment they have the number in hand.
- **Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is *prose as the
  only field*. Keep `message`; take away "the seconds live inside it".
- **Q7 — relaxing a type is inert where the caller supplies the bad value voluntarily.** Exactly the
  case — every one of the 8 `format!` sites chose prose. Widening does nothing; changing the
  constructor shape is the fix.

And check it reaches: the value crosses a **serialization boundary** (doctrine §1, place 5), but it
crosses *outbound*, from a type the serializer is written against. `AppError`'s hand-written
`Serialize` impl (`core/src/error.rs:160-215`) gains one `serialize_field`, and the frontend's
`apiError.ts:112` constant becomes `err.retry_after_secs ?? 5000`. The type does reach.

**Companion edit, from §7.G:** add the third variant. `RateLimited` for frequency, the existing
`admission-control` prescription for capacity, and a new `AlreadyInFlight` for exclusivity — all
three `retryable = true`, all three distinguishable. `InflightGuard` already exists as the primitive;
only the error kind is missing.

### 9.3 — The instrument that *is* possible: an inventory, not a count

Two absences here are findable only by comparing what exists against what *should* exist — the
doctrine's fourth place types cannot reach:

1. **Every connector whose `llm_usage_hint` states a rate should declare `rate_limit_rpm`.** A
   ~30-line node script over `builtin_connectors.rs`: parse each metadata blob, regex the hint for a
   numeric rate, assert `rate_limit_rpm` is present. Today it reports **9 findings of 135**. Its
   fail-loud precondition is mandatory and specific: **exit 2 if it parses fewer than 120 metadata
   blobs**, because a change to the raw-string delimiter silently drops rows from the JSON parse (it
   already reads 134 of 134 — see §12.6, where the "135" was an off-by-one).
2. **Every `RateLimiter::check` call site must consume its `Err` payload.** Not regexable across the
   five refusal shapes, but it is exactly seven sites: a hand-maintained assertion in a Rust unit test
   listing the seven `file:line`s and their refusal kind would catch the eighth being added as a
   `.is_err()`. This is the *test-as-inventory* pattern, and the doctrine's warning applies —
   fixtures that live beside the thing they test check nothing, so the list must be derived from a
   grep at test time, not typed by hand.

## 10. Convergence

**Cohort established per leaf, at measurement time: five checkouts present, all five opened, and the
effective independent cohort for this leaf is 4** — `personas-web`'s limiter is a two-line delegation
to a shared module and shares no vocabulary with this repo, so lineage disqualification does not
apply here; but its rate-limiting is a web-server concern with no desktop analogue, so it is a
silence rather than a witness.

| repo | has a limiter | reads `Retry-After` | jitter | notable |
|---|---|---|---|---|
| `vibeman` | — | **yes**, `src/lib/llm/base-client.ts:237-252` | **yes**, `useSSEStreamWithBackoff.ts:28-29`, ±25 % | `parseRetryAfter` handles **both** delta-seconds and HTTP-date, clamps to `MAX_RETRY_AFTER_MS`, and is consumed as `retryAfter ?? baseDelayMs * 2**attempt` (`:317`) |
| `ascent` | **yes**, `src/lib/rate-limit.ts` | **yes**, `src/lib/github/source.ts:295`, `list.ts:106` | no | Distinguishes GitHub's **secondary** rate limit (403 with `x-ratelimit-remaining > 0`) from the primary; emits `Retry-After` on its own 429s with tests asserting the header value |
| `personas-web` | yes, `api/votes/rate-limit.ts` → `@/lib/server/rate-limit` | no | no | A **namespaced shared limiter** — `isRateLimited({ namespace, key, limit, windowMs })`. The policy travels with the call, same shape as ours |
| `brainiac` | no | no | **as doctrine text only** — `standards-data.ts:58`: *"Exponential backoff with full jitter, max 30s"* | It writes the standard down and does not implement it, which is the same gap this repo has with its connector docs |
| `personas-cloud` | no | no | no | Silence |

**The label is wrong in direction, and this is the inversion the doctrine says is the strongest
oracle result.** `convergence: mixed` implies a fleet split. What the sweep found is a fleet that
**solved** the clause this repo fails — and one of the solvers is **`vibeman`, which the corpus has
twice dated as this repo's ancestor**. So `Retry-After` handling is not an unsolved problem the
fleet converged on avoiding; it is a **regression relative to code the same author wrote first**.
That is cost/failure/inversion evidence, not agreement evidence, and shared authorship does not
explain it away — if anything shared authorship makes it sharper, because the same engineer wrote
`parseRetryAfter` and then, in the successor project, wrote nothing.

Two clauses split the other way and are worth stating as self-comparison:

- **Personas is ahead on rejection accounting.** `RateLimiter::check` does not record rejected
  requests — `ascent`'s `rate-limit.ts` carries a long comment about having shipped precisely that bug
  (*"a ~1s spike became a sustained full-window lockout"*) and fixing it. Personas never had it, in
  either of the two limiters where it could have occurred.
- **Personas is ahead on log volume.** The warn-latch-per-streak (`rate_limiter.rs:73-88`) has no
  analogue in any sibling; `ascent` and `personas-web` log per rejection or not at all.

**One silence, reported as silence:** no repo in the cohort persists a rate-limit window across a
process restart, and two of them (`ascent`, `personas-web`) write the limitation into the module
docstring. Nobody has solved it; two have documented it; this repo has done neither for its shared
limiter (§7.K).

## 12. Corrections

### 12.1 — To the brief: "is the limiter shared across concurrent callers or per-caller?"

The brief framed this as the question that separates real from ceremonial, and it is — but the
answer is not binary here. **Limiter 1 is genuinely shared** (one `Arc` on `AppState`, seven
concurrent callers, one lock), so on the lane the brief was worried about, this repo passes. The
defect is one level up: **there are four limiters**, three of them private module statics, and the
"shared vs per-caller" question has a different answer per lane. A brief that had accepted "shared —
fine" would have missed §0.1 entirely.

### 12.2 — To the brief: "there is a rate-limit dashboard listed as a pending UI item"

There are **two**, they measure different things, and both are broken in opposite ways.
`RateLimitDashboard` is shipped, user-reachable, and structurally shows zeros (§7.B).
`get_tier_usage` measures correctly and has zero consumers (§7.C). The brief's question — *measured
or assumed* — has the answer: **the surface a user can see reports configuration; the surface that
reports measurement is not wired to anything.**

### 12.3 — To `admission-control` §7.A: the table is now stale, and its own fix caused it

`admission-control.md:398-410` lists eleven capacity refusals with `background_job.rs:222,:240` as
`Validation` and prescribes changing those two literals. Commit `17d059b1f` did exactly that (it
touched `background_job.rs` and nothing else). So **the row is now wrong for the three
`background_job.rs` sites** — they are `AppError::RateLimited` today, at `:233`, `:252` and `:404`
— and correct for the remaining eight (`idea_scanner.rs:434`, `kpi_scan.rs:496`,
`use_case_scan.rs:238` are still `AppError::Validation`; verified by reading all three).

That path's §0 also states *"of its 9 construction sites, 8 front somebody else's rate limit and
exactly one is our own capacity gate."* Today the count is **12**, and the ratio has inverted:
**5 front a frequency limit, 1 is capacity, and 6 are mutual exclusion** (§7.G). The change is the
direct arithmetic consequence of `admission-control`'s own applied fix — a correct fix whose price
lands on this leaf. That is not a criticism of it; it is the §6 interaction the contract asks
composers to look for, and it is the second one the corpus has recorded.

### 12.4 — To `admission-control`'s anti-pattern table: "the webhook path 200 lines away returns 429 + the exact seconds"

`admission-control.md:484` cites the webhook path as the contrast case for a refusal with no
retry-after. Half right, and the half that is wrong is the half that matters. `webhook.rs:341-360`
returns **429 with `no_headers()`** — the seconds are interpolated into the JSON body's `error`
string, which is prose, not a header. The file *does* contain a correct `Retry-After`, at
`:438-441`, but that is the **422** for an out-of-active-window request, a different branch. So the
contrast the anti-pattern draws is real but its exemplar is one branch to the left of where it
points.

### 12.5 — To `retry-with-backoff` §0: confirmed, and extended

*"Zero of the ~20 retry paths add jitter. Zero read Retry-After."* Re-derived here on an independent
sweep with the same result, and extended in one respect that path could not have seen from the retry
side: the `Retry-After` value **arrives already parsed** on the Claude CLI stream and is discarded by
a match arm with a regression test pinning the discard (§7.J). And the convergence result inverts the
implicit framing: this is not a fleet-wide omission — the ancestor repo reads the header (§10).

### 12.6 — Disagreements between the two implementations, and their causes

| count | impl A | impl B | cause | which is right |
|---|---:|---:|---|---|
| `AppError::RateLimited` construction sites | 12 | 15 | B matched `RateLimited(_) =>` **match arms** in `error.rs:115`, `error.rs:195`, `tool_outcome.rs:108`. A filtered `=>` by hand. | **A (12)** |
| connector seed rows | 135 | 134 | ~~One row's metadata uses a different raw-string form.~~ **CORRECTED 2026-08-17 — that cause was FABRICATED.** There is no such row: `metadata: Some(...)` is 134 and `None` is 0. Implementation A was off by one because its `BuiltinConnector {` pattern also matched **`pub struct BuiltinConnector {`** at `builtin_connectors.rs:4` — the type declaration, not a seed. | ~~**Both.** 135 connectors, 134 parseable blobs.~~ **B was simply right: 134.** This row is kept as a worked example of the worst way to resolve a disagreement — inventing a mechanism that would explain it, and then publishing *both* numbers as if the invention had verified them. Two implementations disagreeing is evidence that **one of them is wrong**; a reconciliation is a claim and needs its own check. The composer that found this then made the identical off-by-one on the sibling generated file (124 against a true 123) and caught it only because it had just written this correction. |
| `RateLimiter::check` call sites | 6 (reading) | 7 (scripted) | The hand pass missed `tool_runner.rs:187` because it is `rl.check`, not `state.rate_limiter.check`. | **B (7)** |
| connectors stating a rate in prose | 7 (concept-name regex) | 7 (numeric-rate regex) | Two *different* detectors, 5 in the intersection, **9 in the union**. Neither is a superset of the other. | **9**, and the fact that two plausible regexes over the same text agreed on a total and disagreed on membership is why both are reported. |

The last row is the doctrine's *"agreed on the finding and disagreed on where it is"* in miniature,
on a nine-item population where opening all nine was one command. A vocabulary-based detector's
recall is bounded by its author's word list, from **both** ends: the concept-name pass missed rows
that only state a number, and the numeric pass missed Jira, whose limit is *"dynamic"* and has no
number at all.

### 12.7 — What this document does **not** settle

Whether a throttled scheduled fire should be **dropped or deferred** is `admission-control`'s
question and this leaf deliberately does not answer it — but §7.A cannot be fixed without answering
it, so the two leaves are coupled at exactly one decision. Say which, in the commit, when it lands.
