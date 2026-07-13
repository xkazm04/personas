# Personas — Spanish (es) style guide

Companion to `docs/i18n/glossary.md`. That file says *what things are called*;
this file says *how Spanish says it*. Read both before translating. This guide
is the single source for the `es` locale's `## Termbase` (glossary.md §2 asks
each locale to keep its own).

---

## Register & address

**Use formal `usted` throughout — everywhere. No exceptions.**

Conjugate imperatives and verbs for `usted` (*guarde*, not *guarda*; *seleccione*,
not *selecciona*; *ejecute*, not *ejecutes*), and use formal possessives/object
pronouns (*su*, not *tu*; *le*, not *te*). Never *tú*.

**Justification (one sentence):** Personas is a professional operator tool
addressed to a developer running production automations, and both
`glossary.md` §3 ("Never *du/ty/tu*") and the format contract for this run
mandate formal address for exactly that reason — treat it as non-negotiable.

**Heads-up for every translator reading the existing file for voice cues:** a
meaningful share of the already-shipped `es.json` — especially `home.*`
(onboarding) and `monitor.*` — is written in informal *tú*: `"Elige tu rol"`,
`"Pruébalo ahora"`, `"Escribe tu respuesta…"`, `"Vuelve a ejecutar ejecuciones
fallidas en bloque"`. **Do not copy that pattern.** It is legacy drift from
before this register decision was codified, not a precedent. Every *new* key
you write — including keys that live in a section full of old *tú* strings —
must use *usted*. If you're touching a file for another reason and trip over a
*tú* string, fix it opportunistically (per `CLAUDE.md`'s fix-as-you-touch
policy); don't feel obliged to bulk-migrate it.

Quick conversion table for the forms you'll write most:

| Function | *tú* (wrong, legacy) | *usted* (right, use this) |
|---|---|---|
| Imperative, -ar verb | Guarda, Elige, Prueba | Guarde, Elija, Pruebe |
| Imperative, -er/-ir verb | Ejecuta, Escribe, Añade | Ejecute, Escriba, Añada |
| Possessive | tu rol, tus cambios | su rol, sus cambios |
| Object pronoun | te necesita, dile | le necesita, dígale |
| Reflexive command | Fíjate, Date cuenta | Fíjese, Dese cuenta |

Buttons and infinitive labels (*Guardar*, *Cancelar*, *Ejecutar*) are
register-neutral in Spanish and need no change — the ambiguity only appears in
conjugated imperatives and possessives, so that's where to be careful.

---

## Casing

**Sentence case everywhere.** Capitalize only the first word of a string and
proper nouns. Never import English Title Case into a multi-word label.

- Right: `"Monitor de personas"`, `"Todas las personas"`, `"Revisión manual"`
- Wrong: `"Monitor De Personas"`, `"Todas Las Personas"`, `"Revisión Manual"`

**The Personas trap applies to casing, not just to whether you translate the
word.** The shipped file already has a live bug that is the exact case this
rule exists to prevent: `common.all_personas` is `"Todas las Personas"` —
capital P, mid-sentence, as if it were the brand. It isn't: "all personas" here
counts the user's configured agents, the common noun. It should read `"Todas
las personas"`. Don't repeat this — when `persona`/`personas` is doing common-noun
work, it is never capitalized except at the start of a sentence, regardless of
how the English source happened to be cased.

**Proper nouns that DO stay capitalized:** `Personas` (the brand), `Claude`,
`Lab`, `Cockpit`, `Twin`, `Brain`, `Director` when it names the meta-persona
feature (see Termbase) — these are product-surface names, not descriptions.

**Buttons: short imperative, `usted`-conjugated, 1–3 words, no wrap.** A button
that wraps to two lines is a bug regardless of how correct the Spanish is —
see Length discipline for how to shorten.

---

## Typography & punctuation

- **Ellipsis:** always the single glyph `…` (U+2026). Never three periods `...`.
  The shipped file is inconsistent today (`"Cargando..."` next to `"cargando
  historial anterior…"`) — that inconsistency is legacy drift, not a style
  choice; always write `…`.
