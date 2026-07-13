# Russian (ru) style guide — Personas

Read `docs/i18n/glossary.md` first. This file is the ru-specific layer on top of it:
one decisive answer per open question, so 40 translator agents produce one voice
instead of 40.

---

## Register & address

**Use formal вы, carried by the verb ending — never insert the pronoun "вы" as a
subject, and never use ты.** Russian imperatives conjugate for person/number, so
the formal register is expressed as `-ите` / `-ьте` on the verb itself
(Выберите, Сохраните, Настройте, Привяжите), not by writing the word "вы" in
front of it. This is already the dominant pattern in the shipped file
(`Выберите папку`, `Перетащите файл сюда`, `Опишите, что вы хотите
автоматизировать`) — keep it.

Justification: Personas is a professional tool addressed to an operator, not a
consumer app addressed to a friend; вы-imperative is the unmarked, expected
register for Russian business/developer software and anything in ты reads as
either a chat bot or a children's app.

When the pronoun *is* grammatically required (object of a verb, possessive), use
lowercase **вы / вас / вам / ваш** — `ваших агентов`, `нажмите Esc, чтобы
закрыть` — same as any other pronoun. Only capitalize **Вы** when Russian
capitalization rules require it anyway: sentence-initial position (`Вы вошли`)
or a standalone noun-phrase label (a filter chip literally reading `Вы`). Do
**not** adopt the German/Czech convention of always capitalizing the formal
pronoun out of politeness — that convention does not exist in Russian and
reads as a foreign calque.

---

## Casing

**Sentence case everywhere.** Capitalize only the first word of a label,
button, or sentence, plus proper nouns (Personas, Claude, Athena, GitHub, and
`Director` when it names the specific system persona — see Termbase). Do not
mirror English Title Case.

- Right: `Все персоны`, `Учётные данные`, `Продвинуть в продуктив`
- Wrong: `Все Персоны`, `Учётные Данные`, `Продвинуть В Продуктив`

Compact status/severity words used as standalone badges (`Критично`,
`Ожидание`, `Завершено`) are single words, so "sentence case" and "capitalize
first word" coincide — don't add extra capitals inside them once they're
multi-word (`Требует внимания`, not `Требует Внимания`).

---

## Typography & punctuation

- **Ellipsis:** real `…` (single character), never three periods `...`. The
  shipped file currently has both — roughly 30+ places still use `...`
  (`common.loading`, `common.saving`, `select_directory`, …). That's legacy
  drift, not the standard: fix to `…` whenever you touch a string with `...`,
  don't leave it, and never introduce a new `...`.
- **Quotes:** guillemets **« »**, no space inside them. This is already the
  dominant pattern (`«{query}»`, `«Версии»`, `«Запуск»`, `«{name}»`). A few
  shipped strings still use escaped straight quotes (`\"{query}\"`) — that's an
  ASCII/English calque, replace with « » on sight. Do not introduce curly
  quotes `“ ”` or nest a second quote style; Russian UI strings are short
  enough that nesting never comes up.
- **Dash:** em dash **—** with a normal space on both sides for parenthetical
  breaks or appositions (`— начало разговора —`, `Лечение не удалось — повтор`
  style constructions). Never a bare hyphen `-` or en dash `–` for this job;
  reserve the hyphen for actual compound words (`API-ключ`).
- **Ё:** optional in general, but **mandatory wherever it disambiguates a
  different word** — most importantly `всё` (everything/all, neuter) vs `все`
  (everyone/all, plural). Getting this wrong silently changes the sentence's
  meaning, not just its spelling. Elsewhere (обычные, ещё vs "еще") either
  spelling is acceptable; be consistent within one string family rather than
  mixing.
- **Non-breaking space:** not load-bearing the way it is in French, but use a
  hard space between a static numeral and its unit in hand-authored strings
  (`9 утра`, not a numeral that can end up alone on a line) to avoid orphaned
  single characters in narrow columns. Never hardcode a *localized* number or
  date format yourself — those are runtime-formatted (glossary §3); this rule
  only covers literal numerals you type into a string like a cron-hint
  example.
- **Latin brand names inside Cyrillic sentences** need no special treatment —
  embed them exactly as in the do-not-translate list: `Personas запускает
  ваших агентов через вашу подписку Claude` is the correct pattern, already
  shipped.
- No full-width punctuation, no RTL marks, no ZWNJ — none apply to Cyrillic.

---

## Length discipline

Russian text runs **roughly 15–25% longer than English** on average — shorter
than German (20–35%) but reliably longer than English, mostly from case
suffixes and compound technical nouns (`Развёртывание`, `Восстановление`,
`рабочий процесс`). Plan for it:

- **Buttons**: 1–3 words, prefer the short imperative or a bare noun the
  shipped file already uses — `Сохранить`, `Отменить`, `Продвинуть`,
  `Одобрить` — never a full clause. If the natural translation would wrap,
  cut a qualifier rather than shrink type: prefer `Черновик` over `Черновик
  готов к проверке` in a tight badge context.
