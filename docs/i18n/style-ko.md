# Personas i18n style guide — Korean (ko)

Read `docs/i18n/glossary.md` first. This file is the ko-specific layer on top of
it: the register decision, casing, typography, length budget, loanword policy,
the ko termbase (glossary §2 in Korean), and the pitfalls a machine translator
reliably hits in this language. When this file and the glossary conflict on a
ko-specific point, this file wins — it is calibrated against ~14,500 lines of
already-shipped ko.json, not written from first principles.

---

## Register & address

**Use polite-formal register throughout: 합쇼체 (`-습니다`/`-입니다`) for
declarative and status text, 해요체 (`-세요`/`-하세요`) for instructions and
calls to action. Never 반말 (`-야`/`-해`), never the stiff command form
`-십시오`. Drop the subject pronoun — do not write `당신` ("you") in short UI
copy; Korean naturally omits it.**

Justification: this is the exact mix already shipped in `ko.json` — 142
occurrences of `-습니다` endings vs. 93 of `-세요` endings, **zero** occurrences
of `-십시오`, and only 7 stray uses of `당신` (all in long-form release notes,
none in tight UI microcopy). It reads as a competent operator tool, not a
military manual (`-십시오`) and not a casual chat assistant (반말).

Concrete forms:
- Status/system messages, confirmations, descriptions → `-습니다`/`-입니다`:
  `"언어가 변경되었습니다"`, `"자격 증명이 이미 구성됨"`.
- Instructions, hints, CTAs phrased as a sentence → `-세요`/`-하세요`:
  `"확인하려면 {name}을(를) 입력하세요"`.
- Buttons, menu items, tab labels → **bare noun or verb-stem, no ending at
  all**: `저장`, `취소`, `닫기`, `복사`, `편집`. Do not turn a button into a
  full sentence (`저장합니다` is wrong for a button; `저장` is right).
- Never add `당신` to recover a subject a sentence "needs" — restructure to
  drop it. Reserve `당신` (if ever) for long-form prose (release notes,
  onboarding copy), never for a tooltip, error, or button.

---

## Casing

Hangul has no letter case, so English Title Case does not translate as a
concept — there is no "capitalize the first letter of a sentence" rule to
port, and no German-style noun-capitalization question either. The casing
work in this language is entirely about **what to do with embedded Latin
text**:

- Brand names, technical identifiers, and model names keep their **original
  English casing exactly**, inline in a Korean sentence, with no adaptation:
  `API`, `OAuth`, `GitHub`, `SQLite`, `JSON`, `Claude`. Never lowercase them
  to "blend in," never re-capitalize a lowercase one.
- Numbers, percent signs, and currency symbols carry no casing and attach
  directly to the placeholder: `{pct}%`, `${cost}` — these are runtime-
  formatted, don't touch them.
- A Korean particle attaches directly to an English word or placeholder with
  **no space and no case change**: `Slack이(가)`, `{label}은(는)`.
- Section/tab labels are short noun phrases, not capitalized English-style
  headlines — there is nothing to capitalize, just keep them short (see
  Length discipline).

---

## Typography & punctuation

- **Ellipsis: always the real glyph `…`, never three periods `...`.** The
  shipped file is inconsistent here (462 literal `...` vs. 210 real `…`) —
  that inconsistency is legacy drift, not a convention to continue. All new
  translation must use `…`.
- **Quotes: plain straight double quotes `"…"`**, matching the file's
  overwhelming existing convention (curly `" "` appears only 3 times across
  14,500+ lines; corner brackets `「」`/`『』` are not used at all). Wrap a
  quoted term or a placeholder standing in for a name directly in `"..."`,
  e.g. `"\"{query}\"와 일치하는 항목이 없습니다"`. Don't introduce curly quotes
  or corner brackets to "look more Korean" — it would be a new convention,
  not a followed one.