- **Quotation marks:** use guillemets `«…»` as the primary Spanish quote glyph
  (the RAE-prescribed default); if you need a *nested* quote inside a quote,
  use curly `“…”` for the inner pair. Never ASCII straight quotes `"…"` — the
  shipped file has `"coincidan con \"{query}\""`, which is an escaping
  necessity for JSON, not a typographic choice; the *character* the user sees
  should be `«{query}»`.
- **Dashes:** use a real em dash `—` for asides, source attributions, and list
  separators. Never the ASCII double-hyphen `--`. Shipped file has both
  (`"-- verifica tu conexión"` vs `"— inicio de la conversación —"`) — treat
  every `--` you encounter as a bug to fix if you're touching that string,
  and never introduce a new one.
- **Inverted marks `¿ ¡`:** required at the *start* of a full question/exclamation
  sentence, not just the end (`¿Guardar cambios?`, not `Guardar cambios?`).
  But per the format contract, error copy stays calm — reserve `¡…!` for
  genuine short celebratory confirmations, if any exist at all; default to no
  exclamation mark in status/error copy, matching what's already shipped
  (`"Éxito"`, not `"¡Éxito!"`).
- **No non-breaking space rule for Spanish** (unlike French before `: ! ? ; »`).
  Don't insert one before `¿ ¡ : %` — Spanish typesetting doesn't need it.
  `"{pct}%"` (no space) is already correct in the shipped file; keep it.
- **Never hardcode a formatted number.** The shipped file has
  `"Traza incompleta: {count} tramo eliminado (límite: 10.000)"` — the
  `10.000` is a hardcoded Spanish-style thousands separator baked into the
  *source string itself*. That's a bug: any number that isn't the `{count}`
  placeholder must come from a runtime formatter, never be typed into the
  JSON value as a literal.
- **Placeholders are frozen, but Spanish grammar may move them.** `{count}`,
  `{name}`, etc. keep their exact ASCII spelling in every string — never
  translate or recase the token itself — but you may reorder around Spanish
  word order freely, e.g. `"{count} tool calls"` → `"{count} llamadas a
  herramienta"` keeps `{count}` in the same slot, while a string that needs
  the placeholder at the end in Spanish may move it there.
- **No RTL marks, no full-width punctuation, no ZWNJ** — none of these apply
  to Spanish (Latin script, LTR, standard ASCII-width punctuation).

---

## Length discipline

Spanish typically runs **15–25% longer** than English for UI prose (more for
strings that lean on articles + prepositions + verb inflection: "the
execution failed" → "la ejecución falló" is close, but "review" → "revisión"
alone is already 60% longer character-for-character). Budget for this in any
column, badge, or button you write.

Concrete tactics, in order of preference:

1. **Drop the pronoun.** Spanish is pro-drop — `"Guarde"` says everything
   `"Guarde usted"` would, more concisely and more naturally. Never insert
   `usted`/`su` into a short label just to "mark" the register; the verb
   ending already carries it.
2. **Prefer the bare infinitive for a pure action label**, reserving the
   conjugated `usted` imperative for sentences that need a real subject/object
   (`"Guardar"` for a toolbar button; `"Guarde los cambios antes de salir"` for
   a full sentence). Both are formal-register-safe; the infinitive is just
   shorter and is what the shipped file already does for most buttons.
3. **Collapse two-word English compounds to one Spanish word where one exists**
   (`"self-repair"` → `"autorreparación"`/`"sanación"`, not `"auto reparación"`).
4. **For a genuinely long term in a narrow column (tabs, chips, table headers),
   prefer the short/borrowed form over the fully-translated phrase** — this is
   why `Lab`, `Cockpit`, `Twin`, `Brain` stay borrowed short labels (see
   Termbase) rather than becoming `Laboratorio`, `Cabina de mando`, `Gemelo
   digital`, `Cerebro` in a tab strip; save the fully-translated phrase for
   subtitles and body copy where there's room.
