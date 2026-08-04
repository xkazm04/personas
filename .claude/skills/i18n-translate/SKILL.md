# i18n-translate — copywriting-grade, context-aware localization (Personas)

Translate `src/i18n/locales/en.json` into the other 13 locales the way a bilingual
copywriter on the product team would — not a machine. The English is strong; the
job is to make each *other* locale read as if it were written first in that
language, in the Personas voice, using the right domain terms, and never breaking
the interpolation contract the build enforces.

This is a **transcreation** loop with an engineering guardrail, not a
find-and-replace. Word-for-word is the failure mode.

> Adapted from the `kp` skill of the same name. The method is identical; the
> contract is not — Personas does **not** use next-intl or ICU. Read
> "The contract" below before assuming anything ICU-shaped.

---

## When to use

- "Review/improve the Czech (or any) translations."
- "The German is machine-y, make it read natively."
- "Translate the app to X" / "add language X" (a new locale).
- A periodic sweep to catch strings that drifted out of parity, were added in
  English only, or **were merged into a locale as verbatim English**.

## When NOT to use

- Adding/renaming **English** keys — that's normal feature work (edit
  `en.json` + the `t.section.key` call site). This skill *consumes* en as the
  source of truth; it doesn't invent English copy. If the English itself is
  wrong, flag it, don't silently rewrite it.
- Backend log messages, Sentry breadcrumbs, console output. Not user-facing.

---

## The contract you must never break (this repo)

`src/i18n/locales/<locale>.json`, source of truth `en.json` (~16.2k leaf keys,
59 top-level sections). 14 languages: `en, zh, ar, hi, ru, id, es, fr, bn, ja,
vi, de, ko, cs`. A `Proxy` in `src/i18n/useTranslation.ts` deep-merges each
locale section over its English counterpart, so a missing leaf silently renders
English — **which is exactly why silent gaps survive for months.**

### Interpolation — NOT ICU

`interpolate()` in `src/i18n/useTranslation.ts` does one thing:

```ts
template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
```

Consequences, all learned the hard way:

- **`\w` is ASCII-only.** A placeholder whose name you translated
  (`{شخصيةs}`, `{페르소나s}`, `{персонаs}`) does not match the regex at all and
  renders **literally on screen**. Even an ASCII-but-recased `{Personas}` fails,
  because the lookup is case-sensitive against `vars.personas`.
  → **Never translate, recase, or pluralize a placeholder NAME.** `{count}`
  stays `{count}` in every locale, forever.
- **There is no `{n, plural, …}` syntax.** Do not invent one; it will render raw.
- **Plurals are separate keys**, selected by the call site:
  `foo_one` / `foo_other` / `foo_many` / `foo_zero`. The key set is **frozen** —
  you translate each suffixed key's *value*, you never add or remove a category.
  You cannot fix a language's plural rules from here; if a locale genuinely needs
  a category the key set lacks, **flag it**, don't fake it.
  - Corollary: in a `_one` value, `count` is always 1. Dropping `{count}` for an
    idiomatic singular (Arabic `خطوة واحدة` for `"{count} step"`) is **correct
    transcreation**, not a bug — but the placeholder-parity gate in
    `translate-merge.mjs` will reject it. Keep `{count}` unless you also relax
    the gate for `_one` keys.
- **`_comment*` key segments are translator notes.** Never rendered, never
  translated — copied verbatim (`translate-extract.mjs` splits them out).

### Do-not-translate

Brand names (Personas, Claude, GitHub, GitLab, Slack, Sentry, Obsidian, Discord,
Notion, YouTube), technical identifiers (API, CLI, JSON, HTTPS, cron, webhook,
SQLite, MCP, P2P, ONNX), enum/token codes, CSS classes, URLs, code identifiers,
user-generated content.

> **Careful:** "Personas" the product ≠ "personas" the plural common noun. In
> `common.all_personas` = "All personas" the word is a noun and **must** be
> translated. Judge by the call site, not by the spelling.

### The gates — run ALL before finishing

