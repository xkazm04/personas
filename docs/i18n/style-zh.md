# Chinese (Simplified) style guide — `zh`

Companion to [`glossary.md`](./glossary.md). Read that first. This file is the
zh-specific ruling on every open question the glossary leaves to the locale:
register, casing, punctuation, length, loanwords, and the termbase. It is
grounded in a source audit of the ~11,500 keys already shipped in
`src/i18n/locales/zh.json` (2026-07-10 sweep) — decisions below cite the
dominant existing pattern where one exists, and make a decisive call where the
shipped file itself is split.

---

## Register & address

**Use 您 (formal "you") everywhere, never 你 / 你们.**

Personas is a professional developer/operator tool, and the shipped file
already leans formal: 您 appears 428 times against 81 occurrences of the
informal 你 — roughly 84% formal already. Standardize on 您 for the remaining
16%, including error messages, empty states, and tooltips, where a few 你s
still leak in from earlier sessions. Chinese verbs don't conjugate for
formality, so the entire decision is pronoun choice: always 您, 您的, 您自己;
never 你, 你的, and never an imperative that drops the pronoun in a way that
reads like a command barked at a stranger (soften with 请 for actions with
consequence — 请确认, 请重试 — but not for routine buttons like 保存/取消).

---

## Casing

Chinese script has no letter case, so "casing" here means three concrete rules:

1. **Preserve source casing on every do-not-translate term exactly as shipped** —
   `Claude`, `GitHub`, `API`, `MCP`, `Director` keep their Latin capitalization
   verbatim inside a Chinese sentence. Never lowercase, uppercase, or
   half-translate a brand/technical identifier.
2. **Never title-case a translated phrase.** English UI copy sometimes reads
   "Persona Monitor" or "All Personas" in Title Case — the Chinese rendering is
   plain sentence-style compounding (人格监视器, 所有人格), not word-by-word
   capitalization (Chinese has nothing to capitalize).
3. **Buttons are short, imperative, verb-first, no trailing punctuation** —
   保存 · 取消 · 重试 · 删除 · 编辑 · 复制, matching what's already shipped in
   `common.*`. Never pad a button with a subject or particle ("请保存" is a
   dialog action, not a button label).

---

## Typography & punctuation

- **Ellipsis is always the single glyph `…` (U+2026), never ASCII `...`.**
  The shipped file still has ~483 raw `...` and 4 stray double `……` — those
  are gaps, not the standard; don't add more. `"加载中…"`, never `"加载中..."`.
- **Quote glyphs have two distinct jobs, both already established in the shipped file:**
  - Full-width curly quotes `“…”` for an actual quotation or quoted speech.
  - Corner brackets `「…」` specifically to call out a UI control, button label,
    or literal example value *inline in a sentence* — this is the dominant
    shipped pattern (24 instances): `点击「打开授权 URL」`, `点击「晋升」使其成为生产就绪`,
    `规则名称（例如「崩溃调试助手」）`. Use `「…」` whenever your sentence names a
    button/label/example the user will see elsewhere on screen.
  - Reserve plain ASCII straight quotes `"…"` only for literal code, JSON, or
    CLI strings (per the do-not-translate list) — never for normal prose.
- **Chinese sentence punctuation is always full-width**: `。、，；：？！（）`.
  Never the ASCII `. , ; : ? ! ( )` inside Chinese prose.
- **Numerals, `%`, `$`, and other numeric/currency symbols stay half-width ASCII**
  even mid-Chinese-sentence — `50%`, `$12`, `3`. Never full-width digits
  (`０１２`) or full-width `％`; the shipped file uses half-width almost
  exclusively (47 ASCII `%` vs. 1 full-width `％` — treat that 1 as a bug, not
  precedent).
- **Insert one half-width space between a CJK run and an adjacent Latin-script
  word, acronym, or brand name** — `使用 Google 登录`, `Claude CLI 未就绪`. This is
  the shipped convention and reads more clearly than jamming the scripts
  together; it takes precedence over the more general "no spacing" note in
  `glossary.md` §3, which is a cross-locale default, not a zh-specific ruling.
  No extra space is needed between CJK text and adjacent full-width punctuation.