5. **`flujo de trabajo` (workflow) and `flujo de trabajo` compounds are the
   single worst offender for overflow** — it's 2.4x the length of "workflow".
   In a narrow context where "workflow" alone would appear as a lone noun
   (not "the workflow failed"), it's acceptable to shorten to `flujo` if the
   surrounding UI already disambiguates (a tab under a section clearly about
   automation); don't do this in prose or in the first mention on a page.
6. **If a translated button/badge would run past ~140% of the English
   character count, stop and look for a shorter synonym before shipping it** —
   don't let it wrap. A wrapped button is a worse bug than an imperfect but
   short word choice.

---

## Loanword policy

Decisive, not a spectrum — pick one column and stay there.

**Stays in English (assimilated Spanish tech register — do not translate):**
`API`, `CLI`, `JSON`, `YAML`, `HTTP(S)`, `cron`, `webhook`, `SQLite`, `MCP`,
`A2A`, `P2P`, `ONNX`, `TTS`, `OAuth`, `JWT`, `SDK`, `npm`, `git`, `regex`,
`UUID`, `SSE`, `CORS`, `KPI`, `LLM`, `GPU`/`CPU`/`RAM`, `BYOM` — per
glossary.md §1, plus these product-register calls: `plugin` (pl. `plugins`),
`token` (pl. `tokens`), `pipeline`, `backend`, `frontend` — all four are
already fully assimilated in Spanish developer usage and read more naturally
borrowed than forced into a native calque.