- **No full-width CJK punctuation (`。` `、` `（）`) — this is a Chinese/
  Japanese convention that does NOT apply to Korean.** Zero instances exist
  in the shipped file. Korean is written with spaces between words (띄어쓰기)
  and ordinary half-width Latin punctuation: `.` `,` `!` `?` `(` `)`. This
  overrides the generic "CJK uses full-width punctuation" guidance in the
  root glossary for this locale specifically.
- **The `·` separator**: never translate it, keep one space on each side —
  `"성공률 {pct}% · 오늘 {today}건"`.
- **Placeholder particles need the dual form.** A `{placeholder}` might
  resolve to a word ending in a consonant or a vowel, and Korean's object/
  subject/topic particle changes shape depending on which. Since the
  translator can't know at compile time, write **both forms together**,
  attached directly with no space: `을(를)`, `이(가)`, `은(는)`, `과(와)`,
  `(으)로`. This is used constantly in the shipped file —
  `"{name}을(를) 삭제할까요?"`, `"{label}이(가) 제안함"`,
  `"{persona}을(를) {group}(으)로 이동했습니다"`. Do this every time a
  particle would attach to a placeholder; picking a single form is wrong
  roughly half the time.
- **Word-spacing (띄어쓰기) is real in Korean** — unlike Chinese/Japanese,
  don't run words together. A particle attaches to its host word with no
  space; separate words get a space, same as the shipped file throughout.
- **Counters/classifiers are mandatory after a number.** Korean nouns take a
  counter word after `{count}` — `개` (generic objects), `건` (cases/
  incidents), `회`/`번` (times/occurrences), `일` (days), `명` (people). Never
  leave a bare `{count}` followed straight by a noun. See Pitfalls.
- **No exclamation marks in errors, no "Oops."** Calm, declarative, ends in a
  period or nothing (short labels take no terminal punctuation at all).

---

## Length discipline

Korean UI strings usually run **shorter in character count** than English —
no articles, terser noun/verb-stem forms, and postpositions do the
grammatical work that English spends whole words on (`취소` vs. "Cancel",
`저장` vs. "Save", `확인` vs. "Confirm", `없음` vs. "None"). But each Hangul
syllable block is visually **wider** than a Latin letter (full-square glyph,
roughly 1.5–1.8× the width of a Latin character in most UI fonts), so the
character-count win does **not** translate into a proportional pixel-width
win — budget by rendered width, not character count.

Practical rules:
- **Buttons/badges**: target 2–4 Hangul syllables. Use the bare noun or
  verb-stem (`저장`, `삭제`, `복사`, `승인`), never a full sentence
  (`저장하겠습니다` is too long and wrong register for a button).
- **Table headers / narrow columns**: compress to a bare noun, drop
  particles entirely (`상태`, `모델`, `비용`, not `상태는` or `모델을`).
- **Body text, tooltips, error messages**: expect roughly parity with
  English, sometimes 10–20% longer, because particles and the formal verb
  ending add characters English doesn't need. This is fine in a full-width
  sentence context — the discipline only bites in fixed-width chrome.
- If a translated label still doesn't fit a fixed-width slot, shorten by
  dropping the particle or the verb ending before you shorten the noun
  itself — the noun carries the meaning.

---

## Loanword policy

This is the single biggest source of drift, so the rule is binary, not a
spectrum:

> **If the term names a *kind of thing* in the app's taxonomy — especially a
> short tab/section label or a playful product metaphor — borrow it as a
> transliteration (외래어), written in Hangul, no native substitute.**
> **If the term names an *action, process, state, or judgment* applied to
> those things, use the existing naturalized Sino-Korean (한자어) word —
> don't invent a "purer" native-Korean alternative.**