- **Badges/chips/narrow columns**: favor a single compact noun or short
  adjective over a verb phrase — the shipped file's `Критично`, `Ожидание`,
  `Завершено`, `Простаивает` are the right shape; `Ожидание ответа
  пользователя` is not, even though it's more explicit.
- **Compound nouns** (`рабочий процесс` for workflow, `учётные данные` for
  credential) are unavoidable and already established — don't try to invent a
  shorter neologism for them, but do keep everything *around* them terse to
  compensate.

---

## Loanword policy

Two buckets. Get the term wrong and it reads either as stiff bureaucratese or
as unprofessional gamer-chat slang — both are wrong for a developer tool.

**Borrow (transliterate), because Russian engineers already write it in
Cyrillic every day:**
`триггер` (trigger), `коннектор` (connector), `монитор` (monitor), `кокпит`
(cockpit — an established loanword from motorsport/sim-racing UI, short and
already legible to a technical audience). These are the *product's* technical
nouns, not generic CS jargon, but they've already crossed over into ordinary
Russian dev vocabulary the same way "триггер базы данных" has for years — use
the loan, don't invent a purist native alternative (`спусковой крючок` for
"trigger" would be absurd here).

**Never borrow — always use the native word, even though tech-slang
alternatives exist and you will see them in chat/Slack Russian:**
`возможность` not `фича` (capability/feature), `навык` not `скилл` (skill),
`восстановление` not `хилинг` (healing), `рабочий процесс` not `воркфлоу`
(workflow), `учётные данные` not `креды`/`кредены` (credential). A shipped,
professional control surface is not a Discord channel — slang transliterations
read as unprofessional and inconsistent register next to the вы-formal
imperatives everywhere else.

**Persona itself** (`персона`) is technically a loanword too (via French, from
Latin), but it has been fully naturalized in ordinary Russian for a century
(`важная персона` = "an important person") and declines like any native
feminine noun — treat it as a native word, not a fresh transliteration.

Everything on the glossary's do-not-translate list (API, CLI, JSON, HTTP,
cron, webhook, OAuth, SDK, npm, git, regex, UUID, KPI, LLM, GPU/CPU/RAM, ONNX,
TTS, MCP, A2A, P2P, SSE, CORS, and all brand names) stays in Latin script,
unmodified, with no Cyrillic transliteration and no declension suffix bolted
on — do not write `джейсоны` for JSON plural or `эйпиай` for API.

---

## Termbase