**Gets a native Spanish word (do not borrow):** `dashboard` → **panel**; `log`
→ **registro**; `trace`/`span` → **traza**/**tramo**; `bug` → **error**
(professional register — skip the slang); `toast` (notification) →
**notificación**; `badge` → **insignia**. These already have clean,
established Spanish tech equivalents in the shipped file — don't reach for
the English word out of habit.

**Product-surface proper names (borrowed, capitalized, treated like a brand,
not a common noun):** `Lab`, `Cockpit`, `Twin`, `Brain`. Glossary.md flags all
four as "known-hard… metaphors first, nouns second" — the decisive call here
is: when the string is *naming the feature/tab*, keep the English word
capitalized exactly like a brand name; when the string is *explaining the
concept in a sentence*, use the Spanish gloss (`laboratorio`, `gemelo
digital`, etc. — see Termbase notes) so a first-time user isn't left with an
opaque English word with no explanation anywhere.

**Never invent a loanword the shipped file doesn't already use.** If you're
unsure whether a term is assimilated enough to borrow, check whether it
already appears untranslated elsewhere in `es.json` (e.g. `Plugins`, `BYOM`,
`GitLab`) — if not, default to translating it and flag the decision per
glossary.md §4 rather than silently minting a new loanword.

---

## Termbase

Every term in glossary.md §2. This is the canonical Spanish rendering — use it
consistently across all sections; don't let a different translator invent a
synonym three files away.

| English | Spanish | Note |
|---|---|---|
| **persona** | persona / personas | Common noun, borrowed as a normal Spanish word (already grammatically native: *la persona*, *las personas*). Lowercase always except sentence-initial — see the Casing section's `"Todas las Personas"` bug. Never mix with *agente*. |
| **agent** | agente / agentes | Distinct from persona: use *agente* specifically for the runtime actor executing a persona (newer surfaces) or as the general "your automation" noun in onboarding copy (`"Crea tu primer agente"`). Both nouns coexist in the shipped product; keep them distinct, never substitute one for the other in the same string. |
| **capability** | capacidad / capacidades | Not *función* ("feature"), not *habilidad* (reserved for **skill**). A capability is a declared, contractual unit of work. |
| **connector** | conector / conectores | The integration *type* (Slack, GitHub…). Distinct from **credential** (the bound secret) — never *conexión* (too generic, collides with "connection" concepts elsewhere) or *plugin* (reserved for the plugin-ecosystem sense). |
| **credential** | credencial / credenciales | The stored secret bound to a connector. Never *certificado* (certificate — wrong concept) or *contraseña* (password — too narrow, credentials include tokens/keys too). |
| **vault** | bóveda | Bank-vault metaphor, matches shipped usage (`"apps conectadas en la bóveda"`). Never *sótano* (cellar) or *almacén* (warehouse) — both lose the "secured" connotation. |
| **recipe** | receta | Literal culinary metaphor — reads naturally in Spanish tech copy and is already the convention in comparable products (Zapier, etc.). Must stay visibly distinct from **template** in the same screen. |
| **template** | plantilla | Prebuilt, adopted as-is. Already shipped consistently (`sidebar.templates`). Never *receta* — see above. |
| **trigger** | disparador / disparadores | Already shipped (`common.triggers`). Not *gatillo* (too literal/violent for a UI condition) and not *desencadenante* (correct but needlessly long for a label — reserve for prose). |
| **execution** | ejecución / ejecuciones | Already shipped pervasively (`agents.executions.*`). The canonical noun for "one run of a persona." |
| **run** | ejecutar (verb) · ejecución (noun) | Spanish has no clean second synonym the way English has *run* vs *execution* — don't invent one. Verb "to run" → *ejecutar* (`monitor.run`: `"Ejecutar"`). Colloquial noun "a run" merges into *ejecución*; if you must distinguish it from a formal "execution" in the same sentence, use *pasada* sparingly, not as a new standing term. |
| **schedule** | programación / programaciones | Already shipped (`sidebar.schedules`). Verb form: *programar*. |
| **deployment** | despliegue / despliegues | Already shipped (`sidebar.all_deployments`). Distinct from **promote**: deployment = publishing to an *external* target (Claude Managed Agents, MCP); promote = an *internal* draft→live transition. |
| **healing** | sanación | Already shipped extensively (`healing_started`, `ai_healing_diagnosis`, etc.) — keep it, it's established. Note the glossary's "never medical cure" warning is about *cura* specifically; *sanación* (the process noun, not the medical outcome) is the right register and matches 30+ existing occurrences — do not replace it with an invented alternative like *auto-reparación* now that it's this entrenched. |
| **fleet** | flota | Already shipped pervasively (`"Pulso de flota"`, `"Flota inactiva"`). Reads naturally — Spanish *flota* covers both the naval and "set of vehicles/units" senses. |
| **draft** | borrador | Standard Spanish word, not yet consistently used in shipped strings (several `"Draft ready"` gaps) — this is the term to fill those gaps with: `"Borrador listo"`. |
| **promote** | publicar | "Publish/activate" per glossary, not *promover* (false-friend risk — reads like "get promoted" in a career sense) and not *anunciar* ("advertise" — glossary explicitly rules this out). |
| **review** | revisión / revisiones | Already shipped pervasively (`monitor.reviews`, `sidebar.manual_review`). |
| **approval** | aprobación | Verb *aprobar* already shipped (`monitor.approve`: `"Aprobar"`). Keep noun/verb pair consistent: *aprobación* / *aprobar*, never *visto bueno* (too colloquial) as the primary term. |
| **lab** | Lab (label/tab) · laboratorio (prose) | See Loanword policy — borrowed short form for the tab, translated in explanatory sentences. |
| **overview** | resumen | Already shipped (`sidebar.overview`). The dashboard route's landing summary. |
| **monitor** | monitor (noun) · monitorear (verb) | Fully assimilated Spanish tech noun — keep as-is (`"Monitor de personas"`). Verb already shipped as *monitorear* (`"Monitorea múltiples canales de equipo en paralelo"`) — LatAm-leaning conjugation, keep consistent, don't switch to *monitorizar* mid-file. |
| **cockpit** | Cockpit | Borrowed short label, matches shipped `sidebar.cockpit`. See Loanword policy. |
| **event** | evento / eventos | Already shipped pervasively (`sidebar.events`). |
| **alert** | alerta / alertas | Already shipped (`monitor.channels_filter_alerts`). |
| **chain** | cadena | Already shipped (`agents.executions.chain_cascade`, `chain_id_prefix`). Distinct from **workflow** — a chain is specifically sequential persona-to-persona wiring. |
| **workflow** | flujo de trabajo | Already shipped (`phase_delegating`: `"Delegando al flujo de trabajo"`). Broader/more general than *cadena* — see Length discipline for the overflow risk this term carries. |
| **skill** | habilidad / habilidades | Already shipped (`sidebar.skills`). Reserve *capacidad* for **capability** — don't let the two collide. |
| **tier** | nivel | Translate the concept word (*nivel*); keep the tier *names themselves* — Starter, Team, Builder — untranslated, exactly as glossary.md §2 specifies. |
| **twin** | Twin (label) · gemelo digital (prose) | Borrowed short label for the tab/feature name; translated concept in prose. Caution: *gemelos* alone is ambiguous in Spanish (also means "cufflinks" and, dialectally, "binoculars") — never use the bare word *gemelos* as a UI label; always either the full *gemelo digital* or the borrowed *Twin*. |
| **director** | director (role) · Director (feature) | Same word, disambiguated by case, exactly like the Personas trap: lowercase *director* is a generic job-title sense (avoid using it that way — this product doesn't have literal people-managers); capitalized *Director* names the meta-persona feature that scores business value. Judge by the call site. |
| **brain** | Brain | Borrowed product-surface name for the Obsidian-knowledge-base plugin — tied to the Obsidian brand pairing ("Obsidian Brain"), so translating it to *cerebro* would sever that pairing. Keep capitalized. |

---

## Pitfalls

Concrete, sourced from what's already shipped or from the class of error a
machine translator reliably makes in Spanish. Each is wrong → right.

1. **The Personas-trap capitalization bug, live in the file today.**
   Wrong: `"Todas las Personas"` (`common.all_personas`) — reads as "all the
   [product] Personas", i.e. the brand.
   Right: `"Todas las personas"` — the common noun, lowercase, per the Casing
   section. Check every string that pairs a quantifier (*todas, algunas,
   ninguna*) with *personas* for this exact mistake.

2. **False friend: "success" → *suceso*.** A literal/careless pass renders
   "Success" as *Suceso*, which in Spanish means "event/incident", not
   "successful outcome" — it's a classic false cognate.
   Wrong: `"Suceso"`
   Right: `"Éxito"` (already correct in the shipped file — `common.success` —
   use it as the reference).

3. **False friend: "save" → *salvar*.** MT frequently renders "Saving…" as
   *Salvando…*, but *salvar* in Spanish means "to rescue" (a life, a soul), not
   "to persist data."
   Wrong: `"Salvando cambios…"`
   Right: `"Guardando cambios…"` (already correct throughout the shipped file
   — `common.saving`).

4. **Redundant subject pronoun under the formal register.** Spanish is
   pro-drop; inserting *usted* to "prove" the register reads stilted and
   patronizing, and it costs length you don't have in a button.
   Wrong: `"Guarde usted los cambios antes de continuar"`
   Right: `"Guarde los cambios antes de continuar"` — the *-e* ending already
   carries the formal register; the pronoun is legible but unidiomatic.

5. **Adjective-order calque from English.** English puts the descriptive
   adjective first; Spanish defaults to noun-then-adjective for this class of
   modifier. A rushed translation keeps the English order.
   Wrong: `"externa conexión"`
   Right: `"conexión externa"` (already correct in the shipped file —
   `home.nav_status.connections_external`).

6. **Hardcoding a formatted number or punctuation glyph into the JSON value.**
   Two separate live examples in the same string:
   Wrong: `"Traza incompleta: {count} tramo eliminado (límite: 10.000)"` — the
   `10.000` bakes in a Spanish-locale thousands separator as literal text.
   Wrong: `"No hay personas que coincidan con \"{query}\""` — ASCII straight
   quotes typed into the value.
   Right: drop the hardcoded number and let the caller format it (or, if the
   limit truly is fixed copy, spell it out — `"límite: diez mil"` — rather
   than hand-format a numeral); and `"No hay personas que coincidan con
   «{query}»"` for the quote glyph. See Typography & punctuation.
