# Czech (cs) style guide — Personas

Companion to `glossary.md`. Read that first for the do-not-translate list and the
`Personas` trap. This file is the Czech-specific contract: register, casing,
typography, length, loanwords, the termbase, and the pitfalls a machine
translator reliably gets wrong in this language.

---

## Register & address

**Use formal address (vykání) everywhere: 2nd person plural verb forms, possessive
`váš/vaše/vaši`, never `tvůj/tvoje/tvoji` or singular `ty`-forms.** Personas is a
professional tool addressed to an operator, not a friend — and the vast majority
of already-shipped `cs.json` strings already do this (`Vyberte`, `Zkuste`,
`Otevřete`, `Váš agent je připraven`).

Concrete forms:
- Imperative, formal: `Uložte`, `Zkontrolujte`, `Otevřete`, `Vyberte` — **not**
  `Uluž`, `Zkontroluj`, `Otevři`, `Vyber`.
- Possessive: `váš`, `vaše`, `vaši` — **not** `tvůj`, `tvoje`, `tvoji`.
- Czech is pro-drop: do **not** insert the pronoun `vy` before the verb as
  English MT habitually does. `Máte neuložené změny` is correct and already
  shipped; `Vy máte neuložené změny` is stilted and wrong. The `-te` verb
  ending already carries the formality; only add `Vy` for real contrastive
  emphasis.

**Known drift to fix opportunistically, not bulk-migrate:** the onboarding tour
strings (`onboarding.*`, e.g. `Nastavování tvého agenta...`, `Skenování tvých
desktopových aplikací...`) were written in informal `tykání` and are the one
sanctioned exception in the current codebase — they are NOT a second valid
register, they are legacy drift. New translations there should also be formal;
don't spread the informal pattern to any other section.

## Casing

**Sentence case everywhere.** Capitalize only the first word of a string and
true proper nouns (`Personas`, `Claude`, `GitHub`, `Athena`, `Director` when it
names the specific meta-persona, tier names `Starter`/`Team`/`Builder`). Czech
does not capitalize common nouns the way German does and does not follow
English Title Case — `"Zkopírovat Hlášení Pro Podporu"` is wrong; `"Kopírovat
hlášení pro podporu"` is right (already the shipped form).

**Two different verb forms by UI role — this is the single highest-leverage
casing/form rule in this guide, and it is already the de facto shipped
convention:**

| Surface | Form | Examples (already shipped) |
|---|---|---|
| Buttons, menu items, standalone commands | **Infinitive** | `Uložit`, `Zrušit`, `Smazat`, `Otevřít`, `Kopírovat`, `Duplikovat`, `Potvrdit` |
| Body copy, hints, instructions, empty-state guidance | **Formal imperative** (2nd person plural) | `Vyberte první spuštění k porovnání`, `Zkuste upravit hledání nebo filtry` |

Never use the infinitive in an instructional sentence (`"Vybrat první
spuštění..."` reads like a menu item, not an instruction) and never use the
imperative on a button (`"Uložte"` on a Save button reads like a lecture).

## Typography & punctuation

- **Ellipsis:** always the real glyph `…` (U+2026). The shipped file has
  drifted — plenty of `"Načítání..."` (three ASCII periods) alongside correct
  `"Hledat…"`. Treat every `...` you touch as a bug; never introduce a new one.