| Gate | What it catches |
|---|---|
| `npm run check:i18n:strict` | key parity: missing keys, stale/extra keys |
| `npm run check:i18n:untranslated` | **values that are still verbatim English** |
| `node scripts/i18n/split-locales.mjs` | regenerates the chunks the runtime loads |
| `npm run check:i18n-dead` | keys no source file references (don't translate these) |

**`check:i18n:strict` is not enough.** It asserts a key *exists*, never that its
value was translated. In July 2026 it reported 0 missing across all 13 locales
while **41,536 live strings rendered as raw English** (~24% of the app; entire
`monitor`, `twin`, and `plugins` surfaces untranslated in every language).
`check:i18n:untranslated` exists to close that hole. Believe it, not the
key-parity report.

**After editing any `locales/*.json` you MUST run `split-locales.mjs`** — the
runtime loads `src/i18n/section-locales/<lang>/<section>.json`, not the locale
file you just edited. Committing one without the other ships a no-op.

---

## The two artifacts (create once, maintain forever)

The memory that makes run N+1 consistent with run N. They live under `docs/i18n/`:

1. **`docs/i18n/glossary.md`** — the termbase. *What to call things.* Personas'
   domain nouns/verbs with the canonical translation per locale + a note. One
   decision per term, applied everywhere: persona, agent, capability, connector,
   credential, vault, recipe, template, trigger, execution, run, schedule,
   deployment, healing, observability, fleet, orchestration, draft, promote.
   Plus the Do-Not-Translate list above.
2. **`docs/i18n/style-<locale>.md`** — the voice guide. *How to sound.* Register
   (Personas is a **professional developer tool** → formal address: Czech
   *vykání*, German *Sie*, French *vous*, Japanese *です・ます*, Korean
   *합쇼체/해요체*), sentence case vs Title Case (most non-English UIs use
   sentence case), punctuation/typography (Czech `„…"`, French narrow NBSP before
   `:!?»`, CJK full-width punctuation, real ellipsis `…`), tone, loanword policy
   (decide per term IN THE GLOSSARY and be consistent), and length discipline for
   UI chrome.

Before translating anything, **read both**. If they don't exist, the first run
creates them. When you make a new term decision mid-run, write it to the glossary
so it sticks.

---

## Modes (dispatch on the argument)

- **`review <locale> [section]`** — audit EXISTING translations for quality and
  fix them. Optional dotted-section prefix (e.g. `vault.dependencies`) scopes it.
- **`gaps [locale|all]`** — translate strings whose value is still verbatim
  English (`check:i18n:untranslated` IS the work list). **Run this before
  `review`** — a polished 76% under a raw-English 24% is the wrong order.
- **`full <locale>`** — (re)translate every key for one locale.
- **`sync [locale|all]`** — the incremental heartbeat: keys missing from the
  locale, plus keys whose English source CHANGED since the locale was last
  touched (`git log -1 --format=%cI src/i18n/locales/<l>.json`).
- **`new <locale>`** — adopt a language: bootstrap `style-<locale>.md` + the
  glossary column, add it to the 14, then translate every key.

If no locale is given, operate on every non-`en` locale.

---

## The method — per string, before you type the translation

Machine translation fails because it translates the *string*; you translate the
string **in its place in the product**. Batch by section so a whole surface stays
coherent:

1. **Locate the use.** `Grep` for `t.<section>.<key>` across `src/` to find the
   call site. Read enough of the component to answer:
   - **Element type** → register + length. A `<button>` wants a short imperative;
     a heading a noun phrase; a tooltip a fuller hint; an `aria-label` a
     descriptive sentence; an error calm and actionable; a `placeholder` an
     example, not a command.
   - **Siblings** → the other keys in the same object form one UI cluster;
     translate them as a set so terms and grammar agree.
   - **Length budget** → does it sit in a chip, badge, or narrow column? Prefer
     the shorter idiomatic form; don't let a button wrap. Watch German and
     French, which run 20-35% longer than English.
2. **Classify → strategy.**
   - *UI chrome* (buttons, labels, tabs, menus): concise, conventional, match the
     target OS/app idiom.
   - *Body / empty-state / onboarding*: **transcreate** — carry the feeling and
     rhythm, not the words. This is where literal dies.
   - *Errors / status*: plain, non-alarming, actionable.
   - *Legal / consent*: precise, sober; preserve legally-loaded meaning.
3. **Apply the glossary + style guide.** Canonical term for every domain word;
   the locale's register, casing, punctuation.
4. **Preserve the interpolation skeleton.** Every `{var}` survives byte-identical.
   Move it to where the target grammar wants it. Keep emoji and `·` separators.
5. **Sanity-read it as a native.** Would a native speaker write this on a real
   product, or does it smell of English word order? If unsure, mark it.

---

## Review lens (for `review`, and as self-QA on anything you generate)

- **Calque / literal word order** — English wearing a costume.
- **Register mismatch** — informal where a professional tool needs formal.
- **Terminology drift** — one concept translated two ways across the app.
- **Format break** — renamed/lost placeholder, brace imbalance, changed emoji.
- **Casing/punctuation** — Title Case aped from English, straight `...` for `…`,
  wrong quote glyphs, missing/incorrect spacing around CJK and French punctuation.
- **Length risk** — visibly longer than English in a tight control.
- **Leftover English** or a wrongly-translated brand term.

For genuinely ambiguous strings (a pun, a domain term with no settled local
equivalent), **don't guess silently**: apply your best version AND add it to the
run's review list with a one-line note. The user is not a native reviewer by
default — surface these.

---

## Working at scale (16k keys × 13 locales)

- **Batch by section, not by string.** Load one section's en values + its call
  sites, translate the whole cluster in one coherent pass, write, move on. This
  keeps sibling grammar consistent and dodges the "lost in the middle" failure of
  one giant prompt. ~90 keys per batch is a good ceiling.
- **Skip dead keys.** `npm run check:i18n-dead` lists keys no source file
  references (2,671 as of 2026-07; `debt` and `planner` were 100% dead). Never
  spend a token translating a string no user can see.
- Keep key order identical to en for reviewable diffs.
- A **workflow / ultracode** fan-out is the natural shape for a full sweep: one
  agent per (locale × section) chunk, each fed the glossary + style guide + en
  values, then a parity/QA merge. Don't spin that up unprompted — offer it.
- Never machine-blast a whole file in one edit; that's how silent format breaks
  and terminology drift ship.

---

## Guardrails (learned the hard way)

- **en is the source of truth.** Don't edit en values to make a translation
  easier. If en is wrong/ambiguous, note it for the user.
- **Don't clobber good human translations.** In `review`/`gaps`, change only what
  is actually wrong or missing.
- **JSON hygiene** — valid JSON, UTF-8, real diacritics (`č`, `ř`, `ž`, not ASCII
  folds), no trailing commas, 2-space indent, trailing newline.
- **Numbers/dates** are formatted at runtime — never hardcode a localized number.
- **Verify, don't assume.** A catalog that "looks translated" can still be 24%
  English. Run the gates.
- **Parallel safety** — this skill rewrites 13 large files. Per `.claude/CLAUDE.md`,
  do it in a `git worktree`, stage only your own paths, never `git stash`.

---

## Exit checklist

- [ ] `npm run check:i18n:strict` → OK (key parity, all locales).
- [ ] `npm run check:i18n:untranslated` → OK (no verbatim-English values).
- [ ] `node scripts/i18n/split-locales.mjs` run; `section-locales/` committed.
- [ ] Touched locale JSON valid, same key order as en, proper diacritics.
- [ ] `docs/i18n/glossary.md` + `docs/i18n/style-<locale>.md` updated with any new
      term/voice decisions made this run.
- [ ] A short **review list** surfaced: the handful of strings worth a native
      second look (with why), and anything capped/deferred.
- [ ] One-line summary: locale(s), # keys translated/reviewed/fixed, # flagged.

When every box is checked, each locale should read like it was written by a person
who uses Personas every day — and the build stays green.

---

## Periodic operation

`gaps` then `sync` is the heartbeat:
- **On change**: the `i18n-no-gaps` pre-commit hook already runs
  `check:i18n:strict`. Add `check:i18n:untranslated` to catch value-level gaps.
- **On a schedule**: `/loop` or `/schedule` around `/i18n-translate sync all`.
- **New market**: `/i18n-translate new <locale>` once, then it joins the rotation.

ARGUMENTS: `<mode> [locale] [section]` — e.g. `review cs vault.dependencies`,
`gaps all`, `full de`, `new pl`. Default with no mode: `gaps` every non-en locale.
