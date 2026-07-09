# Vietnamese (vi) style guide — Personas

Companion to `docs/i18n/glossary.md`. Read that file first — this one only covers
what is specific to Vietnamese. Written from a full read of the glossary and a
line-by-line sample of `src/i18n/locales/vi.json` (monitor, common, chrome,
sidebar, vault, recipes, templates, triggers, schedules, tiers, twin, cockpit,
director sections). Roughly a quarter of `vi.json`'s values are still raw
English strings (untranslated gaps) — those were ignored as voice evidence;
only strings that were actually rendered into Vietnamese were used to derive
the rules below.

---

## Register & address

**Decision: use `bạn` for second person wherever a pronoun is grammatically needed;
drop the subject pronoun entirely for imperative commands and button labels.**
Never use `anh/chị/em` (gendered, age/hierarchy-marked honorifics) and never use
`mày/cậu/ấy` (informal/intimate register).

Justification: Vietnamese has no grammatical formal/informal verb conjugation
the way French (`vous`/`tu`) or German (`Sie`/`du`) do — the register signal
lives entirely in pronoun choice. `bạn` is the neutral, respectful-but-direct
"you" already used consistently across the shipped file (`"dữ liệu của bạn"`,
`"của bạn"`, `"cần bạn xử lý"`) and is the de facto standard for professional
Vietnamese software addressed to a single unknown operator — `anh/chị` would
force an age or gender guess about the user that the product has no basis for.
For commands (`Lưu`, `Hủy`, `Đóng`, `Xóa`, `Sửa`) drop the pronoun entirely; this
is standard Vietnamese imperative register and matches 100% of the button
labels already shipped — do not write `"Bạn hãy lưu"` for "Save".

---

## Casing

**Sentence case everywhere. Vietnamese has no noun-capitalization rule** (unlike
German) — capitalize only the first letter of the string and true proper nouns.
Never mirror English Title Case (`"Xây Dựng Tác Nhân"` is wrong; `"Xây dựng tác
nhân"` is right).

Three capitalization classes, evidenced from the shipped file:

- **Sentence-initial word** — capitalize only this: `"Đã lưu thay đổi"`, not
  `"Đã Lưu Thay Đổi"`.
- **Brand names & do-not-translate technical terms** — keep source casing:
  `Personas`, `Claude`, `GitHub`, `API`, `CLI`.