| English | Russian | Note |
|---|---|---|
| **persona** | персона / персоны / персон | The app's central noun. Declines as a normal 1st-declension feminine noun. **Never render as агент** — see Pitfalls; ~15–20 shipped keys currently do this wrongly where the English source says "persona" and must be fixed on sight, not bulk-migrated. |
| **agent** | агент | The runtime actor executing a persona, and any UI surface where the English source itself literally says "agent" (older near-synonym surfaces, e.g. the `sidebar.agents` nav label). Translate whichever English word is actually used — persona→персона, agent→агент — never collapse both to one word. |
| **capability** | возможность / возможности | Not `функция` (feature) or `способность` (ability, too abstract) — a contract the persona fulfils. |
| **connector** | коннектор / коннекторы | Borrowed (see Loanword policy). Not `плагин`, not `подключение` (that's the bound instance = credential). |
| **credential** | учётные данные | Plural-only compound; no natural singular is used in shipped UI. Never `сертификат` (certificate) or slang `креды`. |
| **vault** | Хранилище / хранилище | Capitalize when naming the app section/tab (`Хранилище требует внимания`); lowercase mid-sentence. Not `сейф`, not `подвал`/`склад`. |
| **recipe** | рецепт / рецепты | Literal culinary metaphor — reads naturally in Russian, already dominant in the shipped file. Keep distinct from **template**. |
| **template** | шаблон / шаблоны | Distinct from **recipe** — a template is adopted as-is, a recipe is parameterized. |
| **trigger** | триггер / триггеры | Borrowed (see Loanword policy) — standard term already used for DB/event triggers in Russian dev jargon. |
| **execution** | выполнение | The broader technical noun — `Выполнения` (nav), `Облачное выполнение`. Pair with **run** below; keep noun/verb use consistent within one string family. |
| **run** | запуск / запуски (noun), запустить (verb) | Colloquial/verb form of execution — `ID запуска`, `Запуск`. Distinct from `выполнение` but both are correct depending on register; don't mix them inside a single sentence. |
| **schedule** | расписание | |
| **deployment** | развёртывание | |
| **healing** | восстановление (самовосстановление for the automatic/self- capability specifically) | **Never** `лечение` (literally "medical treatment/cure") — the glossary explicitly forbids the medical frame and the shipped `AI-лечение` / `healing_failed: "Лечение не удалось"` family is exactly the mistake to avoid; fix on sight, don't bulk-migrate. The already-shipped sub-terms `Диагностика` (diagnosing) and `Исправление` (fix) are fine as-is — only the outer "healing" wrapper needs correcting. |
| **fleet** | флот | Already consistent (`Пульс флота`, `Флот простаивает`). |
| **draft** | черновик | |
| **promote** | продвинуть (verb) / продвижение (noun, rare) | `Продвинуть в продуктив` = promote to production. Not "рекламировать" (advertise). |
| **review** | проверка | The human-approval step. |
| **approval** | одобрение (noun), одобрить (verb) | Standardize on this pair — the shipped file also has a stray `Утвердить` for the same action (`quick_approve`); that's a duplicate to reconcile toward `Одобрить`, not a second valid form. |
| **lab** | лаборатория | Already shipped consistently (`tab_lab: Лаборатория`). |
| **overview** | обзор | |
| **monitor** | монитор | Borrowed (see Loanword policy); the live view of running personas — `Монитор персон`. |
| **cockpit** | кокпит | Borrowed. Known-hard metaphor per glossary §4 — flag genuinely ambiguous cockpit copy for review rather than guessing further than this noun. |
| **event** | событие / события | |
| **alert** | оповещение / оповещения | Keep distinct from `предупреждение` (warning = a severity level, not the same concept). |
| **chain** | цепочка / цепочки | |
| **workflow** | рабочий процесс | Compound, unavoidably longer than English (see Length discipline). Never the slang loan `воркфлоу`. |
| **skill** | навык / навыки | Distinct from `возможность` (capability). Never the slang loan `скилл`. |
| **tier** | уровень | Translate the word "tier" itself; keep the tier **names** (Starter, Team, Builder) in English per glossary §2. |
| **twin** | двойник | The digital-twin plugin; translate the concept, keep it short for a tab label. |
| **director** | директор (generic role/concept) — but **Director** stays untranslated when it is the proper name of the specific meta-persona | Same logic as the Personas trap: `system_persona_undeletable: "Director — системная персона"` treats Director as a name (like Athena), not a common noun — judge by whether the string is naming *that* persona or describing the role in general. |
| **brain** | мозг | The Obsidian knowledge-base plugin. The "second brain" metaphor lands in Russian too (`второй мозг` is an established term in the Russian PKM/note-taking community) — translate it, don't borrow. |

---

## Pitfalls

1. **Persona/agent collapse (the #1 drift in this locale today).** The shipped
   file already gets this wrong in several `common.*` and `lab.*` keys where
   the English source says "persona" but the Russian says "agent" —
   apparently inherited from an older UI surface that used "agent" for the
   same concept.
   - Wrong: `"Выбрать агента"` for EN `"Select persona"`
   - Right: `"Выбрать персону"`
   - Wrong: `"Все агенты"` for EN `"All Personas"`
   - Right: `"Все персоны"`
   Fix these on sight per the project's fix-as-you-touch policy; do not
   bulk-rewrite the whole file in one pass.

2. **Ellipsis calque.** Typing three periods because that's what the English
   source has, instead of the single `…` character.
   - Wrong: `"Загрузка..."`
   - Right: `"Загрузка…"`

3. **Straight-quote calque.** Copying English `"…"` quote marks instead of
   Russian « ».
   - Wrong: `"Персоны по запросу \"{query}\" не найдены"`
   - Right: `Персоны по запросу «{query}» не найдены`

4. **Two-way plural key, three-way Russian grammar.** The runtime does not
   implement CLDR plural categories — every call site is a hardcoded
   `count === 1 ? key_one : key_other` ternary in the React component (verified
   in `NodeChip.tsx` and others), so there is no `_few` slot for Russian's
   2/3/4 category. A `_other` string declined only for 5+ (`"{count} персон"`)
   will render literally, and wrongly, for `count = 2` (`"2 персон"` instead of
   the grammatically required `"2 персоны"`).
   - Wrong: `_other: "{count} персон"` (breaks at 2, 3, 4, 22, 23, 24…)
   - Right: rephrase so no noun needs to inflect by count at all —
     `"Найдено: {count}"` / `"В очереди: {count}"` — the shipped
     `strip_running: "{count} выполняется"` already does exactly this by using
     a verb, not a declined noun, next to the number. Prefer that shape over
     forcing a noun to agree. If the string genuinely can't avoid a
     count-agreeing noun, flag it in the run's review list per glossary §4
     rather than silently picking the 5+ form.

5. **Preposition calque from English "of/for" phrases.** Copying the English
   preposition 1:1 instead of the case/preposition Russian actually wants for
   that verb.
   - Wrong: `"Проверка для {name}"` (literal "check for X")
   - Right: `"Проверка {name}"` (genitive, no preposition needed) or
     `"Проверить {name}"` depending on whether a noun or verb reads more
     naturally at that call site.

6. **Register slippage into ты-form or slang mid-file.** A single informal
   verb ending or a gamer-slang loanword breaks the вы-formal, native-word
   voice established everywhere else.
   - Wrong: `"Настрой коннектор"` (ты-imperative) / `"Прокачай навык"` (slang)
   - Right: `"Настройте коннектор"` (вы-imperative, matches every other
     imperative in the shipped file)
