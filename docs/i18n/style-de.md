# German (de) style guide — Personas Desktop

Companion to `docs/i18n/glossary.md`. Read that first. This file is the
locale-specific contract: register, casing, typography, length, loanwords,
the full termbase, and the pitfalls a machine translator (or a careless human)
will hit in German specifically. When in doubt, this file wins over instinct;
if it doesn't cover a case, extend it and keep going — don't guess silently.

Evidence base: `src/i18n/locales/de.json` as of 2026-07-09 (~11,500 keys,
~75% already translated). About a quarter of values are still raw English —
that's the gap this effort closes, not a style precedent. The rest of this
file is derived from the **shipped, translated three-quarters**, reconciled
against the glossary where the shipped file itself disagrees with itself.

---

## Register & address

**Use formal `Sie` / `Ihr` everywhere — no exceptions, including companion
and onboarding copy.** Verb form: 2nd person plural/formal (`Sie speichern`,
`Sie können`, `Ihre Daten`, `haben Sie`). Never `du`/`dein`/`dich`.

Justification: Personas is a professional developer tool addressed to an
operator, and the glossary is explicit that this locale distinguishes formal
address and must use it.

> **Known drift to fix, not imitate:** the shipped file currently mixes in
> `du`-form in Athena/companion chat strings, onboarding tour copy, and a
> few twin-identity strings (e.g. `chrome.tray_acceptance_pending`,
> `athena.guide_trig_intro`, `onboarding.tour_intro_heading`,
> `twin.identity.bioRefineHint`). This happened because those surfaces read
> conversationally and a translator reached for the friendlier pronoun. It is
> wrong for this product — a companion giving the operator instructions is
> still an operator-facing professional tool, not a consumer chat app.
> Any string you touch in those areas: convert `du`-form to `Sie`-form in the
> same edit. Don't add new `du`-form copy anywhere.
>
> Wrong: `"Bevor du loslegst"` · `"Was weißt du noch über mich?"`
> Right: `"Bevor Sie loslegen"` · `"Was wissen Sie noch über mich?"`

---

## Casing

**Sentence case for everything** — capitalize only the first word of a
sentence/label and proper nouns. Do not mirror English UI Title Case
(`"Select Persona"` → `Persona auswählen`, not `Persona Auswählen`).

German orthography separately requires **capitalizing every common noun**,
regardless of sentence position — this is not a style choice, it's spelling.
`Alle Personas`, `Zugangsdaten hinzufügen`, `Fähigkeiten wählen` are all
correctly capitalized nouns inside otherwise-sentence-case strings; don't
lowercase them to "look more sentence-case" — that would just be wrong German.

This intersects the glossary's **Personas trap** directly: because German
nouns are always capitalized, `Alle Personas` is capitalized *for grammar
reasons*, not because the translator wrongly thinks "Personas" is the brand.
Judge every `Personas`/`Persona` occurrence by the call site's meaning per
the glossary rule — capitalization alone tells you nothing in German, since
both the brand and the correctly-translated common noun are capitalized.

Buttons: short imperative infinitives, not full sentences — `Speichern`,
`Abbrechen`, `Erneut versuchen`, not `Sie sollten speichern` or
`Das Speichern durchführen`. A button that wraps to two lines is a bug —
see Length discipline below for how to keep German short enough.

---

## Typography & punctuation

- **Ellipsis**: real `…` (U+2026), never three periods. The shipped file is
  inconsistent today (460 literal `...` vs 215 real `…`) — always use `…`
  going forward; fix `...` to `…` in any string you touch.
  Wrong: `"Laden..."` · Right: `"Laden…"`