- **No RTL marks, no ZWNJ, no bidi controls** — none of these apply to Chinese
  script; skip this class of gotcha entirely for `zh`.
- **Measure words (量词) are mandatory before every counted noun.** A bare
  `{count} 连接器` reads as broken Chinese — it needs a classifier: `{count} 个连接器`.
  Match the classifier already in use for that noun family: `个` for generic
  countables (connectors, capabilities, agents), `项` for tasks/fields/findings
  needing attention, `次` for occurrences/calls, `条` for messages/records/notes.
- **`_one` / `_other` (/ `_many` / `_zero`) key families**: Chinese has no
  grammatical plural, so word every variant of a key family **identically** —
  they differ only in which value the caller substitutes into `{count}`.
  Exception: if the English `_one` string hardcodes the literal digit `1`
  instead of `{count}` (e.g. `"1 new message"`), mirror that with the literal
  digit `1` (not the word `一`) in the `_one` variant only — don't invent a
  Chinese-only convention the English source doesn't have.

---

## Length discipline

Chinese is **denser than English**, not longer — the opposite problem from
German/French. `"Persona Monitor"` (16 Latin characters) ships as `人格监视器`
(5 Hanzi). Most strings will have room to spare; the risk is padding them back
out with unnecessary particles, not overflow.

That said, don't treat the extra room as free: each Hanzi glyph renders at
roughly 1.5–1.75× the width of a Latin letter, so a compound noun phrase can
still overflow a narrow badge or icon-button slot. Concrete budgets:

| Slot | Budget |
|---|---|
| Sidebar / nav label | ≤ 6 characters |
| Button label | ≤ 4 characters, verb-first, no particles |
| Tab label | ≤ 4 characters |
| Toast / status chip (single line) | ≤ 12 characters |

When the English source is a compound noun phrase, compress to the idiomatic
Chinese head-noun-first form rather than translating word-by-word — see
"Casing" rule 2 and the `的`-insertion pitfall below.

---

## Loanword policy

Be decisive: check this list before picking a rendering for any term that
feels borderline. Everything in `glossary.md` §1 (brands, technical
identifiers) is already settled and out of scope here — this section only
covers **domain words a machine translator might wrongly leave in English, or
wrongly borrow, absent a clear ruling.**

**Naturalized — always translate, never borrow** (all already dominant in the
shipped file):

| English | Chinese | Shipped evidence |
|---|---|---|
| prompt (system prompt) | 提示词 | 73 occurrences |
| token (LLM usage *and* auth/OAuth token) | 令牌 | 47 occurrences, both senses |
| model | 模型 | 108 occurrences |
| tool | 工具 | 160 occurrences |
| plugin | 插件 | established, e.g. `sidebar.plugins` |
| cache | 缓存 | established |
| log | 日志 | established |
| dashboard | 仪表盘 | established, `sidebar.dashboard` |
| bug (defect, not the insect) | 缺陷 | prefer over borrowed "bug" in user copy |

**Stay in English — do not translate** (repeats `glossary.md` §1 for
completeness, zh adds nothing extra here): `API` · `CLI` · `JSON` · `YAML` ·
`HTTP(S)` · `cron` · `webhook` · `SQLite` · `MCP` · `A2A` · `P2P` · `ONNX` ·
`TTS` · `OAuth` · `JWT` · `SDK` · `npm` · `git` · `regex` · `UUID` · `SSE` ·
`CORS` · `KPI` · `LLM` · `GPU`/`CPU`/`RAM`, plus every brand name.

