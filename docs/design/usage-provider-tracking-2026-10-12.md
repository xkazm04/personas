# Tracking agy, grok and codex image limits (research, 2026-10-12)

Question: can the supply column meter every plan across providers, including
Google's `agy` (coding and image models), `grok` (coding and image) and image
generation from `codex` on an OpenAI plan? Measured on this machine (agy 
installed, grok 1.0.46, codex-cli 0.160.0) plus vendor docs. Nothing below
needed a model call.

## Verdict

| Provider | Remaining % + reset, coding | Image limit | How |
|---|---|---|---|
| **Codex** (already metered) | yes | **no separate limit**, shares the one bucket | rollout `token_count.rate_limits`, key off `window_minutes` |
| **agy** | **yes, cheapest of the three** | not trackable (no image bucket anywhere) | `agy -p "/quota" --output-format json` |
| **Grok** | **no** (consumption only) | not trackable | `~/.grok/sessions/**/usage.json`, or deep-link to Settings > Usage |

## agy (Antigravity CLI)

- `agy -p "/quota" --output-format json` answers locally: `num_turns: 0`, zero
  tokens, ~0 s. The changelog states `/usage`, `/quota`, `/credits` make no agent
  turn in print mode.
- Payload: `command.data.groups[].buckets[]` with `id`, `name`, `window`
  (`5h` | `weekly`), `remaining_fraction` (0..1), `reset_time` (UTC ISO),
  `description`, optional `disabled`. Two groups observed: "Gemini Models"
  (`gemini-5h`, `gemini-weekly`) and "Claude and GPT models" (`3p-5h`,
  `3p-weekly`). Reset times are absolute and NOT aligned between groups.
- Units are a fraction of cost-weighted quota, not request counts. No allowance
  numbers and no plan-tier field; tier (Pro / Ultra) has to be inferred.
- **Spawn trap (cost 134k tokens once):** under Git Bash MSYS rewrites `/quota`
  into `C:/Program Files/Git/quota`, which agy sends to the model as a real
  prompt. Spawn with `MSYS_NO_PATHCONV=1` or without a shell, and treat
  `num_turns != 0` or a missing `command` field as a failure.
- Undocumented endpoints exist (`cloudcode-pa.googleapis.com`
  `retrieveUserQuotaSummary`, `retrieveUserQuota`) but reusing agy's OAuth token
  from a third-party client is a ToS / security call, and `retrieveUserQuota` has
  reported bugs (stuck at 1.0, wrong window). Shelling out to `/quota` avoids it.
- Image: Nano Banana 2 is the agent's image tool, but `agy models` lists no
  image model and `/quota` has no image bucket. One forum report claims ~6-7
  images per 5 h separate from Flash; single unverified source. To learn the
  truth: generate one image and diff `remaining_fraction` before and after.

## Grok CLI

- No remaining-% source on disk, in a subcommand, in the statusline or in OTEL;
  the statusline docs say a rate-limit summary is "a number it cannot source
  honestly". The `/usage` modal fetches it server-side from an authenticated
  session (endpoint not found; replaying the OAuth token is not recommended).
- Consumption IS local: `~/.grok/sessions/<cwd>/<id>/usage.json` (`session`
  tokens, `costUsdTicks` / 1e10 = USD, `modelUsage`, `updatedAt`), or
  `grok usage <session-id>`. Plan tier appears only as binary strings
  (`subscription_tier`), no cached value found.
- Since June 2026 one weekly pool covers API, Build, Chat, Imagine, Voice;
  reset time per account, unpublished pool size. Image generation is reachable
  (`/imagine`, `image_gen` tool) and draws from the same pool; the per-product
  split is only on grok.com Settings > Usage. Blog daily-cap figures predate the
  pool and are stale.
- Best honest meter: weekly consumption from `usage.json` (a spend gauge with no
  ceiling), `usage_limit_reached` / `usage_pool_exhausted` as the hard signal,
  and an "open Usage" link for the real percentage. Counting `image_gen` tool
  calls in `events.jsonl` approximates image volume (unverified).

## Codex image generation

- **Yes, on a plan login.** `image_gen` is built in on Plus / Pro / Business /
  Enterprise (not Free), no API key. PNGs land in
  `~/.codex/generated_images/<session>/`; 27 of them from 2026-10-02 are on this
  machine from `codex exec` under `plan_type: pro`.
- **No separate image limit.** OpenAI's pricing page: image generation "counts
  toward the same general usage limits", burning them ~3-5x faster per turn,
  then credits. So the existing codex weekly bar already IS the image meter.
- If an image-attributed figure is wanted: difference `primary.used_percent` and
  `credits.balance` across the `token_count` events around an image turn, matched
  to PNGs by session id. Coarse; label it an estimate.
- On this Pro account `primary` is `window_minutes: 10080` and `secondary` is
  null (no 5 h window): never assume primary means 5 h.
- Live alternative: undocumented `GET chatgpt.com/backend-api/wham/usage`
  (needs `chatgpt-account-id`); shape varies by plan and can read 0% while a
  model-level bucket is exhausted. Prefer the local rollouts.

## What the UI needs from this

- agy slots into the existing grammar unchanged: each group is a plan, its `5h`
  and `weekly` buckets are `short` and `long`. That needs a fourth `CliProvider`
  (`agy`), a Rust reader that shells out as above, and a `ProviderIcon` glyph.
- Image limits need no new window kind for codex (shared bucket). agy and grok
  have nothing to draw, so an `image` slot would be empty today; do not add one
  until agy publishes an image bucket.
- Grok has no ceiling to fill a bar, so it needs a consumption-only row (or the
  words "see Usage") rather than a fake percentage.