Borrowed (외래어) — product nouns / metaphor labels:
`페르소나` persona · `에이전트` agent · `커넥터` connector · `템플릿` template ·
`레시피` recipe · `볼트` vault · `트리거` trigger · `이벤트` event · `스킬` skill ·
`워크플로` workflow (**no trailing 우** — `워크플로우` is the common mistake;
the shipped file consistently drops it) · `체인` chain · `코크핏` cockpit ·
`트윈` twin · `플리트` fleet · `랩` lab · `스케줄` schedule · `모니터` monitor ·
`아레나` arena · `브레인` brain (generic label sense — see Termbase for the
brand-name exception).

Translated (Sino-Korean, already naturalized) — actions/process/state:
`자격 증명` credential · `초안` draft · `승격` promote · `검토` review ·
`승인` approval · `복구` healing · `기능` capability · `배포` deployment ·
`개요` overview · `실행` execution/run · `등급` tier · `알림` alert.

Never invent a third option when the termbase below already has an entry —
e.g. don't reach for `저장소` for vault, `역량`/`능력` for capability, or
`되돌리기` for promote. The shipped precedent always wins over a "more
native-sounding" alternative you think of mid-session; if you genuinely
believe the shipped choice is wrong, flag it per glossary §4 rather than
silently diverging.

---

## Termbase

| English | Korean | Note |
|---|---|---|
| persona | 페르소나 | Borrowed. The app's central noun. Must read as distinct from *agent* — never collapse the two. |
| agent | 에이전트 | Borrowed. Distinct word from *persona* — this is the load-bearing pair the glossary calls out; Korean already has two natural loanwords for it, so there's no need to borrow one and translate the other. |
| capability | 기능 | Sino-Korean ("function/feature"). Shipped choice, not a perfect semantic fit for "a contract the persona fulfils," but consistency beats a more precise invented alternative — keep it. |
| connector | 커넥터 | Borrowed. The *type* of integration; the bound instance is a **credential**, not a "connection." |
| credential | 자격 증명 | Sino-Korean compound ("qualification proof"). Never "인증서" (certificate — a different, more literal document sense). |
| vault | 볼트 | Borrowed transliteration of "vault," not the native "금고" (safe/strongbox). |
| recipe | 레시피 | Borrowed — the culinary metaphor already reads naturally in Korean since 레시피 is common everyday vocabulary for cooking. Distinct from **template**. |
| template | 템플릿 | Borrowed. Distinct from **recipe**. |
| trigger | 트리거 | Borrowed. |
| execution | 실행 | Sino-Korean ("carrying out"). Same word as **run** — keep noun/verb usage consistent. |
| run | 실행 | Same rendering as **execution**, both as noun and verb; this collapse is intentional (glossary explicitly allows it). |
| schedule | 스케줄 | Borrowed transliteration — not the native "일정" (which reads more like a calendar appointment than a recurring automation trigger). |
| deployment | 배포 | Sino-Korean ("distribution/deployment"). |
| healing | 복구 | Sino-Korean ("recovery/restoration"). Never a medical "치료"/"치유" (cure/healing) — this is infrastructure repair, not medicine. |
| fleet | 플리트 | Borrowed transliteration. |
| draft | 초안 | Sino-Korean ("draft manuscript"). |
| promote | 승격 | Sino-Korean ("promotion/elevation" — moving something up a level). Never "광고" (advertise). |
| review | 검토 | Sino-Korean ("review/examine"). The step; the outcome is **approval**. |
| approval | 승인 | Sino-Korean ("approval/authorization"). Distinct from *review* — review is the act of looking, approval is the verdict. |
| lab | 랩 | Borrowed — matches the already-shipped precedent (`연구 랩` "research lab," `리서치 랩`). Keep short, it labels a tab. |
| overview | 개요 | Sino-Korean ("outline/summary"). |
| monitor | 모니터 | Borrowed. |
| cockpit | 코크핏 | Borrowed transliteration — confirmed by shipped Athena copy (`"...종료하면 코크핏으로 돌아갑니다"`). Do not translate the metaphor literally (e.g. "조종석" reads aeronautical, not like a control surface). |
| event | 이벤트 | Borrowed. |
| alert | 알림 | Sino-Korean/native compound ("notice"). **Same word the product already uses for "notification"** (`tray_notifications` → 알림 too) — this is intentional; Korean UI conventionally doesn't lexically split alert vs. notification, context disambiguates. Don't invent a second word to force a distinction English doesn't need here either. |
| chain | 체인 | Borrowed. Distinct from **workflow**. |
| workflow | 워크플로 | Borrowed. **Spelling note:** no trailing 우 — write `워크플로`, not `워크플로우`. Distinct from **chain**. |
| skill | 스킬 | Borrowed. |
| tier | 등급 | Sino-Korean ("grade/level"). Keep the tier **names** in English per the root glossary (in this codebase the shipped tier labels are literally `Simple`/`Power`, not `Starter`/`Team`/`Builder` — check `tiers.*_label` before hardcoding a name). |
| twin | 트윈 | Borrowed. |
| director | **Director** (untranslated) | **Not translated, ever — treat as a proper name**, the same way `Athena` is. This overrides the root glossary's generic "translate or borrow": every shipped occurrence (`"Director는 시스템 페르소나이므로..."`, `"Director의 코칭 범위"`, `"Director 평결"`) keeps the Latin word `Director` with a Korean particle attached directly, because Director is the *name* of the meta-persona feature, not a generic job title in this product. |
| brain | 브레인 (generic label) / **Obsidian Brain** (untranslated, brand) | Two senses. As the **plugin's product name** — always paired as `Obsidian Brain`, both words untranslated, exactly like `Google Drive` would be. As a **generic tab/metaphor label** elsewhere (e.g. the Twin editor's memory step), borrow it: `브레인`, consistent with how `twin`/`cockpit`/`fleet`/`lab` are handled. |