- **Borrowed proper feature names** — capitalize as a name because there is
  exactly one of it in the product: `Director` (the meta-persona), `Brain` (the
  Obsidian Brain plugin), `Cockpit` (the companion's control surface). These are
  shipped capitalized consistently (`"tab_director": "Director"`, `"brain_title":
  "Brain"`, `"cockpit": "Cockpit"`) — keep them that way, mid-sentence too.
- **Borrowed common nouns** — lowercase, because the user can have many of
  them: `persona`, `twin`, `workflow`. `"Tạo twin mới"` (lowercase twin) is
  correct; a capitalized `"Twin"` here would wrongly imply a single named
  entity like Director.

Buttons: short imperative, sentence case, no trailing period. A button that
wraps to two lines is a bug — see Length discipline below for what to do when
the natural Vietnamese phrase is too long.

---

## Typography & punctuation

- **Ellipsis: always the single glyph `…`, never three periods `...`.** This is
  the single most common typography defect already in the codebase — a scan of
  `vi.json` found **463** literal `...` against only **209** correct `…`, i.e.
  most existing ellipses are wrong. `"loading": "Đang tải..."` should be
  `"Đang tải…"`. Every new/edited string must use `…`.
- **Em dash: `—`, never a double hyphen `--`.** Same drift pattern:
  `"error_boundary_subtitle"` currently reads `"...Đừng lo -- dữ liệu của bạn
  vẫn an toàn..."` — the `--` should be `—`. Correctly-typeset strings already
  in the file use it right: `"Đây là nơi nhóm trao đổi — bàn giao, PR..."`.
- **Quotes: plain straight double quotes `"…"`.** Vietnamese digital
  typography has no widely-enforced distinct curly/guillemet convention the
  way French (`« »`) or German (`„ "`) do — a full scan of `vi.json` found
  **zero** curly-quote glyphs; every quoted string uses straight `"`. Match
  that; do not introduce `“ ”` or `« »` — it would be the only string in the
  file to do so.
- **No non-breaking space before `! ? : ;`** — Vietnamese, unlike French, uses
  normal spacing here.
- **Do use a non-breaking space (` `) between a number and its unit** in
  compact UI (badges, counters, chips) so the two never get orphaned across a
  line-wrap: `"10 phút"`, `"{count} mục"`. This matters more in
  Vietnamese than English because —
- **Vietnamese words are written syllable-by-syllable with spaces**, so a
  multi-syllable word (`"quản trị viên"` = one word, "administrator", three
  spaced syllables) can get torn across a line by naive whitespace-based
  wrapping or CSS `text-overflow: ellipsis` truncation. In a narrow column,
  prefer `white-space: nowrap` for short labels over trusting word-wrap, or
  shorten the term rather than let it fracture mid-word.
- **Diacritics are never optional.** Keep full tone marks always, even in the
  shortest button label — never romanize/strip accents for brevity (`"Duong"`
  for `"Dương"` is not an abbreviation, it's a different, wrong word).
- **Save as Unicode NFC (precomposed), not NFD (decomposed).** The rest of
  `vi.json` is NFC; mixing normalization forms inside one file breaks
  string-equality checks, `grep`, and diffing even when the text looks
  identical on screen.
- No RTL concerns, no ZWNJ-equivalent — Vietnamese is plain LTR Latin script.

---

## Length discipline

Vietnamese runs **noticeably longer than English for technical noun phrases**
(compound nouns built from Sino-Vietnamese + native syllables), but **imperative
verbs are usually the same length or shorter**. Measured against strings
already shipped:

| English | Vietnamese | Δ |
|---|---|---|
| Credential (10 chars) | Thông tin xác thực (19) | +90% |
| Persona Monitor (15) | Trình giám sát persona (23) | +53% |
| Connector (9) | Trình kết nối (13) | +44% |
| Save (4) | Lưu (3) | −25% |
| Cancel (6) | Hủy (3) | −50% |
| Delete (6) | Xóa (3) | −50% |

**Rule of thumb: budget +40–60% for descriptive/compound noun strings, but
expect buttons and single-word imperatives to fit in the same space or less.**
For narrow columns/badges/tab rails where a compound noun translation would
overflow (e.g. `lab` → "Phòng thí nghiệm", 4 syllables), prefer the borrowed
short form (`Lab`) over truncating the translated phrase — truncation of a
multi-syllable Vietnamese compound reads as broken, not abbreviated. Never
invent an abbreviation by dropping diacritics or syllables (no "PTN" for
"phòng thí nghiệm" — that acronym doesn't exist for users).

---

## Loanword policy

Decisive split, so 40 translators don't re-litigate it per string:

**Stays borrowed (do not translate), lowercase, treated as a normal Vietnamese
noun grammatically:**
`persona` · `twin` · `workflow` — plus everything in glossary §1 (`API`, `CLI`,
`cron`, `webhook`, `MCP`, …), plus **model names** (`Haiku`, `Sonnet`, `Opus` —
already shipped untranslated) and **tier NAMES** (`Starter`, `Team`, `Builder`
— see Pitfalls, this is currently violated in the shipped file).

**Stays borrowed, capitalized, as a proper feature name** (there is exactly one
of it in the product): `Director` · `Brain` · `Cockpit`.

**Gets a native Vietnamese word — no exceptions:**
`agent` → tác nhân · `capability` → năng lực · `connector` → trình kết nối ·
`credential` → thông tin xác thực · `vault` → kho lưu trữ · `recipe` → công thức
· `template` → mẫu · `trigger` → trình kích hoạt · `execution` → thực thi ·
`run` → chạy · `schedule` → lịch trình · `deployment` → triển khai ·
`healing` → tự phục hồi · `fleet` → đội · `draft` → bản nháp · `promote` →
thăng cấp · `review` → đánh giá · `approval` → phê duyệt · `lab` → phòng thí
nghiệm · `overview` → tổng quan · `monitor` → trình giám sát · `event` → sự
kiện · `alert` → cảnh báo · `chain` → chuỗi · `skill` → kỹ năng · `tier`
(the word itself) → gói.

The test for "borrow vs. translate": is this a **name** (Director, Brain,
Cockpit, a tier's brand name, a model name) or a **concept** (agent, vault,
fleet)? Names don't translate. Concepts do.

---

## Termbase

| English | Vietnamese | Note |
|---|---|---|
| persona | **persona** (borrowed, lowercase, invariant — no Vietnamese plural marker) | The app's central noun. Never render as tác nhân or tác tử — see Pitfalls. |
| agent | **tác nhân** | Must stay visibly distinct from persona. Do not use tác tử (inconsistent legacy variant — see Pitfalls). |
| capability | năng lực | Not năng khiếu ("talent") or khả năng ("generic ability") — năng lực reads as a fulfillable contract, which matches the product meaning. |
| connector | trình kết nối | Consistent across the whole file already; don't shorten to kết nối alone (that reads as the verb "to connect" / the bound instance, not the connector type). |
| credential | thông tin xác thực | Long but established (19 chars) — do not invent a shorter synonym per string; consistency beats brevity here. |
| vault | kho lưu trữ | Canonical. The file currently also has bare borrowed "vault"/"Vault" in several strings — those are legacy drift, not a second valid rendering. |
| recipe | công thức | Literal "recipe/formula" reading works naturally in Vietnamese; keep distinct from template. |
| template | mẫu | Distinct from công thức (recipe). mẫu alone is short — good for tabs/badges. |
| trigger | trình kích hoạt | Noun (the mechanism). If a verb "to trigger" is needed use kích hoạt (drop trình). |
| execution | thực thi | Noun. |
| run | chạy (verb) / lần chạy (noun, "a run") | Keep chạy for the button/action; lần chạy when counting instances ("next 3 runs" → "3 lần chạy tiếp theo"). |
| schedule | lịch trình | Short/adjectival contexts (interval config, cron detail) may use lịch alone — already shipped that way; lịch trình is the canonical full noun. |
| deployment | triển khai | Very consistent already; also doubles as the verb "to deploy". |
| healing | **tự phục hồi** | Deliberately overrides the shipped "chữa lành" — see Pitfalls. Use phục hồi as the bare verb ("agent is healing" → "tác nhân đang phục hồi"). |
| fleet | đội | Distinct from nhóm (which is reserved for human "teams" in Team Collaboration). Never use nhóm for fleet — that would collide with the Teams feature. |
| draft | bản nháp (full) / nháp (short badge) | Already consistent in the file. |
| promote | thăng cấp | Good existing metaphor (level-up), keep it — don't switch to "công bố" (publish), which loses the draft→live staging nuance. |
| review | đánh giá | Also used for the noun "a review"/"reviews". |
| approval | phê duyệt | Same word serves the verb "approve" — normal in Vietnamese, verbs don't conjugate. |
| lab | phòng thí nghiệm (full) / Lab (borrowed, tight chrome only) | Glossary flags this as "known-hard" — see Length discipline for when to use the short borrowed form. |
| overview | tổng quan | Very consistent, the dashboard route name. |
| monitor | trình giám sát | "Persona Monitor" → "Trình giám sát persona". |
| cockpit | **Cockpit** (borrowed, capitalized proper name) | Do not translate — there's exactly one Cockpit. |
| event | sự kiện | Very consistent (event bus → "Bus sự kiện", event log → "Nhật ký sự kiện"). |
| alert | cảnh báo | Consistent. |
| chain | chuỗi | "Retry chain" → "Chuỗi thử lại". |
| workflow | **workflow** (borrowed) | No native rendering has been adopted; quy trình làm việc is too long for UI use and isn't what's shipped — stay with the loanword. |
| skill | kỹ năng | Distinct from capability (năng lực) — skill is the packaged instruction set, capability is the declared contract. Don't conflate the two words. |
| tier | gói | Translate only the word "tier" itself. Tier NAMES (Starter, Team, Builder) stay in English — see Pitfalls, this is currently violated. |
| twin | **twin** (borrowed, lowercase common noun) | Users create multiple twins, so — unlike Director/Brain/Cockpit — this is not capitalized as a proper name. |
| director | **Director** (borrowed, capitalized proper name) | It's the name of the one meta-persona, not a generic word for "a director." |
| brain | **Brain** (borrowed, capitalized, as in "Obsidian Brain") | Plugin name, not a generic body-part/concept word. |

---

## Pitfalls

**1. Persona/agent three-way collapse.** The shipped file currently renders one
English concept three different ways in different places: `persona` sometimes
borrowed (`"Trình giám sát persona"`), sometimes `tác nhân`
(`"select_persona": "Chọn tác nhân"`); `agent` sometimes `tác nhân`
(`"all_agents": "Tất cả tác nhân"`), sometimes `tác tử`
(`"agents": "Tác tử"` in the very same `sidebar` section as `all_agents`).
- **Wrong:** `sidebar.agents = "Tác tử"` next to `sidebar.all_agents = "Tất cả tác nhân"` — two words for one concept in one file.
- **Right:** persona → `persona` (borrowed) everywhere; agent → `tác nhân` everywhere. Never `tác tử`.

**2. Healing as a medical cure (calque).** `chữa lành` literally means "to heal/
cure [a person]" — it imports a medical metaphor the glossary explicitly warns
against ("never medical cure"). It reads as if the software itself is sick.
- **Wrong:** `"healing_started": "Đã bắt đầu AI chữa lành"`
- **Right:** `"Đã bắt đầu AI tự phục hồi"` (self-recovery, no illness framing).

**3. Translating a tier's brand name.** The glossary is explicit: "keep the
tier NAMES in English." The shipped file currently violates this by treating
`Starter`/`Team` as plain adjectives rather than product names.
- **Wrong:** `"tiers.starter_label": "Đơn giản"` (literally "Simple") — this is
  Starter's actual marketing name, dropped.
- **Right:** `"Gói Starter"` (tier the *word* translated, the *name* untouched).

**4. ASCII ellipsis substitution.** A machine translator (or a human typing on
an English keyboard layout) defaults to three periods. Quantified: 463 wrong
instances vs 209 correct in this file alone.
- **Wrong:** `"loading": "Đang tải..."`
- **Right:** `"Đang tải…"`

**5. Double-hyphen for em dash.** Same keyboard-default failure mode as #4.
- **Wrong:** `"...Đừng lo -- dữ liệu của bạn vẫn an toàn..."`
- **Right:** `"...Đừng lo — dữ liệu của bạn vẫn an toàn..."`

**6. Treating a placeholder name as a translatable word because it looks like
one.** `{persona}` in `"subtitle": "{persona} persona · {attention} need
attention · {running} running"` is a **count** injected by code — not the word
"persona" you're translating around it. A translator scanning for the term
"persona" to localize can accidentally rename or recase the placeholder itself
(`{Personas}`, `{cá_nhân}`) and break the string at runtime (see format
contract: placeholder names are frozen, case-sensitive, ASCII-only). Translate
the surrounding words; move the placeholder if Vietnamese word order wants it
elsewhere; never touch what's inside `{ }`.
