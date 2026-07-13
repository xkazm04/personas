# Japanese (ja) style guide

Companion to `docs/i18n/glossary.md`. Read that file first — this one only records
the *ja*-specific decisions: register, casing, typography, length, loanword policy,
the ja termbase, and known machine-translation pitfalls in this language. Every
rule below was checked against the ~14,500 lines already shipped in
`src/i18n/locales/ja.json` (not against intuition) — counts are cited so the next
translator can verify rather than re-litigate.

---

## Register & address

**Use 敬体 (です・ます, the polite/formal register) in every sentence that
addresses or informs the user** — body copy, descriptions, toasts, error text,
empty states, confirmations. Never 常体 (plain/casual だ・である endings) and
never an imperative command form (〜しろ, 〜してくれ) directed at the user.

Justification in one sentence: Personas is a professional developer tool
addressed to an operator, and the shipped corpus already enforces this without
exception — a full-text scan of `ja.json` found **zero** casual `だ。` sentence
endings anywhere in the file, so this is not a stylistic suggestion, it is the
established contract.

One nuance that is *not* a register downgrade: **UI control labels (buttons,
tab names, menu items) use the bare dictionary-form verb or a noun, with no
polite ending at all** — `保存` (not `保存します`), `閉じる` (not `閉じてください`),
`キャンセル`. A label is not a sentence; pasting a です・ます ending onto a
two-character button reads as bureaucratic and none of the ~40 shipped button
labels do it. Reserve です・ます for anywhere a full sentence is being written
(descriptions, hints, errors, toasts, confirmation dialogs).

---

## Casing

Japanese has no letter case, so "sentence case vs Title Case" does not apply
to the Japanese text itself. Two things stand in for it:

1. **Never impose English Title Case rhythm on an embedded Latin term.** Keep a
   brand or acronym exactly as it is written in the do-not-translate list
   (`API`, `CLI`, `JSON`, `MCP`, `Claude Code CLI`, `GitHub`) — do not re-case,
   split, or "sentence-case" it just because the surrounding Japanese sentence
   started a new clause.
2. **Half-width Latin/numerals only.** Embedded English words, acronyms,
   numbers, and placeholders must use half-width characters (`API`, `CPU`,
   `{count}`) — never full-width look-alikes (`Ａ`, `ＣＰＵ`, `１`). Full-width
   Latin is a classic artifact of translating through a CJK-locale text field
   and reads as broken in a professional tool.

The kanji-vs-katakana choice for a given term is the closer Japanese analogue
of English's formal/casual register split (see **Loanword policy** below) —
but that choice is made **once per term** in the Termbase, not improvised
per-string.

---

## Typography & punctuation

| Element | Rule | Evidence from shipped `ja.json` |
|---|---|---|
| Quotes | `「」` (kagi brackets) when quoting a UI label/name inline in a sentence, e.g. `「保存」をクリック`. Never ASCII `"..."` or full-width `“ ”`. | 65 uses of `「` already shipped. |
| Ellipsis | Real ellipsis `…` (U+2026). Never three ASCII periods `...`. | Mixed today: 210 real `…` vs 480 ASCII `...`. The ASCII form is legacy debt from early machine passes — **do not copy it into new or fixed strings**, always use `…`. |
| Dash / separator clause | Em dash `—` (U+2014) with a single half-width space on each side, e.g. `対応が必要 — 詳細を確認`. Never the ASCII double-hyphen `--`. | Mixed today: 515 real `—` vs 66 ASCII `--`. `—` is the clear majority — treat `--` sightings as bugs to fix opportunistically, never introduce new ones. |
| Native punctuation | Full-width `。` `、` `（` `）` for any punctuation you author in Japanese prose. Never half-width `.` `,` `(` `)` inside Japanese text. | Consistent throughout, e.g. `（残り {free} GB）`, `レート制限、初回タイムアウト`. |
| The `·` separator | Per glossary §1, this is a **do-not-translate format token**. When the English source string uses a half-width middle dot `·` to separate stat chips (`{a} · {b} · {c}`), keep it exactly as `·` — do not swap it for the Japanese interpunct `・`. | 67 shipped half-width `·` used exactly this way, e.g. `成功率 {pct}% · 本日 {today} 件`. |
| The `・` interpunct | Use full-width `・` only when *you* are writing a natural Japanese conjunction between two nouns that did NOT come from a source-string `·` (e.g. joining `保存・削除` in a menu label). | 49 shipped uses, all inside authored Japanese phrases, never as a stand-in for the source's `·`. |
| Latin term + katakana, no space | Attach directly, no space: `APIキー`, `OSキーチェーン`, `MCPサーバー`. Do not insert a half-width space between a Latin acronym and the katakana word that follows it. | Universal in the shipped file — no counter-example found. |
| RTL marks / ZWNJ | Not applicable to Japanese script. Never carry over bidi-control characters or ZWNJ from an Arabic/Hebrew/Indic locale pass — this happens when a translator mechanically reuses a pipeline built for another language. | N/A — flagging as a pitfall to *avoid introducing*, not something present today. |
| Numbers, percent, currency | Keep the numeral and its symbol half-width and directly attached exactly as the source formats it (`{pct}%`, `${cost}`) — never reformat, localize, or add a space to the number itself; the runtime formats numbers. | `CPU {pct}%`, `${cost}` shipped as-is throughout. |