---

## Pitfalls

**1. Dropping the dual-particle form on placeholders.**
A `{placeholder}` might resolve to a consonant-final or vowel-final word —
you can't know which, so write both particle forms together.
- Wrong: `"{name}가 연결되었습니다"` — breaks the moment `{name}` = `"Slack"`
  (consonant-final; needs `이`, not `가`).
- Right: `"{name}이(가) 연결되었습니다"`

**2. Missing the counter/classifier after a number.**
Korean nouns need a counter word after a bare number; English "N files" has
no equivalent structural requirement.
- Wrong: `"{count} 파일 첨부됨"`
- Right: `"{count}개 파일 첨부됨"`

**3. ASCII three dots instead of the real ellipsis.**
- Wrong: `"불러오는 중..."`
- Right: `"불러오는 중…"`

**4. Register slippage into 반말 or the stiff `-십시오` command form.**
Both read wrong for a professional tool addressing an operator — one too
casual, one too militaristic.
- Wrong: `"지금 저장해"` (반말) / `"지금 저장하십시오"` (parade-ground formal)
- Right: `"지금 저장하세요"` (sentence) or just `"저장"` (button)

**5. English SVO calque instead of a natural Korean connective clause.**
Machine translation tends to preserve English clause order and just swap
words, producing a technically-parseable but visibly-translated sentence.
- Wrong: `"이것은 시스템 페르소나입니다, 그래서 삭제할 수 없습니다"`
- Right: `"시스템 페르소나이므로 삭제할 수 없습니다"` (the shipped line, and the
  natural Korean reason-clause construction `-이므로`)

**6. Inventing a new word instead of reusing the termbase.**
The most common way "agent" and "persona" blur together, or "capability"
drifts to a synonym, is a translator reaching for a fresh word mid-sentence
instead of checking the table above.
- Wrong: `"이 에이전트에는 아직 역량이 없습니다"` (invents 역량 for *capability*,
  breaking consistency with the rest of the product)
- Right: `"이 에이전트에는 아직 기능이 없습니다"`
