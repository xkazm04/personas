---
layer: application
subject: i18n
technique: completeness-gates
stack: node
---

# The three gates and the pipeline — completeness as this repo enforces it

The catalog state the gates hold: `src/i18n/locales/en.json` (19,112 leaf
keys) × 13 non-English locales at **0 missing / 0 extra / 0 untranslated**
(measured 2026-08-16). That state was *earned* — the value-parity half of
the standard was built only after its absence hid ~57k byte-identical
English strings (~24% of the app) behind a green report until 2026-07-12
(`lefthook.yml:41-48` records the incident inline).

## Key parity: `check-coverage.mjs`

`scripts/i18n/check-coverage.mjs` flattens each locale's key tree
(arrays are leaves) and diffs against `en.json`:

- **Extras always fail, in every mode** (`:8-11`) — stale keys after a
  source rename. Missing keys warn by default and fail under `--strict`.
- Missing `en.json` itself is FATAL (`:74-77`) — a config error, never an
  empty success.

`npm run check:i18n:strict` is the no-gap form; the default form runs on
pre-push and CI as a backstop. One drift worth knowing: the script's
header comment (`:14-21`) still documents the retired "translation teams
catch up asynchronously" posture, while the pre-commit hook below enforces
the opposite — the mode that runs by default is the policy; the comment is
archaeology.

## Value parity: `check-untranslated.mjs`

`scripts/i18n/check-untranslated.mjs` is the companion the standard calls
the missing half, and says so in its header (`:2-8`): key parity "can exist
in every locale and still render English — the runtime `t` Proxy
deep-merges English underneath, so nothing warns."

- **Tolerance list**: `docs/i18n/untranslated-allowlist.json`, entries
  `"<lang>:<key>"` or `"*:<key>"` for values legitimately identical to
  English (`:17-19`).
- **Scoped to live keys**: dead keys (no source call site, per
  `find-unused-i18n-keys.mjs`) are excluded so the gate measures what a
  user can see — and if the dead-key scanner fails, the catch block leaves
  `dead` empty and the gate **checks everything** (`:45-59`), failing safe
  exactly as the technique requires. `--include-dead` exists for full
  audits.

## Where they bite: pre-commit, glob-scoped

`lefthook.yml` binds both gates to commits that stage any
`src/i18n/locales/*.json` (`:37-51`):

- `i18n-no-gaps` → `check-coverage.mjs --strict`
- `i18n-no-untranslated` → `check-untranslated.mjs --strict`

Both read the working tree, so `en.json` and the locale files must stage
together. This is the technique's "gate at the door" — a commit adding
source keys without all thirteen translations is blocked before it enters
history, while unrelated commits never pay the cost.

## The pipeline that makes the gate humane

Three scripts, matching the technique's stages one-for-one:

1. `scripts/i18n/translate-extract.mjs` — computes the gap into
   `.i18n-work/missing-en.json` (+ `_meta-keys.json`).
2. One translator subagent per locale fills `.i18n-work/missing-<code>.json`
   with the same keys translated (machine quality accepted; the bar is "no
   English mixed in").
3. `scripts/i18n/translate-merge.mjs` — the validating door: refuses a
   locale that is absent, unparseable, dropped keys, or **broke a
   placeholder** — `phSet()` extracts and sorts `{…}` tokens and compares
   against the source (`:47`, `:60-62`). On success it deep-merges, re-runs
   `split-locales.mjs`, re-asserts `check-coverage.mjs --strict`, and
   deletes the workdir (`:77-83`) — the pipeline ends by re-running the
   gate it exists to satisfy.

## The third check, present in pieces

Domain coverage — catalog vs external vocabulary — is the least uniform of
the three here. `scripts/i18n/check-error-registry-parity.mjs` covers one
domain (error-registry keys), and
`src/i18n/__tests__/chainStopReasons.parity.test.ts` pins another
(stop-reason tokens against their backend enum). But the general case is
exactly where the standard predicts blindness: the composition-era sweep
(`docs/concepts/golden-paths/translation-completeness.md`) found a live
6-arm database CHECK vs 5-arm `status_tokens` catalog gap (`ai-compose`
renders as a raw token) behind fully green parity boards — in this repo and
in two unrelated ones. Per-domain parity tests exist where someone has been
burned; a systematic domain-vs-catalog gate does not yet.