---

## Length discipline

Japanese prose is generally **more compact than English by character count** —
dense kanji compounds carry more meaning per glyph (`認証情報` = 4 characters
for "credential" = 10 Latin characters). But two things blunt that saving:

- **Full-width glyphs render roughly 2× the visual width of a Latin letter.**
  Do not assume a shorter character count buys you proportional pixel-width
  headroom in a badge or narrow column — measure by rendered width, not by
  character count.
- **Button and badge labels: match the shipped convention of 2–5 characters**
  (`保存` / `キャンセル` / `閉じる` / `追加` / `確認` / `完了`). Never construct a
  full sentence, and never bolt a polite ending onto a label (see Register).
- **Do not invent Japanese abbreviations to save space.** Where English
  might clip a word to fit a narrow column (`Exec` for "execution"), Japanese
  kanji compounds are already near their minimum — abbreviating further (e.g.
  truncating `実行` to a single character) reads as a typo, not a
  space-saving convention. If a label doesn't fit, shorten the *English source
  string's concept*, don't mutilate the Japanese compound.
- Japanese has no word-spacing, so a long label can wrap at any character
  without an English-style "broken mid-word" problem — but keep chips/badges
  to roughly one line (~8–10 full-width characters) to match existing chip
  sizing in the app.

---

## Loanword policy

This is the single biggest source of drift, so the rule is deliberately
mechanical, not a case-by-case judgment call:

> **A term that names a THING the product ships (a tab, a feature area, a UI
> surface, a noun a user manipulates) → borrow as katakana**, because this is
> a professional developer tool and its Japanese-speaking engineers already
> say these words in katakana out loud. **A term that names a PROCESS, STATE,
> or JUDGMENT (something evaluated or decided, not clicked-on) → use a native
> kanji compound**, because a considered kanji word reads as precise rather
> than a hasty transliteration, and this is exactly where a katakana
> false-friend (see Pitfalls) does the most damage.

Applying that split to the product's own vocabulary, already shipped and not
to be re-litigated:

- **Katakana (borrowed), THING-nouns:** ペルソナ persona, エージェント agent,
  コネクタ connector, ボルト vault, レシピ recipe, テンプレート template,
  トリガー trigger, スケジュール schedule, デプロイ deployment, フリート fleet,
  レビュー review, ラボ lab, コックピット cockpit, イベント event, アラート
  alert, チェーン chain, ワークフロー workflow, スキル skill, ツイン twin,
  モニター monitor.
- **Kanji (native), PROCESS/STATE words:** 機能 capability, 認証情報 credential,
  実行 execution/run, 修復 healing, 下書き draft, 昇格 promote, 承認 approval,
  概要 overview, 長期記憶 brain.