**Judgment calls resolved this pass** (borderline, decided by existing
precedent — don't re-litigate):

- **`Director`** stays in English, unborrowed, treated as the meta-persona's
  proper name — already shipped as `"Director 是系统角色，无法删除。"` Do not
  translate it to 总监/主管; it's a name, not the job title.
- **Tier names** (Starter / Team / Builder) stay in English per
  `glossary.md` §2; only the generic word "tier" itself is translated (as 层级).
- **"run"** (colloquial single execution, and the verb) stays 运行, distinct
  from **"execution"** (the noun record — inputs/output/cost/status) which is
  执行. Don't collapse them to one word; the shipped file keeps them apart
  (`执行记录` = execution records / history, `运行` = the Run button).

---

## Termbase

One decision per term, no exceptions. **`persona` and `agent` are
deliberately different words** — this is the single most important call in
this table; see the Pitfalls section for why the shipped file currently
violates it.

| English | Chinese (Simplified) | Note |
|---|---|---|
| persona | 人格 | The app's central noun (character = model + prompt + capabilities + connectors). Never 代理 or 角色 for this — see Pitfalls. |
| agent | 智能体 | The runtime actor executing a persona / the older near-synonym surface. Must stay visually distinct from 人格. |
| capability | 能力 | A declared skill a persona can perform — not 技能 (that's `skill`, a different concept in this product). |
| connector | 连接器 | The integration *type* (Slack, GitHub…). Not 插件, not 连接 (that's the verb "to connect"). |
| credential | 凭据 | The bound secret instance. 214 shipped occurrences vs. 82 for the alternate 凭证 — use 凭据 in body copy; 凭证 may remain only in the two existing short sidebar labels, don't introduce it elsewhere. |
| vault | 保险库 | The encrypted local credential store. Consistent and unambiguous already. |
| recipe | 配方 | Reusable, parameterized persona blueprint. Keep the culinary metaphor — it's naturalized. |
| template | 模板 | Prebuilt persona, adopted as-is. Must stay distinct from 配方. |
| trigger | 触发器 | A condition that starts an execution. |
| execution | 执行 | One run record — inputs, output, cost, status. Distinct from `run`. |
| run | 运行 | The verb, and the colloquial single action / button label ("运行"). |
| schedule | 计划 | The cron-like recurring trigger, e.g. `计划任务` = scheduled task. Not 日程 (reserve that for calendar-style "scheduling" as an activity, a rarer sense). |
| deployment | 部署 | Publishing a persona to a target. |
| healing | 自愈 | Automatic remediation of a failing persona — literal "self-healing", not a medical "cure" word. (自我修复 appears once; prefer 自愈 for brevity/consistency.) |
| fleet | 舰队 | The set of running sessions/personas viewed together. Reads naturally as a metaphor in Chinese, already shipped (`舰队脉冲` = fleet pulse). |
| draft | 草稿 | A persona build not yet promoted to live. |
| promote | 晋升 | Move a draft to live — literal "get promoted/advance in rank", which is the dominant existing rendering for this *specific* action (`批准并晋升`, `点击「晋升」使其成为生产就绪`, `代理已晋升`). Do not use 发布 (reserve that for "publish/release" in the generic sense — publishing an event, a gallery listing, a software release) or 提升 (reserve that for generic "increase/improve," e.g. raising a score) for this specific action. |
| review | 审核 | A human approval step on a persona's output. |
| approval | 批准 | The act/record of approving a review — same word serves as both the verb "approve" and the noun "approval" in the shipped file; don't introduce 审批 as a second rendering except where it's already load-bearing in two existing keys (`require_approval`, `auto_approve`). |
| lab | 实验室 | The workspace for testing persona versions against models. Short enough to label a tab. |
| overview | 概览 | The dashboard route. |
| monitor | 监视器 (noun) / 监控 (verb) | 监视器 names the feature/page ("人格监视器" = Persona Monitor); 监控 is the verb "to monitor" (e.g. "并行监控多个团队频道" = monitor multiple team channels in parallel). Keep both — they're not interchangeable. |
| cockpit | 驾驶舱 | The companion's control surface. Literal translation preserves the metaphor cleanly; keep it short. |
| event | 事件 | A message on the internal bus that can trigger work. |
| alert | 告警 | A surfaced problem needing attention — the standard Chinese monitoring/ops term. Not 提醒 (that reads as a gentle reminder, too soft for an alert). |
| chain | 链 (noun) / 链式 (adjective) | Personas wired to run in sequence. Use 链 alone as the noun ("链" = a chain, "链：{id}"); use 链式 when modifying another noun ("链式反应" = chain reaction, "链式级联" = chain cascade). |
| workflow | 工作流 | A multi-step orchestration. Naturalized, not borrowed. |
| skill | 技能 | A packaged instruction set a persona/CLI can invoke. Must stay distinct from 能力 (`capability`). |
| tier | 层级 | Pricing/feature level. Translate the word; keep the tier NAMES (Starter, Team, Builder) in English. |
| twin | 分身 / 数字分身 | The digital-twin plugin. Use 数字分身 on first/prominent mention (e.g. a section header), 分身 alone is fine once the plugin context is established. |
| director | Director | Kept in English — it's the meta-persona's proper name, not a translatable job title. See Loanword policy. |
| brain | 大脑 | The Obsidian knowledge-base plugin. The metaphor lands naturally in Chinese; already consistent across every shipped occurrence. |

---

## Pitfalls

Concrete, already-observed errors — each with the exact wrong form currently
shipping (or a synthesized equivalent of the same MT calque pattern) and the
corrected form.

1. **Placeholder renamed instead of preserved — a live shipped bug.**
   `monitor.subtitle` currently ships as:
   - Wrong (shipped today): `"{人格s} 人格s · {attention} need attention · {running} running"`
   - Right: `"{personas} 个人格 · {attention} 项需要关注 · {running} 个正在运行"`

   The placeholder name `{personas}` was transliterated to `{人格s}` — since the
   runtime does an exact case-sensitive `\w` match on the key name, `{人格s}`
   never resolves and renders literally on screen. **Never rename, recase, or
   pluralize a placeholder — only the surrounding words get translated,** and
   the whole sentence needs a real translation, not a partial word-swap.

2. **Bare code-switching — leaving an English word inline mid-sentence.**
   - Wrong (shipped today): `"无pending reviews for this 人格."`
   - Right: `"此人格当前没有待处理的审核。"`

   A half-Chinese, half-English sentence is worse than plain English fallback
   — it reads as broken, not bilingual. Translate the **entire** sentence; if
   you don't know the right word for part of it, that's a flag-for-review
   case (`glossary.md` §4), not a partial translation.

3. **Term drift on the app's central noun.** The shipped file currently
   renders `persona`/`agent` **four different ways** depending on which
   session translated the string: 人格 (41×), 智能体 (97×), 代理 (488×), 角色
   (59×). Going forward: **persona → 人格, agent → 智能体, always** — never
   introduce 代理 or 角色 for either concept again. 代理 collides with
   "proxy/reseller/agency" in ordinary Chinese business usage; 角色 collides
   with the unrelated RBAC sense of "role" that also appears in this product
   (permissions/roles). Mixing them is exactly the drift `glossary.md`'s
   "Personas trap" warns about, just for the Chinese-specific set of false
   friends.

4. **Over-inserting the possessive particle `的` (a textbook MT calque).**
   - Wrong: `"人格的监视器"`, `"触发器的条件"`
   - Right: `"人格监视器"`, `"触发条件"`

   Chinese noun-noun compounds usually drop `的` between a modifier and its
   head noun, especially in UI labels and titles. Machine translation over-uses
   `的` because English always needs "of"/possessive — don't propagate that
   into Chinese compounds.

5. **ASCII ellipsis / straight quotes surviving from the English source.**
   - Wrong: `"加载中..."`, `他说"完成了"`
   - Right: `"加载中…"`, `他说「完成了」` (or `“完成了”` for true quoted speech)

   ~483 raw `...` already exist in the shipped file — that's leftover MT
   output, not house style. Don't add more; always emit the single `…` glyph
   and the correct quote glyph for the job (see Typography section).

6. **Redundant subject pronoun stacking (another MT tell).**
   - Wrong: `"您可以随时点击您的头像来查看您的设置"` (三个"您"堆叠在一句话里)
   - Right: `"点击头像即可查看设置"`

   Chinese drops the subject far more readily than English once context makes
   it obvious — a UI microcopy sentence rarely needs the pronoun repeated at
   every clause. Keep 您 for the *first* reference in a paragraph/dialog if
   warmth matters, then drop it in the same breath.