- **Quotes:** Czech uses the low-high pair `„…“` — opening `„` (U+201E),
  closing `“` (U+201C, same glyph as an English *opening* curly quote — this
  is the detail machine translators miss). Never use straight ASCII `"…"` and
  never use English-style `“…”` (open-high/close-high). Correct shipped
  example: `Označení „vyřešeno“ znamená…`. Wrong (also present in the file,
  don't repeat it): `„{name}\"` — a Czech open paired with an ASCII close.
- **Dash:** real em dash `—` with a space on each side, e.g. `Puls flotily —
  {running} běží`. Never the ASCII double-hyphen `--` (74 instances of this
  currently in `cs.json` — all are bugs, not house style).
- **Decimal separator:** comma, not period — `0,01`, not `0.01`, in any
  hand-written example/placeholder text. (Real numbers are formatted at
  runtime per the glossary — this only applies to literal strings like hint
  examples: `"0,01 $ a více"`.)
- **Non-breaking space:** insert ` ` (NBSP) between a number and its unit
  (`5 min`, `6 h`, `100 %`) so the unit never wraps to its own
  line. Also conventional after one-letter prepositions/conjunctions (`k`,
  `s`, `v`, `z`, `o`, `u`, `a`, `i`) — apply it where trivial, don't hold up a
  translation chasing every instance.
- No RTL marks, no ZWNJ, no full-width punctuation — none of that applies to
  Latin-script Czech.

## Length discipline

Czech is pro-drop and article-free, so plain sentences often run close to
English length or even shorter. Where it runs **longer** is noun phrases with
case endings and compound technical terms — expect **+10–15%** there, more for
genitive-plural constructions (`{count} agentů zkontrolováno`).

- **Buttons/badges/narrow columns:** use the shortest correct infinitive.
  Prefer a single word over a phrase (`Obnovit` not `Obnovit data`). If a
  literal translation would wrap, drop a qualifier before you abbreviate —
  Czech has no acceptable UI abbreviation convention like English "Config" or
  "Msg"; a wrapped button is still a smaller bug than an unreadable
  abbreviation.
- **Tab labels:** this is where borrowing pays off — `Lab` stays `Lab`
  (`Laboratoř` would not fit a tab), `Cockpit`/`Kokpit` stays short, `Přehled`
  is already as short as `Overview`.

## Loanword policy

Be decisive — this is the #1 source of translator-to-translator drift.

**Borrow as-is (raw English spelling, no declension):**
`workflow` (the automation-builder term, used throughout that surface — do
not force `pracovní postup`, it's clunky and breaks n8n-adjacent branding),
`Lab` (tab label only — spell out `laboratoř` if it ever appears in a full
sentence), tier **names** `Starter`/`Team`/`Builder` (the word "tier" itself
is translated, see termbase), plus everything on the glossary's do-not-translate
list (API, CLI, JSON, cron, webhook, SQLite, MCP, npm, git, KPI, LLM, …).

**Naturalize — Czech spelling, full declension, treated as ordinary Czech
nouns:** `persona` (feminine, declines like `žena`: persona/persony/personě…,
gen. pl. `person`), `agent` (masculine animate, long-established Czech word,
declines normally), `konektor` (Czech spelling, not "connector"), `monitor`,
`kokpit` (Czech spelling — the shipped file has one instance of raw
`"Cockpit"`; that's wrong, fix it to `Kokpit` on next touch), `flotila`.
These are loanwords Czech absorbed decades ago; typing them in English
spelling or leaving them undeclined reads as a translation error, not as
authentic register.

**Prefer the fully native Czech word (no loanword available or needed):**
`schopnost` (capability), `přihlašovací údaje` (credential), `trezor` (vault),
`recept` (recipe), `šablona` (template), `spouštěč` (trigger), `spuštění`/`běh`
(execution/run), `plán` (schedule), `nasazení` (deployment), `(samo)oprava`
(healing), `návrh` (draft), `povýšit` (promote), `kontrola` (review),
`schválení` (approval), `událost` (event), `upozornění` (alert), `řetězec`
(chain), `dovednost` (skill), `úroveň` (tier, the word — not the tier names),
`dvojník` (twin), `ředitel` (director, as a role/common noun), `mozek` (brain).

## Termbase

| English | Czech | Note |
|---|---|---|
| persona | persona | Naturalized loanword, feminine, declines like `žena` (gen. pl. `person`). The app's central noun — see the `Personas` trap in glossary.md; this row is the lowercase common-noun sense only. |
| agent | agent | Distinct word from `persona` by construction — no collision risk in Czech. Used near-synonymously with persona in older surfaces (sidebar nav `Agenti`, `Smazat agenta`); in newer copy, the runtime actor. Keep both spellings/declensions native (agent/agenta/agentů…). |
| capability | schopnost | Not `funkce` (=feature) and not `dovednost` (=skill, a different term below). A contract the persona fulfils. |
| connector | konektor | Naturalized spelling (not "connector"). The *type*; the bound instance is a credential. |
| credential | přihlašovací údaje | Always plural phrase, matches shipped usage everywhere. Not `certifikát` (certificate — false friend). |
| vault | trezor | "Safe/strongbox" — matches the metaphor, already the sole shipped rendering. Not `sklep` (cellar) or `sklad` (warehouse). |
| recipe | recept | Literal culinary word — reads naturally in Czech and is already shipped consistently. Distinct from `šablona` (template). |
| template | šablona | Distinct from `recept`. A prebuilt persona adopted as-is; a recipe is parameterized. |
| trigger | spouštěč | Native agent-noun ("the thing that starts it"). Verb form for "to fire/trigger" is `spustit`. |
| execution | spuštění | The formal record — one run with inputs/output/cost/status. Used as the tab/section noun (`Spuštění` = Executions). |
| run | spustit (verb) / běh (casual noun) | `spuštění` and `běh` both exist in shipped copy; use `spuštění` as the primary noun (matches `execution`), `běh` only in short casual phrases (`poslední běh`). Verb is always `spustit`. |
| schedule | plán | Also used in the fixed phrase `Plán vývoje` (roadmap) — context disambiguates; don't avoid `plán` for schedule because of that collision. |
| deployment | nasazení | Verb `nasadit`. |
| healing | (samo)oprava | Use `samooprava` for the feature/section name, `oprava` for one instance/action (`AI oprava zahájena`, `Pokus o samoopravu č. {count}`). Never a medical word like `léčba`/`uzdravení`. |
| fleet | flotila | Naturalized loanword already standard in Czech (aviation/military). Not `stádo` or a literal "set of agents" unless space is desperate. |
| draft | návrh | Also the generic Czech word for "proposal" — fine, context (persona builder) disambiguates. |
| promote | povýšit | Distinct from `zveřejnit` (publish to a public gallery — a different action elsewhere in the app). "Promote a draft to live" = `povýšit`. |
| review | kontrola | **Decisive call — deprecate the competing `revize` you'll see in one Monitor tab label.** `kontrola`/`kontroly` is the term used everywhere else (`Ruční kontrola` = the sidebar nav item, `Kontroly` = quick-response panel header) and is the one to use in all new copy. |
| approval | schválení | Paired verb `schválit`, status `schváleno`. |
| lab | Lab | Borrowed, short tab label (see Loanword policy). If it ever needs a full sentence, spell out `laboratoř`. |
| overview | přehled | Simple, already fully consistent across the codebase. |
| monitor | monitor | Naturalized, identical spelling — the live view of running personas. |
| cockpit | kokpit | Naturalized Czech spelling (an established loanword in Czech, e.g. aviation/gaming). The one shipped instance spelled `"Cockpit"` (raw English) is wrong — use `Kokpit` going forward. |
| event | událost | |
| alert | upozornění | Reserve `varování` specifically for the "warning" severity token — don't use it as the generic word for `alert`. |
| chain | řetězec | Already consistent (`řetězec`, `kaskáda řetězce`). |
| workflow | workflow | **Borrowed, not translated** — see Loanword policy. Do not write `pracovní postup`. |
| skill | dovednost | Distinct from `schopnost` (capability) — the codebase already keeps these two apart; preserve that. |
| tier | úroveň | Translate the word; tier **names** (`Starter`, `Team`, `Builder`) stay in English per glossary. |
| twin | dvojník | Already shipped (`Vytvořit nového dvojníka`). |
| director | ředitel | Common-noun/role sense (`verdikt ředitele`). If a string names the specific meta-persona as a proper name (like naming `Athena`), leave it capitalized `Director` and untranslated — same judgment call as the `Personas` trap: role vs. proper name. |
| brain | mozek | Metaphor lands fine in Czech (already shipped: `Mozek Athena`). The Twin plugin's own "Brain" tab is currently an untranslated gap — close it with `Mozek`, not `Brain`. |

## Pitfalls

1. **Missing the Czech "few" plural bucket.** This i18n system only exposes
   `_one`/`_other` for cs (no `_few`), but Czech grammar wants three cardinal
   forms (1 / 2–4 / 5+). Two house patterns already solve this — use them,
   don't invent a third:
   - For descriptive/longer strings, write the `_other` value in the
     **genitive plural** (the 5+ form) — it reads acceptably down to count=2,
     e.g. `{count} nových zpráv`, `{count} agentů zkontrolováno`.
   - For short confirm-dialog/button labels where a 2–4 count is common,
     use the established parenthetical shorthand that packs both endings,
     e.g. `Smazat {count} agent(y/ů)`, `Smazat {count} návrh(y/ů)`.
   Never pick the *nominative*-plural-only form (`agenti`, `návrhy`) for
   `_other` — it's flatly wrong once count reaches 5.

2. **Gender agreement across a placeholder.** English adjectives don't
   change with the noun's gender; Czech ones do. If a template like `"{name}
   je nastaven"` can receive a feminine noun (e.g. a persona name used as
   the subject), the adjective breaks (`nastaven` → needs `nastavena`).
   Check what grammatical gender the placeholder's referent actually has —
   don't default to masculine because that's what a naive MT does.

3. **Explicit "Vy" as calque of English subject pronouns.** Wrong:
   *"Vy máte neuložené změny, které budou ztraceny."* Right (shipped):
   *"Máte neuložené změny, které budou ztraceny."* Czech is pro-drop; the
   `-te` verb ending already carries "formal you". Inserting the pronoun
   every time reads like a bad dub.

4. **ASCII ellipsis/dash/quotes as a typing-habit calque.** Wrong:
   *"Načítání..."*, *"...zkontrolujte připojení"*, *""{name}""*. Right:
   *"Načítání…"*, *"— zkontrolujte připojení"*, *"„{name}“"*. See Typography
   above — these are the three most common single-character bugs in the
   existing file; don't add more of them.

5. **Overliteral preposition calques.** English "for" is not always `pro`.
   Wrong: *"Rozvrh pro tuto personu"* (stiff, sounds translated). Right:
   *"Plán této persony"* (genitive construction — the idiomatic Czech way to
   express possession/association, already the dominant pattern in shipped
   copy). When a literal `pro X` reads clunky, try the genitive first.

6. **Passive-voice calque.** English loves the passive ("X was installed",
   "Y is required"); a literal Czech passive (`Y je vyžadováno`) reads
   bureaucratic. Prefer the reflexive-passive construction already shipped:
   *"Aktualizace se nainstaluje, až dokončíte {count} běžících úloh"* — not
   *"Aktualizace bude nainstalována, jakmile…"*.