**Two shipped exceptions that override the heuristic** — honor them anyway,
because the product already committed:
- **Director** is left as literal, untranslated English throughout the
  product (never `ディレクター`, never `監督`). It functions as this
  meta-persona's own proper name, not a common noun — treat it exactly like
  user-generated content (a persona's given name), which is also on the
  do-not-translate list.
- **tier** (the pricing/feature level: Starter/Team/Builder) is rendered as
  the katakana-derived プラン ("plan"), not the kanji 階層, even though it is a
  state/level word by the heuristic above. `プラン` has fully displaced any
  kanji alternative in every pricing-facing string already shipped (`あなたの
  プラン`, `プランをアップグレード`). Do not confuse this with the *unrelated*
  sense of "tier" meaning settings-precedence layers (persona / workspace /
  global), which correctly uses 階層 — check context before choosing.

When a genuinely new term shows up that isn't in the Termbase below: apply the
THING-vs-PROCESS split, make the call once, and add the row to the Termbase
immediately so the next translator inherits the decision instead of guessing
again.

---

## Termbase

| English | Japanese | Note |
|---|---|---|
| persona | ペルソナ | The app's central noun. **Must read as a different word from *agent*** — never merge them. Counted with the body/figure counter 体 (`{count} 体のペルソナ`), not a bare number. Never pluralize with an English "-s" — `ペルソナs` is a real shipped bug, not a valid form (see Pitfalls). |
| agent | エージェント | The runtime actor executing a persona. Katakana, but a **different word** from ペルソナ — this is the one distinction the glossary makes non-negotiable, and both terms are already distinct in every shipped string. |
| capability | 機能 | A persona's declared, fulfillable contract. Not スキル (that's *skill*, a different concept — a packaged instruction set), not 能力 (reads as personal aptitude, too soft for "a contract the persona fulfils"). |
| connector | コネクタ | **No trailing long-vowel mark.** `コネクター` is a minority variant (12 occurrences vs 42 for `コネクタ`) — standardize on the short form. Distinct from credential (認証情報) and vault (ボルト): connector is the *type*, credential is the bound secret. |
| credential | 認証情報 | "Authentication information." Never 証明書 ("certificate" — implies X.509/TLS, wrong domain). |
| vault | ボルト | Katakana, dominant 18:2 over the legacy variant 保管庫 ("storage warehouse") — retire 保管庫 on sight. `ボルト` also matches the product's own section label. |
| recipe | レシピ | Katakana; the culinary metaphor reads naturally in Japanese. Must stay visibly distinct from *template*. |
| template | テンプレート | Katakana. Distinct from recipe: レシピ is a reusable, parameterized blueprint the user actively adopts and customizes; テンプレート is a prebuilt persona adopted as-is. |
| trigger | トリガー | Katakana, no native alternative in use. |
| execution | 実行 | "Execution/run." One run of a persona with inputs, output, cost, status. |
| run | 実行 | **Same word as execution** — keep noun and verb consistent (`実行` / `実行する`; re-run = 再実行). Do not invent a second Japanese word to distinguish "run" from "execution"; the source doesn't either. |
| schedule | スケジュール | Katakana. |
| deployment | デプロイ | Katakana, clipped form (not the longer `デプロイメント`) — matches every shipped instance. |
| healing | 修復 | "Repair/restoration." Compounds: 自動修復 (auto-healing), 自己修復 (self-healing). Never 治癒 — that's a medical "cure," which the glossary explicitly forbids. |
| fleet | フリート | Katakana. |
| draft | 下書き | Native kanji, dominant 49:13 over the katakana variant `ドラフト` — standardize on 下書き. Verb: 下書きする. |
| promote | 昇格 | "Elevate in status." **Deliberately not プロモート**, despite that katakana form appearing equally often (7:7) in the current file: プロモート reads in Japanese as *marketing/advertising* promotion, which is precisely the "advertise" confusion the glossary rules out. 昇格 cleanly means "move a draft to a higher/production status" with no such collision. Verb: 昇格する. |
| review | レビュー | Katakana. Kept visibly distinct from *approval* (see next row), matching every shipped string. |
| approval | 承認 | Native kanji: "approval/authorization." The action button is 承認 (approve); the process is レビュー (review) — the two must never collapse into one word. |
| lab | ラボ | Katakana, short — must fit a tab label. |
| overview | 概要 | Native kanji: "summary/overview." |
| monitor | モニター | Katakana, **long-vowel mark kept** (unlike connector) — no shipped instance drops it. |
| cockpit | コックピット | Katakana. |
| event | イベント | Katakana. |
| alert | アラート | Katakana. |
| chain | チェーン | Katakana. Personas wired to run in sequence. |
| workflow | ワークフロー | Katakana. A multi-step orchestration; distinct from chain (チェーン), which is specifically the sequential-trigger mechanism. |
| skill | スキル | Katakana. A packaged instruction set a persona/CLI can invoke — distinct from *capability* (機能), which is a persona's own declared contract. |
| tier | プラン | Pricing/feature level (Starter, Team, Builder). Keep the tier **names** in English untouched — only "tier" itself is translated, as プラン. Do not confuse with the unrelated settings-precedence sense of "tier" (persona/workspace/global layers), which uses 階層 instead — resolve by context. |
| twin | ツイン | Katakana. The digital-twin plugin's central noun. |
| director | Director | **Left untranslated, literal English**, throughout the shipped product — not ディレクター, not 監督. Functions as this meta-persona's proper name; treat like user-generated content, not a common noun. |
| brain | 長期記憶 | "Long-term memory" — the shipped choice translates the metaphor rather than borrowing. Never 脳 (literal "brain," clinical/anatomical) or ブレイン (katakana, reads like a supplement-brand name). |

