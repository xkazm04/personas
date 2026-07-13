# Personas i18n glossary — the termbase

**What to call things.** One decision per term, applied everywhere, in every locale.
The English column is the source of truth. Each locale's chosen rendering lives in
its own `style-<locale>.md` under a `## Termbase` heading — that way 13 translators
never contend on one file.

Read this **and** `style-<locale>.md` before translating anything. When you make a
new term decision mid-run, write it down here (or in the style guide) so it sticks.

---

## 1. Do NOT translate

Byte-identical in every locale. Do not transliterate, decline, or pluralize with a
local suffix unless the style guide explicitly says the language requires it.

**Brands / products**
`Personas` · `Claude` · `Anthropic` · `OpenAI` · `Gemini` · `Ollama` · `GitHub` ·
`GitLab` · `Slack` · `Sentry` · `Obsidian` · `Discord` · `Notion` · `YouTube` ·
`Jira` · `Asana` · `Figma` · `Stripe` · `Twilio` · `SomaFM` · `Leonardo`

**Technical identifiers**
`API` · `CLI` · `JSON` · `YAML` · `HTTP(S)` · `cron` · `webhook` · `SQLite` ·
`MCP` · `A2A` · `P2P` · `ONNX` · `TTS` · `OAuth` · `JWT` · `SDK` · `npm` · `git` ·
`regex` · `UUID` · `SSE` · `CORS` · `KPI` · `LLM` · `GPU` / `CPU` / `RAM`

**Format**
Placeholder names (`{count}`, `{name}`, `{personas}`), emoji, `·` separators,
URLs, code identifiers, CSS classes, enum/status codes, user-generated content.

> ### The `Personas` trap
> **`Personas`** (capital P, the product) is a brand → never translated.
> **`persona` / `personas`** (lowercase, the common noun for a configured AI agent
> the user creates) **is** a normal word → **must** be translated.
>
> `common.all_personas` = "All personas" → *Alle Personas* is **wrong**; it means
> "all the products". Use the locale's word for the concept (see §2).
>
> Judge by the call site, never by the spelling. If the string names the app, it's
> a brand. If it counts things the user made, it's a noun.

---

## 2. Core domain terms

Definitions are what the term *means in this product*, so the translator picks the
right word rather than the first dictionary hit.

