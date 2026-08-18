---
layer: application
subject: dead-code
technique: suppression-hygiene
stack: node
---

# The census exclude list — suppression hygiene enforced by the engine, and the rosters that lack it

The repo has one suppression surface that implements every clause of the
technique mechanically, and several that implement none. The contrast is the
application.

## `scripts/census/lib/engine.mjs` — the exemplar

The census registry (`scripts/census/rules.json`, 201 rules; 70 carry `exclude`
lists, 147 exclude entries in total) is validated and executed by one engine, and
the engine enforces the hygiene rather than recommending it:

- **Reasons are mandatory, with substance.** `engine.mjs:389-395` — every
  `exclude[i]` must have a `path` and a `reason` of at least 12 trimmed
  characters, with the failure message stating the doctrine: "an unexplained
  exemption is how an allowlist becomes a place violations go to hide." A sample
  entry shows the register the rule produces: `src/stores/util/dedupedStorage.ts —
  "the deduped Web Storage wrapper itself — this is the primitive the golden path
  routes callers TO"`. That is a reason written for the person deciding whether to
  remove it.
- **A stale suppression fails the run.** `engine.mjs:276-286` — after the walk,
  every exclude with `hits === 0` becomes a structural problem coded
  `stale-exclude`: "exclude matched no file. The exemption is stale — the file
  moved or was deleted. Remove the entry or fix the path. (reason on record: …)".
  The reason is echoed back at failure time so the fix is made with its context.
  This is the load-bearing clause and it fires in practice: the `sub_canvas`
  deletion (`78e9bff68`) had to touch `rules.json` for exactly this reason —
  deleted files left excludes matching nothing.
- **Zero-match rules are refused too.** `engine.mjs:267-272` — the same
  instrument refuses a *rule* that matches nothing ("a rule pinned at 0 is a gate
  that can never fail"), and its error text names and blocks the escape hatch of
  baselining it at zero. A dead rule and a dead exclude are treated as the same
  defect: suppression-shaped dead code inside the instrument.

What the census does **not** yet enforce is the reaper clause: an exclude entry
has a reason but no expiry or lapse condition, so an exemption whose *target
survives but whose justification died* is not caught. Stale-match failure covers
one rot axis; the other is open.

## The rosters without hygiene

- **`knip.json` `ignore`** — seven glob entries, no reasons, no delegates. Each is
  correct (bindings, generated command names, i18n generated trees, the harness),
  and each is a class handed to another instrument — but the file cannot say
  which, so the audit "does the delegate exist?" is manual. Run it once:
  `src/lib/bindings/**` delegates to a reconciliation gate that is unbuilt
  (#w2-ipc-contract). That is a class with **no coverage at all**, hidden by an
  ignore entry that reads as routine.
- **`find-unused-i18n-keys.mjs --ignore-prefix` and `purge-dead-keys.mjs
  --keep-prefix`** — command-line escapes rather than a declared roster. The
  header documents the intent correctly ("use for known dynamic-lookup subtrees
  that the static scanner can't see through"), but a flag passed at invocation is
  a suppression with no reason on record, no reaper, and no way to fail when it
  matches nothing. The scanner *does* bake in three dynamic-lookup escapes
  (prefix-liveness, `tokenLabel` categories, `ERROR_KEY_MAP` pairs) — those are
  declared, in code, with their reason. The flag-shaped ones are not.
- **`unused-commands.mjs`** — the header names "anything in the override list"
  (`src/lib/commandNames.overrides.ts`) as a referenced source. Whether that list
  carries reasons per entry is a question the instrument does not ask.

## The delegation note the technique wants, sketched

Each `knip.json` ignore entry could carry — in a sibling comment map, since JSON
forbids inline comments — the class it hides and the instrument that owns it:

| ignore | class | delegate | delegate exists |
|---|---|---|---|
| `src/lib/bindings/**` | orphaned generated artifacts | ts-rs inventory reconciliation | **no** |
| `src/lib/commandNames.generated.ts` | cross-boundary registrations | `scripts/build/unused-commands.mjs` | yes |
| `src/i18n/generated/**`, `section-locales/**` | dead catalog keys | `scripts/i18n/find-unused-i18n-keys.mjs` | yes |
| `src/lib/harness/**` | separate entry root | test-automation server | yes (different entry) |

The one **no** is the finding. Written down, it stops being rediscovered.