- **Quotes**: German low-high pair `„…"` — opening `„` (U+201E, sits on the
  baseline), closing `"` (U+201C, sits at cap-height). Never straight `"…"`
  and never the French `«…»` (that's for fr, not de).
  Wrong (straight closing quote, seen repeatedly in the shipped file due to
  copy-paste): `"Verbessere Persona „{name}\""`
  Right: `"Verbessere Persona „{name}""`
- **Dashes**: em dash `—` with a space on both sides for parenthetical
  asides (`"Läuft — kein Eingriff nötig"`); this is already the dominant
  shipped pattern (446 correct vs 91 legacy double-hyphen `--`). Fix `--` to
  `—` in any string you touch; don't introduce new `--`.
- **Percent and units**: put a **non-breaking space** before `%` and before
  unit abbreviations per Duden convention — `50 %`, `15 GB`, `10 Min.`. The
  shipped file is split between `50%` (no space) and `5 %` (space); use the
  spaced form going forward. In JSON this is the ` ` character or a
  literal U+00A0 byte, not a regular space (a regular space allows an
  ugly line-break right before the `%`).
- **ß vs ss**: use `ß` after long vowels/diphthongs per standard (non-Swiss)
  German orthography — `Straße`, `außerdem`, `groß`. Never substitute `ss`
  (that's the Swiss German convention; this locale is `de`, not `de-CH`).
- **Compound nouns**: German fuses concepts into one word
  (`Zugangsdaten-Vermittler`, `Kettenkaskade`, `Fußleisten-Controller`). Use a
  hyphen when fusing a borrowed English term with a German noun
  (`Skill-Bibliothek`, `Fleet-Puls`) — don't leave a bare space
  (`Skill Bibliothek` is wrong German).
- **RTL marks / ZWNJ / full-width punctuation**: not applicable to German
  (Latin script, no bidi, no width-variant punctuation). Nothing to do here.
- Numbers, dates, currency: never hardcode — always left to runtime
  formatting per the glossary. This applies unchanged to German.

---

## Length discipline

German commonly runs **20–35% longer than English** for the same meaning
(compounding, grammatical gender/case endings, formal-address verb forms).
Budget for it explicitly:

- **Buttons / badges / tab labels**: prefer the shortest correct idiom over
  the most literal translation. `Speichern` not `Änderungen speichern` on a
  button that already sits next to a form. `Prüfung` (not `Überprüfung`) is
  acceptable *specifically* in tab strips and count badges where horizontal
  space is the binding constraint — see the Termbase note on **review**.
- **Drop redundant articles and possessives** in labels where English also
  drops them: `Beschreibung` not `Die Beschreibung`, `Modell` not
  `Das Modell`.
- **Prefer a compound noun over a prepositional phrase** when both are
  correct German: `Zugangsdaten-Tresor` beats `Tresor für Zugangsdaten` in a
  section header; save the prepositional form for body copy where the
  extra width is free.
- **Borrow instead of translating a multi-syllable compound** when the
  glossary allows it (Lab, Cockpit, Dashboard, Trigger, Workflow) — this is
  as much a length decision as a loanword decision; a translated compound
  like `Auslösemechanismus` for "trigger" would be both wrong-register and
  too long for a tab label.
- If a string still doesn't fit after applying the above, flag it in the
  run's review notes rather than truncating silently — a silently truncated
  German string reads as a typo, not a design choice.

---

## Loanword policy

Decisive, per-term. English tech vocabulary is deeply naturalized in German
developer tooling — over-translating reads as try-hard, but under-translating
leaves the UI feeling untranslated. The line:

**Stays borrowed (do not invent a German word):**
`Trigger` (der Trigger, die Trigger) · `Workflow` (der Workflow) ·
`Dashboard` · `Lab` (tab label; expand to `Labor` only in full-sentence body
copy if it reads better, but default to `Lab`) · `Cockpit` · `Director`
(the meta-persona feature name — treat as a proper feature name, like a job
title that stays English, not a common noun) · `Twin` · `Skill` (see below —
kept borrowed specifically to avoid colliding with **capability**) ·
`Monitor` (as in "Persona-Monitor") · `Recipe`'s sibling **rezept** is
translated (see Termbase) but plugin/product surface names generally lean
borrowed: `Twin`, `Brain`-as-plugin-name in menus, `Cockpit`.

**Always translated (native German word, no exceptions):**
`persona` → Persona (already a native German loanword, not a fresh borrow —
see Termbase) · `agent` → Agent · `capability` → Fähigkeit · `connector` →
Konnektor · `credential` → Zugangsdaten · `vault` → Tresor · `recipe` →
Rezept · `template` → Vorlage · `execution` → Ausführung · `run` → Lauf ·
`schedule` → Zeitplan · `deployment` → Bereitstellung · `healing` → Heilung /
Selbstheilung · `draft` → Entwurf · `promote` → veröffentlichen · `review` →
Überprüfung · `approval` → Genehmigung · `event` → Ereignis · `alert` →
Warnung · `chain` → Kette · `workflow`'s parent concept `fleet` → Flotte ·
`overview` → Übersicht · `tier` → Stufe (tier **names** — Starter/Team/
Builder — stay English per the glossary).

**Do NOT translate** (per glossary §1, unchanged for German): brand names,
technical identifiers (API, CLI, JSON, HTTP, cron, webhook, SQLite, MCP,
OAuth, JWT, SDK, npm, git, regex, UUID, KPI, LLM, CPU/GPU/RAM), placeholders,
emoji, `·`, URLs, code identifiers, enum/status codes.

The rule of thumb when a new borderline term shows up: if the English word is
already what a German developer would say out loud at a standup (Workflow,
Trigger, Dashboard, Deployment-Pipeline), borrow it. If it's a product
concept a non-developer user configures (persona, connector, credential,
recipe), translate it — those are exactly the nouns a German-speaking
*user*, not just a developer, needs to read comfortably.

---

## Termbase

Every term from `glossary.md` §2, with the German rendering actually shipped
(or the decisive fix where the shipped file contradicted itself).

| English | German | note |
|---|---|---|
| **persona** | Persona / Personas | Native German loanword (psych./everyday usage), not a fresh borrow — grammatically feminine, regular plural `Personas`. This is the word that triggers the Personas-trap capitalization confusion (see Casing) — judge by meaning, not case. |
| **agent** | Agent / Agenten | Masculine, `der Agent`, plural `Agenten`. Grammatically and lexically distinct from Persona — never use one for the other even where English uses them near-interchangeably. |
| **capability** | Fähigkeit / Fähigkeiten | Not "Fertigkeit", not "Feature". **Must not collide with skill** — see Pitfalls. |
| **connector** | Konnektor / Konnektoren | Not "Plugin", not "Verbindung" (that's the bound instance / credential). |
| **credential** | Zugangsdaten | Collective/plural-leaning noun, used unchanged for a single credential or many (`ein Satz Zugangsdaten`, `Zugangsdaten hinzufügen`). Not "Zertifikat". |
| **vault** | Tresor | Well-established (36+ shipped instances). Not "Keller", not "Lager", not "Safe" (Tresor already *is* the German safe-word). |
| **recipe** | Rezept | Direct culinary-metaphor translation reads naturally in German and is already shipped consistently. |
| **template** | Vorlage | Distinct from Rezept — a Vorlage is adopted as-is; a Rezept is parameterized. |
| **trigger** | Trigger | Borrowed — fully naturalized German tech noun, `der Trigger`, plural `die Trigger` (no -s). Do not use "Auslöser" as the primary term (it appears nowhere as a standalone noun in the shipped file outside compound contexts like `Kettenauslöser`); reserve "Auslöser" for compounds where "Trigger" would double up awkwardly (`Ketten-Trigger` is fine too — either is acceptable in a compound, but the standalone noun is always `Trigger`). |
| **execution** | Ausführung | `die Ausführung`, plural `Ausführungen`. |
| **run** | Lauf / Läufe | Colloquial noun for one execution; verb is `ausführen` / `laufen`. Keep noun/verb pairing consistent with Ausführung — don't say "Run" borrowed. |
| **schedule** | Zeitplan | Also used adjectivally in compounds: `Zeitplan-Trigger`, `geplanter Lauf`. |
| **deployment** | Bereitstellung | `die Bereitstellung`; verb `bereitstellen`. Well-established, high shipped confidence. |
| **healing** | Heilung / Selbstheilung | Never a medical "Heilmittel/Kur" framing — this is automated remediation, keep it mechanical: `Selbstheilung` in headers, `Heilung` in shorter labels. |
| **fleet** | Flotte | **Fix needed**: the shipped file currently mixes `Flotte` (prose: "wie Ihre Flotte aussehen würde") with borrowed `Fleet` in compact chip labels (`Fleet-Puls`, `Fleet inaktiv`). Standardize on `Flotte` everywhere going forward, including compounds (`Flottenpuls` not `Fleet-Puls`) — do not perpetuate the split. |
| **draft** | Entwurf / Entwürfe | Well-established (`Entwurf akzeptieren`, `Entwurf akzeptiert`). |
| **promote** | veröffentlichen | Draft → live. Glossary says "publish/activate, not advertise" — `veröffentlichen` is the shipped choice in auto-publish contexts (`Auto-Veröffentlichung`). `befördern` (literally "promote" as in a job) also appears once in evolution copy and is an acceptable synonym for the specific "a variant got promoted for outperforming" sense, but default to `veröffentlichen` for the generic draft→live action. |
| **review** | Überprüfung | Canonical noun. `Prüfung` is an accepted **shortening**, not a separate term, for tab strips / count badges where width is tight (`monitor.reviews` = "Prüfungen" as a tab label is correct; a full sentence describing the same concept should say `Überprüfung`). Don't let `Prüfung` drift into meaning "system check" — that's a different concept (`Systemprüfung`). |
| **approval** | Genehmigung | Verb `genehmigen` (`Genehmigen` button). Keep paired with Überprüfung — an approval is the outcome of a review. |
| **lab** | Lab | Borrowed, kept short for the tab label (`tab_lab: "Lab"`). Do not expand to "Labor" in UI chrome; reserve "Labor" (if ever) for descriptive body prose only. |
| **overview** | Übersicht | The dashboard route. `Dashboard` (borrowed) is an accepted synonym only in generic/error-boundary fallback copy ("Zum Dashboard zurückkehren") — the feature/route itself is always `Übersicht`. |
| **monitor** | Monitor | Borrowed — German already uses "Monitor" for a live oversight view (as well as for a screen), context disambiguates. `Persona-Monitor` is the shipped compound. |
| **cockpit** | Cockpit | Borrowed, per glossary "translate or borrow; keep short" — German also uses "Cockpit" natively for a control-surface metaphor, so borrowing is the natural choice, not a fallback. |
| **event** | Ereignis / Ereignisse | Well-established, very high shipped confidence. |
| **alert** | Warnung / Warnungen | Not "Alarm" (too fire-alarm literal for a software alert). |
| **chain** | Kette / Ketten | `Kettenkaskade` for "chain cascade". Distinct from **workflow**. |
| **workflow** | Workflow | Borrowed — extremely well-established (93+ shipped instances), do not translate to "Arbeitsablauf" except possibly in a glossary/help-text definition the first time the term is introduced. |
| **skill** | Skill | **Fix needed — deliberately kept borrowed, distinct from capability.** The shipped file today translates `common.skills` as "Fähigkeiten" (colliding with capability) while `agents.*.skill_*` (the Claude Skills feature: `.claude/skills`, Skill-Bibliothek, Skill installieren) keeps "Skill" borrowed. Going forward: **always** render skill as `Skill` / `Skills` (borrowed) to keep it visually and lexically distinct from `Fähigkeit`/`Fähigkeiten` (capability). Fix `common.skills: "Fähigkeiten"` to `"Skills"` the next time that key is touched. |
| **tier** | Stufe | The word only — tier *names* (Starter, Team, Builder) stay English per glossary. `Preis-/Funktionsstufe` acceptable in a fuller explanatory sentence. |
| **twin** | Twin | Borrowed — product/plugin surface name, glossary explicitly allows borrowing and the shipped file borrows it throughout (`Twin erstellen`, `Aktiven Twin auswählen`). |
| **director** | Director | Borrowed — treated as the meta-persona's proper feature name/title, not a common noun (`tab_director: "Director"`, `panel_title: "Director"`). Do not translate to "Direktor" — that would misread as a literal job title rather than the feature name. |
| **brain** | Wissen(sspeicher) in descriptive copy; Langzeitgedächtnis / Gedächtnis for the memory-metaphor sense; `Brain` borrowed only where a very short plugin-progress tab label is unavoidable | Three registers, pick by context — see Pitfalls for why a single literal translation doesn't work here. Never `Gehirn` in UI chrome (reads clinical/childish for a knowledge-base feature); `Gehirn` is acceptable only in a knowingly playful marketing aside, never in product chrome. |

---

## Pitfalls

Concrete errors seen in the shipped file or predictable from machine
translation into German. Fix these on sight in any string you touch.

1. **Capability/skill collision (the biggest one).** `common.skills` is
   translated as `"Fähigkeiten"` — the exact same word already used for
   `capability`. A user reading "Fähigkeiten" in one menu and "Skill" in
   another has no way to tell these are different concepts.
   Wrong: `"skills": "Fähigkeiten"` (next to `"capabilities": "Fähigkeiten"`)
   Right: `"skills": "Skills"` — keep skill borrowed everywhere, per Termbase.

2. **Mismatched German quote glyphs from copy-paste.** Opening `„` typed
   correctly, closing quote left as a straight `"` instead of `"`.
   Wrong: `„{name}\"` · Right: `„{name}"`

3. **False friend: "Fleet" as a false cognate temptation.** A machine
   translator sees "fleet" and may reach for `flink`/`schnell` (fleet =
   swift, in English poetry) — wrong sense entirely here; this "fleet" is a
   collective noun (a fleet of ships/agents). Always `Flotte`, never a speed
   adjective.

4. **Over-literal "healing" → medical framing.** A naive translation drifts
   toward `Heilmittel`, `Behandlung`, `Therapie` — all clinical, all wrong
   register for automated remediation of a failing persona. Use
   `Selbstheilung`/`Heilung` and keep any surrounding copy mechanical
   ("wird automatisch behoben", not "wird geheilt von").
   Wrong: `"Die Persona wird therapiert"` · Right: `"Automatische Heilung läuft"`

5. **Literal "brain" → `Gehirn`.** Reads like a children's app or a organ
   donor screen, not a knowledge-base feature for a developer tool. Pick the
   register from the Termbase row (Wissen / Langzeitgedächtnis) instead of
   translating the body part.
   Wrong: `"Das Gehirn des Directors"` · Right: `"Langzeitgedächtnis des Directors"`

6. **Dropping the formal register inside conversational/companion strings.**
   The single most common register slip in this locale: a translator hits a
   friendly, chatty English sentence ("Let's do the intake — ask me a few
   things…") and reflexively reaches for `du` because the tone feels casual.
   The tone can stay warm; the pronoun stays formal.
   Wrong: `"Lass uns das Intake machen — frag mich ein paar Dinge…"`
   Right: `"Lassen Sie uns das Intake machen — fragen Sie mich ein paar Dinge…"`