| English | What it means here | Translation note |
|---|---|---|
| **persona** (535) | A configured AI agent the user creates: model + system prompt + capabilities + connectors. The app's central noun. | Translate. Many languages borrow "persona" directly — decide once, per locale, and never mix with the word for *agent*. |
| **agent** (381) | Used near-synonymously with persona in older surfaces; in newer copy, the runtime actor executing a persona. | Translate. **Must be distinguishable from *persona*.** If your language collapses both to one word, keep *persona* borrowed and translate *agent*. |
| **capability** (62) | One declared skill a persona can perform; the unit of build/resolution. | Translate. Not "feature", not "ability" — it is a contract the persona fulfils. |
| **connector** (167) | An integration binding a persona to an external service (Slack, GitHub…). | Translate. Not "plugin" and not "connection" — a connector is the *type*; the bound instance is a *credential*. |
| **credential** (380) | A stored secret (API key, token) bound to a connector; lives encrypted in the vault. | Translate. Prefer the locale's word for *access data / secret*, not "certificate". |
| **vault** (107) | The encrypted local store of credentials. | Translate as *safe / strongbox*, not "cellar" or "warehouse". |
| **recipe** (86) | A reusable, parameterized persona blueprint the user can adopt. | Translate literally where the culinary metaphor reads naturally; otherwise use *blueprint / template pattern*. Must stay distinct from **template**. |
| **template** (141) | A prebuilt persona in the catalog, adopted as-is. | Translate. Distinct from *recipe*. |
| **trigger** (181) | A condition that starts an execution (event, schedule, webhook). | Translate. |
| **execution** (203) | One run of a persona, with inputs, output, cost, status. | Translate. |
| **run** (227) | Colloquial for one execution; also the verb. | Translate; keep noun/verb consistent with *execution*. |
| **schedule** (95) | A cron-like recurring trigger. | Translate. |
| **deployment** (47) | Publishing a persona to a target (Claude Managed Agents, MCP…). | Translate. |
| **healing** (34) | Automatic remediation of a failing persona. | Translate as *self-repair / recovery*, never medical "cure". |
| **fleet** (35) | The set of running CLI sessions/personas viewed together. | Translate as *fleet / squadron* if natural; else *set of agents*. |
| **draft** (79) | A persona build not yet promoted to live. | Translate. |
| **promote** (19) | Move a draft to live. | Translate as *publish / activate*, not "advertise". |
| **review** (309) | A human approval step on a persona's output. | Translate. |
| **approval** (32) | The act/record of approving a review. | Translate; keep consistent with *review*. |
| **lab** (294) | The workspace for testing persona versions against models. | Translate or borrow; keep short — it labels a tab. |
| **overview** (—) | The dashboard route. | Translate. |
| **monitor** (39) | The live view of running personas. | Translate. |
| **cockpit** (—) | The companion's control surface. | Translate or borrow; keep short. |
| **event** (244) | A message on the internal bus that can trigger work. | Translate. |
| **alert** (27) | A surfaced problem needing attention. | Translate. |
| **chain** (28) | Personas wired to run in sequence. | Translate. |
| **workflow** (39) | A multi-step orchestration. | Translate. |
| **skill** (26) | A packaged instruction set a persona/CLI can invoke. | Translate. |
| **tier** (—) | Pricing/feature level (Starter, Team, Builder). | Translate the word *tier*; keep the tier NAMES in English. |
| **twin** (81) | The digital-twin plugin. | Product surface name — translate the concept, keep it short. |
| **director** (34) | The meta-persona that scores business value. | Translate or borrow. |
| **brain** (24) | The Obsidian knowledge base plugin. | Translate the metaphor if it lands; otherwise borrow. |

Counts in parentheses are occurrences in `en.json` at the 2026-07-09 sweep — a
rough proxy for how much a bad choice will hurt.

---

## 3. Cross-cutting rules

- **Register.** Personas is a **professional developer tool**, addressed to an
  operator. Use the formal address where the language distinguishes: Czech
  *vykání*, German *Sie*, French *vous*, Russian *вы*, Japanese *です・ます*,
  Korean *해요체*. Never *du/ty/tu*.
- **Casing.** English UI uses Title Case in places. Almost no other language does.
  Use **sentence case** unless the style guide says otherwise; capitalize only the
  first word and proper nouns (German capitalizes all nouns, as always).
- **Buttons are imperative and short.** A button that wraps is a bug. German and
  French run 20–35% longer than English — pick the shorter idiom.
- **Errors are calm and actionable.** No exclamation marks, no blame, no "Oops".
- **Typography.** Real ellipsis `…` (never `...`). The locale's own quote glyphs.
  Non-breaking space where the language requires it (French before `: ! ? ; »`).
  CJK uses full-width punctuation `。、（）` and no space around Latin runs.
- **Placeholders keep their position free.** `{count}` may move to wherever the
  target grammar wants it — but its **name never changes**.
- **Numbers and dates** are formatted at runtime. Never hardcode a localized
  numeral or date format into a string.

---

## 4. Ambiguities to flag, not guess

If a string is a pun, a domain term with no settled local equivalent, or carries
legal weight (consent, GDPR), translate it as best you can **and** surface it in
the run's review list with a one-line note. Silent guessing is how terminology
drift ships.

Known-hard for this product: *cockpit*, *fleet*, *lab*, *brain*, *twin*,
*foundry*, *matrix*, *healing*, *promote*, *draft*. These are metaphors first and
nouns second.
