# Arabic (ar) style guide — Personas Desktop

Companion to `docs/i18n/glossary.md`. Read that first — this file only covers
what's Arabic-specific. Evidence below is drawn from the ~75% of
`src/i18n/locales/ar.json` that is already shipped and voice-consistent; the
remaining ~25% raw-English gap is what 40 translator agents are closing, and
none of it is voice evidence (some of it isn't even valid Arabic — see
Pitfalls §1).

## Register & address

**Formal Modern Standard Arabic (فصحى), never a spoken dialect (عامية).**
Address the operator with the **masculine-singular verb form** for every
direct instruction — `اختر`, `أدخل`, `افتح`, `الصق` (choose / enter / open /
paste) — never the feminine (`اختاري`), dual, or plural conjugations, and
never switch forms mid-file.

Justification in one sentence: Arabic has no gender-neutral second person, so
masculine singular is the standard unmarked default in professional MSA
software copy (every OS- and product-level Arabic UI — and 100% of this
corpus's existing imperatives — uses it), and it's also the shortest, which
matters for buttons.

Corollary for buttons specifically: **prefer the verbal noun (المصدر) over
the imperative verb.** The corpus's buttons are almost entirely masdar form —
`حفظ` (save), `حذف` (delete), `إلغاء` (cancel), `نسخ` (copy), `تعديل` (edit),
`تحديث` (refresh) — not the imperative `احفظ`/`احذف`. This sidesteps gender
marking entirely and reads as a calm, professional label rather than a
command barked at the user. Reserve the imperative for full-sentence
instructions and hints (`اختر شخصية`, `أدخل مفتاح API`, `الصق رمز التفويض`).

Status/toast copy uses the impersonal passive, also already established:
`تم النسخ` (copied), `تم الحفظ` (saved), `جارٍ التحميل` (loading) — describe
the state of the system, don't address the user as the doer.

## Casing

Arabic has no letter case, so "sentence case vs Title Case" doesn't
literally apply — but there is a real, corpus-consistent analog:

- **Nav / section labels get the definite article `ال`.** Sidebar and tab
  labels are bare definite nouns: `الوكلاء`, `الإعدادات`, `القوالب`,
  `الفِرَق`, `السحابة`, `المعرفة`, `الأسطول`. This is the Arabic equivalent of
  English's bare Title Case noun.
- **Buttons/actions drop the article** and use the bare masdar: `حفظ` not
  `الحفظ`, `إلغاء` not `الإلغاء`. An article on a button reads as a noun
  label, not an actionable control.
- **Latin acronyms keep their original casing untouched** — `API`, `JSON`,
  `SLA`, `BYOM`, `KPI` are copied verbatim, never re-cased, transliterated,
  or given Arabic broken-plural morphology.
- **Digits are Western Arabic numerals (`0`–`9`), never Eastern
  Arabic-Indic (`٠١٢٣٤٥٦٧٨٩`).** Confirmed throughout the shipped file —
  `"15 دقيقة"`, `"24 ساعة"`, `"{pct}%"`. This is a common
  machine-translation reflex to fix: MT frequently "helpfully" converts
  digits to Eastern Arabic-Indic; don't let it.

## Typography & punctuation

- **Ellipsis:** real `…`, never `...`. About half the shipped strings still
  have the ASCII `...` (e.g. `"جارٍ التحميل..."`) — that's legacy debt, not
  the standard to copy. Every new/gap-filled string uses `…`.
- **Dash:** real em dash `—`, never a double hyphen `--`. Same situation —
  `"تعذّر تحميل القيم المحفوظة -- قد تحتاج..."` is legacy debt;
  `"تعذّر علينا بدء جلسة Claude — تأكّد..."` is the standard to match.
- **Question mark:** Arabic `؟` (mirrored), never Latin `?`. Confirmed
  throughout: `"حفظ التغييرات قبل المغادرة؟"`, `"تأكيد؟"`.
- **Comma inside an Arabic sentence:** Arabic `،`, never Latin `,`. Confirmed:
  `"{running} يعمل، {queued} في الانتظار"`. Keep Latin `,` only inside literal
  code/URLs/user content that isn't being translated.
- **Quotation marks:** Arabic guillemets `« »` — confirmed in shipped copy
  (`"اعتمدها في «المعرفة»"`). Some older strings wrap a placeholder in
  straight ASCII quotes (`\"{name}\"`) — that's legacy debt from the English
  source, not a pattern to extend; use `«{name}»` in new strings unless the
  quoted content is itself Latin/code, in which case straight quotes are fine
  (they're marking a literal, not Arabic prose).
- **Percent sign:** keep Latin `%` glued to the Western digit, e.g.
  `"{pct}%"` — do not switch to the Arabic percent sign `٪` or move it before
  the number. This matches 100% of the corpus's usage and is standard in
  Arabic tech/software registers even though print journalism sometimes uses
  `٪` before the figure.
- **Parentheses are not manually mirrored.** Type `(` and `)` in the same
  logical order you would in English — the Unicode bidi algorithm mirrors
  them visually at render time. Typing them pre-swapped produces the wrong
  glyph. See Pitfall §4.
- **Selective diacritics (تشكيل) on words prone to misreading.** Running
  Arabic prose in this product is undiacritized by default, but the corpus
  adds partial tashkeel to disambiguate specific UI/technical nouns whose
  unmarked form is genuinely ambiguous — `مُشغّلات` (triggers), `موصِّلات`
  (connectors), `مُعطَّل` (disabled), `مُفعَّل` (enabled). Do this only where a
  bare consonant skeleton would actually mislead; don't diacritize ordinary
  sentences.
- **RTL embedding around Latin/placeholder runs.** When a `{placeholder}`
  resolves to Latin text or a number and Arabic punctuation immediately
  follows it, the punctuation can visually attach to the wrong side without
  help. If you see this go wrong in a preview, insert an RTL mark (U+200F,
  not typed as a visible character but via escape/unicode input) immediately
  after the Latin/number run and before the Arabic punctuation. In practice
  this is rarely needed for short inline placeholders like `{count}` or
  `{pct}` (the bidi algorithm handles the common cases), but watch for it
  when a placeholder carries a whole Latin phrase (a URL, a version string)
  followed by an Arabic colon or period.
- Arabic has no ZWNJ requirement (that's a Persian/Urdu/Indic concern, not
  Arabic script) — don't insert one out of habit copied from another
  locale's guide.

## Length discipline

Short UI strings (buttons, badges, nav labels) run **about the same length
as English, occasionally shorter** — Arabic has no articles-and-plurals
overhead for single-word labels and the masdar convention (§ Register) keeps
buttons to one word just like English (`حفظ`/Save, `إلغاء`/Cancel).

Full sentences (hints, descriptions, error bodies) run **roughly 15–25%
longer**, mainly because Arabic grammatical agreement repeats the definite
article and gender/number marking across a noun and every adjective/verb
attached to it — there's no equivalent of English dropping "the" for brevity.

What to do about it:
- **Buttons/badges: cut, don't wrap.** If the natural translation of a
  button is a phrase, find the corpus's existing 1-word convention first
  (`حفظ`, `إغلاق`, `تجاهل`, `تحديث`) before inventing a longer alternative.
  A button that wraps to two lines is a bug regardless of language.
  `save_and_continue` → `حفظ ومتابعة` (two words) is already at the corpus's
  practical ceiling for a button; don't go longer.
- **Narrow columns/table cells:** prefer the bare noun over a full clause —
  status cells use single words (`جارٍ`, `مكتمل`, `فاشل`, `ملغى`), not
  sentences.
- **Hints/descriptions have room** — don't over-compress these into
  telegraphic fragments; a slightly longer, grammatically complete Arabic
  sentence reads better than a clipped calque of the English word order.

## Loanword policy

**Default to the native Arabic word for generic tech concepts. Borrow only
what's on the glossary's frozen do-not-translate list** (brands, protocol/
format identifiers). This corpus is decisive and consistent about it —
it never reaches for the colloquial-tech loanword when a clean MSA term
exists, even though everyday spoken tech Arabic often does:

| Concept | This product uses | NOT this common loanword |
|---|---|---|
| token | `الرمز` | `التوكن` |
| cache / buffering | `التخزين المؤقت` | `الكاش` |
| browser | `متصفح` | `براوزر` |
| plugin | `إضافة` / `الإضافات` | `بلقن` / `پلاگین` |
| sync | `مزامنة` | `سينك` |
| queue | `قائمة الانتظار` | `الكيو` |
| dashboard | `لوحة المعلومات` / `لوحة التحكم` | `الداشبورد` |
| notification | `إشعار` | `نوتيفيكيشن` |
| log / history | `السجل` | `اللوق` |

**Never invent a new transliteration for a generic noun** — if a term isn't
on the do-not-translate list and isn't in the Termbase below, translate it
natively; don't split the difference by transliterating it into Arabic
letters. The only borrowing that happens in this product is the frozen list
verbatim in Latin script (brands, `API`/`CLI`/`JSON`/`MCP`/`OAuth`/etc.) —
Arabic never phonetically respells them (`ايه بي اي` for API does not
appear anywhere and must not start now).

Compound terms mixing a frozen identifier with a generic word: translate the
generic word, freeze the identifier — `مفتاح API` (API key), `خادم MCP` (MCP
server), `مصادقة OAuth` (OAuth authentication).

## Termbase

All 32 glossary §2 terms below. `persona` and `agent` get **distinct**
renderings — see Pitfall §1 for the one place the shipped file already gets
this wrong.

| English | Arabic | note |
|---|---|---|
| persona | شخصية (pl. شخصيات) | The common noun — a configured AI agent. Always this word, never وكيل. `common.all_personas` = `جميع الشخصيات`. |
| agent | وكيل (pl. الوكلاء) | Used where the English source literally says "agent" (older surfaces, the runtime actor). Must stay visibly different from شخصية — see Pitfall §1. |
| capability | قدرة (pl. القدرات) | Not مهارة (that's `skill`) and not ميزة ("feature"). |
| connector | موصِّل (pl. موصِّلات) | The type/class of integration. Never بلقن/إضافة (that's `plugin`, a different app concept) and never اتصال ("connection" — the bound instance is `credential`). |
| credential | بيانات الاعتماد (or اعتماد for a single one) | Never شهادة ("certificate"). Stays consistent whether singular or the collective form. |
| vault | الخزنة | Never قبو ("cellar") or مستودع ("warehouse") — a strongbox, not a storage room. |
| recipe | وصفة (pl. الوصفات) | Keeps the culinary metaphor — already reads naturally in Arabic. Must stay visually distinct from `template`. |
| template | قالب (pl. القوالب) | Distinct from وصفة. This is the prebuilt, adopted-as-is catalog entry. |
| trigger | مُشغِّل (pl. مُشغِّلات) | The condition/config object. (A section *header* asking "when does this run" may render as `متى` — that's a different, page-heading use, not the noun.) |
| execution | تنفيذ | The formal record — status, cost, output. |
| run | تشغيل | The colloquial/verb form — `تشغيل الآن` (run now), `آخر تشغيل` (last run). Keep `تنفيذ`/`تشغيل` consistent with how the English source alternates execution/run. |
| schedule | الجدول / الجدول الزمني | Use the shorter `الجدول` in tight UI, the fuller `الجدول الزمني` in headings/descriptions. |
| deployment | النشر | The verb/noun pair: نشر (deploy) → عمليات النشر (deployments). |
| healing | الإصلاح | Self-repair/fix, never a medical "cure" (لا `علاج`/`شفاء`). Compose `إصلاح تلقائي` (auto-healing) when the automatic aspect needs to be explicit. |
| fleet | الأسطول | Consistent throughout (`نبض الأسطول` = fleet heartbeat). |
| draft | مسودة | Consistent (`المسودة جاهزة` = draft ready). |
| promote | ترقية (verb: رقّى / تمت ترقيته) | Never الإعلان/"advertise". `ترقية للإنتاج` = promote to production. |
| review | مراجعة | Consistent, and pairs with `approval` below. |
| approval | موافقة | The act/record of approving. Keep `مراجعة`/`موافقة` as a fixed pair — don't let a translator swap them. |
| lab | المختبر | Translated, not borrowed — already shipped (`tab_lab`). |
| overview | نظرة عامة | Consistent (dashboard route). |
| monitor | المراقب (verb: مراقبة) | `مراقب الشخصيات` = persona monitor. |
| cockpit | القمرة (full form: قمرة القيادة) | **Currently untranslated in the shipped file (gap) — this is the decision to fill it with.** Literal "cockpit," short enough for a tab/badge. Use the full `قمرة القيادة` only in a heading/description where space allows. |
| event | حدث (pl. أحداث) | Consistent. |
| alert | تنبيه (pl. تنبيهات) | Consistent (`قواعد التنبيه` = alert rules). |
| chain | سلسلة | Consistent (`تسلسل السلسلة` = chain cascade). |
| workflow | سير العمل | Consistent, distinct from سلسلة (chain = personas wired in sequence; workflow = the multi-step orchestration, often n8n-flavored in this product). |
| skill | مهارة (pl. المهارات) | Distinct from قدرة (`capability`) — a packaged instruction set the CLI/persona invokes, not a persona's declared capability contract. |
| tier | المستوى | **Not yet a literal key in en.json as of this sweep — decision for when it lands.** Translate the word "tier"; keep tier NAMES (Starter, Team, Builder) in English untranslated. Don't reuse `الفئة` — that word is already spoken for by `category` elsewhere in the product. |
| twin | توأم | Consistent throughout the twin plugin (`إنشاء توأم جديد`, `اختر التوأم النشط`). |
| director | المدير | Consistent (`حكم المدير` = director's verdict, `لم يراجعه المدير بعد` = not yet reviewed by the director). Reads as "the manager" — that's intentional; it's the business-value-scoring meta-persona. |
| brain | الدماغ | Consistent (`أكبر تعزيز للدماغ` = biggest boost to the brain) — the metaphor lands in Arabic, so it's translated literally, not borrowed. |

## Pitfalls

**1. Collapsing `persona` and `agent` into one word — already happened once,
don't repeat it.** `en.json`'s `sidebar.agents` = "Agents" and a separate
`…personas` key = "Personas" are two different concepts per the glossary's
Personas-trap rule, but the shipped `ar.json` translates **both** to
`الوكلاء`, erasing the distinction the glossary explicitly mandates.
- Wrong: `"personas": "الوكلاء"` (when the English source says "Personas")
- Right: `"personas": "الشخصيات"` — reserve `الوكلاء` strictly for source
  strings that literally say "agent(s)."
Check the English key/value before choosing, not just the surrounding UI —
this is a real, shipped drift, not a hypothetical.

**2. Renaming or Arabic-suffixing a placeholder — already happened once.**
`monitor.subtitle` in the shipped file reads:
`"{شخصيةs} شخصيةs · {attention} need attention · {running} running"`
against an English source of
`"{personas} personas · {attention} need attention · {running} running"`.
Two separate failures stacked in one string: the placeholder name `{personas}`
was translated to `{شخصيةs}` (illegal — `\w` is ASCII and case/spelling-exact,
so this renders literally on screen instead of substituting), *and* a Latin
plural `s` was stapled onto an Arabic word.
- Wrong: `{شخصيةs} شخصيةs`
- Right: keep `{personas}` byte-identical, translate only the surrounding
  text and drop the bolted-on `s`: `{personas} شخصية`
Never append Latin `-s` to pluralize an Arabic (or a frozen acronym) word —
not even to a do-not-translate token like `KPI`. If the caller didn't supply
a `_one`/`_other` variant key, pick the single Arabic noun form that reads
acceptably across counts rather than fabricating a fake plural suffix.

**3. Over-literal word-for-word order producing an English-shaped Arabic
sentence (a calque).** English front-loads the subject; Arabic verbal
sentences front-load the verb. A common MT tell is keeping the English
noun-first order.
- Wrong: `"التغييرات غير محفوظة سوف تُفقد"` (a stiff, English-ordered
  calque of "Unsaved changes will be lost")
- Right (matches the shipped convention): `"لديك تغييرات غير محفوظة ستُفقد
  إذا غادرت دون حفظ."` — lead with `لديك` ("you have"), Arabic's natural way
  to introduce an existing-state fact, then state the consequence.

**4. Manually swapping parenthesis/bracket glyphs "for RTL."** A translator
occasionally "corrects" `(` `)` to `)` `(` in the source string, assuming
Arabic needs them pre-mirrored.
- Wrong: typing `)بيتا(` to represent "(beta)"
- Right: type `(بيتا)` in the same logical order as English — the rendering
  engine's bidi algorithm mirrors the glyphs automatically. Manually swapping
  them produces doubly-mirrored (i.e. wrong) parentheses.

**5. Converting digits to Eastern Arabic-Indic numerals.** MT frequently
"localizes" `24` to `٢٤`.
- Wrong: `"٢٤ ساعة"`
- Right: `"24 ساعة"` — this product's Arabic keeps Western digits
  everywhere, matching every numeral already in the shipped file.

**6. Transliterating a generic tech noun instead of translating it.** Covered
in depth in Loanword policy, but concretely:
- Wrong: `"احفظ في الكاش"` (transliterating "cache")
- Right: `"التخزين المؤقت"` — see the Loanword policy table for the full list
  of generic nouns this product always translates natively.