---

## Pitfalls

Concrete errors found *in this repository's own shipped strings* — these are
not hypothetical; each is a real line in `src/i18n/locales/ja.json` today, kept
here as a wrong→right pair so the next translator recognizes and doesn't
repeat the pattern.

1. **Renaming or English-pluralizing a placeholder.** Shipped bug
   (`monitor.subtitle`, source: `"{personas} personas · {attention} need
   attention · {running} running"`):
   - Wrong (shipped): `"{ペルソナs} ペルソナs · {attention} need attention ·
     {running} running"` — the placeholder was renamed from `{personas}` to
     `{ペルソナs}` (breaks at runtime, since the app looks up `vars.personas`,
     not `vars.ペルソナs`), an English "-s" was glued onto a katakana noun, and
     the rest of the sentence was left untranslated.
   - Right: `"ペルソナ {personas} 件 · 対応が必要 {attention} 件 · 実行中
     {running} 件"` — placeholder name untouched (only its position moved),
     no plural suffix, full sentence translated, the source's half-width `·`
     preserved verbatim.

2. **Writing literal ICU plural syntax into the string.** Shipped bug
   (`lab.run_arena`, source: `"Run Arena ({count} model{count, plural, one {}
   other {s}})"`):
   - Wrong (shipped): `"{count, plural, one {} アリーナを実行します ({count}
     モデル other {s}})"` — this runtime has no ICU; `{x, plural, ...}` syntax
     renders as raw, visible braces on screen.
   - Right: Japanese nouns don't inflect for number, so there is no plural
     branching to do at all — one string covers every count:
     `"アリーナを実行（{count} モデル）"`.

3. **Loanword false friend: プロモート reads as advertising.** A literal
   transliteration of "promote" imports English's ambiguity into Japanese,
   where プロモート near-exclusively means marketing/promotional activity.
   - Wrong: `"下書きをプロモート"` ("promote the draft" → reads like
     *advertise* the draft).
   - Right: `"下書きを昇格"` — unambiguously "elevate this draft to
     production," with no advertising connotation.

4. **Tacking an English plural "-s" onto a Japanese/katakana noun.** Japanese
   nouns are invariant for number; there is no plural form to construct.
   - Wrong: `ペルソナs`, `ツインs`, `レシピs`.
   - Right: drop the suffix; if a quantity must be shown, use a counter word,
     not a bare number either — `{count} 件のペルソナ`, `ツイン {count} 体`
     (see next pitfall).

5. **Dropping or misusing the counter word (助数詞).** A bare "number + noun"
   is a classic calque of English's own bare-plural grammar.
   - Wrong: `"3 ペルソナ"` (reads as a raw machine-translation artifact).
   - Right: `"ペルソナ {count} 体"` for personas/agents (this app's own
     convention counts them with 体, the counter for personified figures) or
     `"{count} 件のレビュー"` for generic items (件, the general-purpose
     counter for cases/matters) — pick the counter that matches what's being
     counted, don't omit it.

6. **ASCII typewriter substitutes instead of real typographic glyphs.** Both
   patterns exist today in the shipped file as legacy debt from early machine
   passes — don't add more of either.
   - Wrong: `"ご安心ください -- データは安全です"` / `"読み込み中..."`
   - Right: `"ご安心ください — データは安全です"` (real em dash `—`) /
     `"読み込み中…"` (real ellipsis `…`). The majority of the codebase already
     uses the correct glyphs (515 real `—` vs 66 ASCII `--`) — match the
     majority, don't extend the minority.
