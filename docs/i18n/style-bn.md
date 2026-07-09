# Bengali (bn) style guide

Companion to `glossary.md`. Read that file first — this one is the Bengali-specific
ruling on top of it. Evidence for every decision below comes from the ~75% of
`src/i18n/locales/bn.json` that is already shipped, real, human-reviewed Bengali —
not from the ~25% that is still raw English (that raw English, e.g. most of
`twin.*`, `overview.cockpit.*`, and the `plugins.companion.model_tier_*` keys, is
the gap the 40 translator agents are closing, not a style precedent). Counts
below are grep counts against the shipped file at the 2026-07-10 sweep.

## Register & address

Use **আপনি** (formal "you") with the matching formal verb ending everywhere —
imperatives, instructions, error text, confirmations. The shipped corpus has
**zero** occurrences of তুমি/তোমার or তুই/তোর against hundreds of আপনি/আপনার —
this is a fully settled, zero-exception convention, not a stylistic lean.

- Imperative/button verbs take the formal **-উন/-ুন** ending: সংরক্ষণ করুন
  ("save"), মুছুন ("delete"), বাতিল করুন ("cancel"), আবার চেষ্টা করুন ("retry"),
  চালিয়ে যান ("continue"). Never the bare/familiar root (কর, দ্যাখ) and never a
  তুমি-form (করো, দেখো).
- Possessives addressed to the user are **আপনার** ("your"): "আপনার এজেন্ট প্রস্তুত"
  ("your agent is ready"), never তোমার.
- The formal ending already carries the politeness — don't stack "দয়া করে"
  ("please") on top of it in ordinary UI copy (see Pitfalls #4).

Justification: Personas is a professional developer tool addressed to an
operator, and আপনি is the only register the shipped corpus uses.

## Casing

Bengali script has no letter case — there is nothing to capitalize or
lower-case inside a Bengali string, so "sentence case vs. Title Case" as a rule
doesn't act on Bengali text itself. Where it *does* apply:

- **Never re-case an embedded Latin brand/technical term.** `API`, `JSON`,
  `SQLite`, `Personas`, `Claude`, `GitHub` keep their exact English casing when
  they appear inside a Bengali sentence — don't lowercase them, and don't
  invent a pseudo-capitalized Bengali form for a transliterated version.
- **Don't imitate English Title Case by capitalizing every embedded Latin
  word in a phrase.** If a string legitimately keeps two Latin words together
  (rare — most product-concept nouns transliterate into Bengali script, see
  Loanword policy), leave their casing exactly as the brand/identifier itself
  defines it, nothing more.
- Buttons and labels are short verb phrases or plain nouns, not noun-phrase
  "titles" — "সংরক্ষণ" ("save"), not an English-Title-Case-style compound like
  "সংরক্ষণ পরিবর্তন" for "Save Changes" unless the product genuinely needs both
  words.
- A sentence still reads as one sentence: one idea, ending in **।** (see
  Typography) — never a run-on capitalized-phrase style copied from English UI
  conventions.

## Typography & punctuation

- **Ellipsis: always the real glyph `…`, never three periods `...`.** The
  shipped file is inconsistent here (488 literal `...` vs. 206 real `…`) —
  that inconsistency is exactly the kind of drift this guide exists to stop.
  Every new string must use `…`; do not "fix" it by copying whichever variant
  a neighboring key happens to use (`common.loading` still ships as
  `"লোড হচ্ছে..."` — wrong; a new key must render `"লোড হচ্ছে…"`).
- **Sentence-ending punctuation is the Bengali daŗi/danda `।`, not the Latin
  period `.`.** 1,373 uses of `।` in the shipped file — e.g.
  `"এই ক্রিয়াটি পূর্বাবস্থায় ফেরানো যাবে না।"` Reserve the Latin `.` for
  abbreviations, decimals, and inside code/URLs/emails. Bengali has no native
  question mark or exclamation mark of its own — reuse the Latin `?`, and per
  the format contract's calm-errors rule, avoid `!` in UI copy altogether
  (the formal imperative ending already supplies the urgency a button needs).
- **Quotes: plain straight double quotes `"…"`.** Bengali has no dedicated
  native quotation glyph, and the shipped corpus is overwhelmingly ASCII `"`
  (curly `“ ”` appears only 4 times, effectively noise) — stay with `"…"`, use
  `'…'` only for a quote nested inside another quote.
- **Numerals: use Bengali digits (০-৯) for a literal, static quantity written
  into ordinary prose; leave Latin digits (0-9) alone for technical
  identifiers.** This is the opposite convention from Hindi/`style-hi.md` and
  is well-evidenced here: `"গত ২৪ ঘণ্টায়"` ("in the last 24 hours"),
  `"এজেন্ট ২+ মিনিট ধরে"` ("agent for 2+ minutes"), `"ত্রুটির হার ৫০% ছাড়িয়ে"`
  ("error rate exceeds 50%"), even `"$০.০১"` ("$0.01") all use Bengali digits
  for the number itself. Latin digits stay Latin only where the number is
  really a code, not a quantity: ports/IPs (`127.0.0.1:9420`), version strings
  (`Flash v2.5`, `AES-256-GCM`), aspect ratios (`9:16`), and anything inside a
  `{placeholder}` — the runtime formats those, never hardcode a script into a
  placeholder's rendered value. Do not mix scripts on the same quantity — the
  shipped `"গ্যালারিতে 1টি নতুন সম্পদ"` (Latin `1` + Bengali classifier `টি`) is a
  visible bug, not a pattern to copy; it should read `১টি`.
- **Classifiers glue directly onto the number/placeholder with no space**:
  `{count}টি`, `২৪টি`, `৫জন` — never `{count} টি` with an intervening space. See
  Pitfalls #2 for the classifier itself.
- **ZWJ (U+200D), not ZWNJ, is this script's real gotcha**, and it shows up
  specifically in the "-rya-" consonant cluster of English loanwords: রank →
  `র‍্যাঙ্কিং` ("ranking"), `র‍্যাপ` ("wrap") — the visible `্য` half-form after
  `র` needs a ZWJ inserted between `র` and `্য`, or it collapses into an
  unreadable ligature. The shipped file gets this right in
  `agents.*.fitness_ranking` (7 correct ZWJ occurrences) — copy that pattern
  whenever you transliterate a new "R + consonant" English loanword. Plain
  ZWNJ (U+200C) is essentially unused in this corpus (1 occurrence) and not a
  tool you need reach for.
- **Latin proper nouns take a hyphen before an attached Bengali case
  suffix**, never a bare concatenation or a space: `Director-এর` ("Director's"),
  `Athena-কে` ("[tag] Athena"), `API-এর জন্য` ("for the API"),
  `{seconds}s-এ` ("in {seconds}s"). This is the established, consistent
  convention for every Latin word/placeholder that needs a Bengali postposition
  or genitive glued onto it — always insert the hyphen, never omit it or add a
  space instead.
- No RTL marks apply (Bengali is LTR). No full-width punctuation (a CJK
  convention) — `{}`, `()`, `:`, `%` stay half-width Latin glyphs.
- `·` middot separators, `{placeholders}`, URLs, emoji, code identifiers pass
  through byte-for-byte per the glossary — unaffected by script.

## Length discipline

Measured across ~9,100 already-translated key pairs in this file, Bengali runs
**about 8% longer than English by raw character count** — but that
undersells the practical space problem, because Bengali conjuncts and vowel
signs (matras) stack above/below/beside the base consonant and commonly render
*visually* wider per character than a Latin letter at the same font size, even
when the code-point count is close. Treat Bengali as needing meaningfully more
horizontal room than the raw ratio suggests, especially for anything that
can't reflow:

- **Buttons**: keep to the shortest correct verb, one or two words —
  "সংরক্ষণ" not "পরিবর্তন সংরক্ষণ করুন" unless the longer phrase is the
  *existing* shipped string for that exact action. A button that wraps is a
  bug, not a translation-quality problem to solve with a shorter font.
- **Badges/counters/narrow columns**: prefer the transliterated noun over a
  constructed native compound — `{count} সতর্কতা` beats inventing a longer
  native paraphrase; `স্কোর` alone beats "প্রাপ্ত স্কোরের পরিমাণ". The shipped
  corpus already makes this call for most Termbase nouns below.
- **When a native phrase and a borrowed word are both viable**, pick the
  borrowed word for width-constrained surfaces (tab labels, chips, table
  headers) and reserve the fuller native phrasing for body copy/help text
  where wrapping is expected and cheap.
- Classifiers (`টি`/`জন`, see Typography) add a syllable to every counted
  noun — budget for it; it's mandatory grammar, not an optional flourish you
  can drop to save space.

## Loanword policy

This is the highest-leverage decision in the whole guide, so: **be decisive,
follow the majority pattern already shipped, do not "improve" it toward a more
literary/native vocabulary.** The corpus's actual pattern, by frequency:

1. **Core product/domain nouns transliterate, not translate**, even where a
   native word exists and even though it means holding two near-synonyms
   apart: পার্সোনা (persona), এজেন্ট (agent), কানেক্টর (connector, 92×),
   ক্রেডেনশিয়াল (credential, 226× — the dominant choice), ভল্ট (vault),
   রেসিপি (recipe), টেমপ্লেট (template, 108×), ট্রিগার (trigger, 135×),
   এক্সিকিউশন (execution, 130×), ইভেন্ট (event, 173×), ফ্লিট (fleet), চেইন (chain),
   ওয়ার্কফ্লো (workflow), স্কিল (skill), ডিপ্লয়মেন্ট (deployment), ল্যাব (lab),
   মনিটর (monitor). When a new English term isn't in the Termbase below and
   doesn't obviously fall into bucket 3/4 below, default to transliteration —
   it's the dominant pattern and it's what keeps buttons short.
2. **Product/plugin surface names transliterate into Bengali script, not
   Latin script** — টুইন (Twin), ব্রেইন (Brain), ডিরেক্টর (Director),
   ককপিট (Cockpit). The file has drifted badly here: most of `twin.*`,
   `overview.cockpit.*`, and the Director tab label still show bare Latin
   "Twin"/"Cockpit"/"Director" — **that drift is gap, not policy.** Always
   emit the Bengali transliteration, including in headings and tab labels.
   Reason: unlike a brand (Personas, Claude, Athena — never touched, see the
   glossary's do-not-translate list), these are feature/plugin *concept*
   names — a lone Latin word stranded inside a Bengali sentence breaks script
   rhythm and font shaping far more than the equivalent would in a Latin-script
   target language. Exception: **"Obsidian Brain"** as the plugin's own
   compound display name may stay as a unit (Obsidian is the do-not-translate
   brand half of the pair) — translate the generic noun "brain" to ব্রেইন
   everywhere else (recall/viewer copy, sentences describing the concept).
3. **Everyday verbs and connective tissue are native Bengali**, not
   transliterated — করুন, চালান, মুছুন, বন্ধ করুন, সচল/অচল, সফল, ব্যর্থ, আবশ্যক,
   ঐচ্ছিক. Don't transliterate "enable"/"disable"/"required"/"optional" —
   native words already fully own this territory.
4. **Domain-abstraction nouns without a clean 1:1 borrow go native**: সক্ষমতা
   (capability — never ফিচার "feature" or যোগ্যতা "generic ability"),
   পর্যালোচনা (review), অনুমোদন (approval), খসড়া (draft), সময়সূচি (schedule),
   সারসংক্ষেপ (overview), সতর্কতা (alert). These read as normal professional
   Bengali, not as awkward calques, which is why they beat the transliterated
   alternative here even though bucket 1 is the majority pattern overall.
5. **"রান" (transliterated) is the noun, "চালান" (native) is the verb** — keep
   this split. "রান মুছুন" (delete the run) but the Run button reads "চালান",
   never "রান করুন".
6. **Reject a false-friend native word even when it's already shipped.**
   `sidebar.credentials` currently ships as শংসাপত্র, which literally means
   "certificate/diploma" — exactly the false friend the glossary calls out by
   name ("prefer the locale's word for access data/secret, not certificate").
   Use ক্রেডেনশিয়াল (already the majority choice, 226× vs. 30×) for every new
   key; fix শংসাপত্র opportunistically when you touch a file that has it, but
   this is not a mandate to bulk-migrate.

## Termbase

| English | Bengali | note |
|---|---|---|
| persona | পার্সোনা | Transliterated with the র্স conjunct (208× shipped) — **not** পারসোনা (36× — a competing, less accurate spelling that also happens to be the majority spelling inside the `monitor.*` section specifically; normalize toward পার্সোনা whenever you touch a file that has the other spelling). The app's central noun — must read distinct from এজেন্ট. |
| agent | এজেন্ট | Transliterated. Distinct word from পার্সোনা — the two must never collapse to one Bengali term even though English sometimes uses them near-synonymously in older copy. |
| capability | সক্ষমতা | Native ("capacity/competence, a fulfilled contract"). Not ফিচার ("feature") and not যোগ্যতা (generic "ability/eligibility"). |
| connector | কানেক্টর | Transliterated. The connector *type* (Slack, GitHub…) — distinct from ক্রেডেনশিয়াল, the bound instance. |
| credential | ক্রেডেনশিয়াল | Transliterated (226×, dominant). **Not** শংসাপত্র ("certificate/diploma" — a real false friend still shipped at `sidebar.credentials`; see Loanword policy #6). |
| vault | ভল্ট | Transliterated. Already carries the Bengali "bank strongbox" sense on its own, satisfying "safe/strongbox, not cellar" without a native calque. |
| recipe | রেসিপি | Transliterated/loanword — the culinary metaphor lands naturally in Bengali. Keep visually distinct from টেমপ্লেট. |
| template | টেমপ্লেট | Transliterated (108×). |
| trigger | ট্রিগার | Transliterated (135×). |
| execution | এক্সিকিউশন | Transliterated noun (130×). **Not** সম্পাদন — that word visually/aurally collides with সম্পাদনা ("edit", `common.edit`), a guaranteed confusion in a tool where both concepts sit one tab apart. |
| run | noun: রান · verb: চালান | Keep the split. "৩টি রান" (3 runs) but the Run button/action is always চালান, never "রান করুন". |
| schedule | সময়সূচি | Native ("timetable"). As a verb ("schedule this trigger") use "সময়সূচি নির্ধারণ করুন" — not the awkward bare "সময়সূচি করুন". |
| deployment | ডিপ্লয়মেন্ট | Transliterated (21×). **Not** প্রকাশ — that word is already load-bearing for "publish/expose" elsewhere (gallery publish, event-bus publish, exposed resources); reusing it for "deployment" creates a real collision. |
| healing | হিলিং | Transliterated/loanword ("অটো-হিলিং" for auto-healing, 25×). Never নিরাময় or চিকিৎসা (medical cure/treatment) — the product means automatic remediation, not medicine. |
| fleet | ফ্লিট | Transliterated (21×). |
| draft | খসড়া | Native (49×, dominant over the transliterated ড্রাফট, 10×) — well established. |
| promote | উন্নীত করুন | Native verb ("elevate"). Keep distinct from প্রকাশ করুন ("publish/expose") and সক্রিয় করুন ("activate/enable") — three different existing verbs; don't collapse them into one. |
| review | পর্যালোচনা | Native (127×, dominant). |
| approval | অনুমোদন | Native (86×). Keep paired with পর্যালোচনা — a review that ends in an approval — never used interchangeably. |
| lab | ল্যাব | Transliterated, short — labels a tab. Use it even in headings/tab titles (`agents.chat_thread.send_to_lab` still ships bare "Send to Lab" — that's gap, not policy). |
| overview | সারসংক্ষেপ | Native, short — the sidebar/dashboard route label. Don't drift toward the longer "সংক্ষিপ্ত বিবরণ" variant seen in one certification tab; pick সারসংক্ষেপ everywhere for consistency. |
| monitor | মনিটর | Transliterated. "পার্সোনা মনিটর" is the shipped page title. |
| cockpit | ককপিট | Transliterated/loanword — Bengali already borrows "cockpit" for aviation contexts, so it reads naturally and stays short. Currently shipped as bare English "Cockpit" everywhere (`sidebar.cockpit`, `overview.cockpit.title_default`) — that's the gap to close, not a precedent to follow. |
| event | ইভেন্ট | Transliterated (173×). |
| alert | সতর্কতা | Native ("caution/alert", 27×, dominant over অ্যালার্ট, 2×). Already doubles for the "warning" severity token elsewhere in this app (`attention_warning`) — that overlap is fine and matches how English "alert"/"warning" overlap conceptually too; don't invent a second word to force a split the app itself doesn't make. |
| chain | চেইন | Transliterated (26×). "রিট্রাই চেইন" (retry chain). |
| workflow | ওয়ার্কফ্লো | Transliterated (31×, dominant over the native calque কর্মপ্রবাহ, 2×). |
| skill | স্কিল | Transliterated (12×, dominant over দক্ষতা, 5×). Keep visually distinct from সক্ষমতা (capability) — they must never be used for each other. |
| tier | স্তর | Native ("level"). Tier **names** (Starter, Team, Builder) stay in English per the glossary — only the common noun "tier" itself is translated. Currently shipped bare-English everywhere (`plugins.companion.model_tier_title`, etc.) — that's the gap to close. |
| twin | টুইন | Transliterated (27×). Use it in the plugin/tab heading too — don't leave the bare Latin "Twin" that most of `twin.*` still ships today. |
| director | ডিরেক্টর | Transliterated. Use in every context including the tab heading (`agents.executions.tab_director` still ships bare "Director") — this is a feature/concept name, not a brand, so unlike Personas/Claude/Athena it must be translated everywhere, not left in Latin script. |
| brain | ব্রেইন | Transliterated for the generic concept — "ব্রেইন ভিউয়ারে খুলুন" (open in Brain Viewer) is already shipped correctly. Exception: "Obsidian Brain" as the plugin's own compound display name may stay as a unit (Obsidian is the do-not-translate brand half); translate the bare "brain" noun everywhere else. |

## Pitfalls

1. **Missing the numeral classifier (টি/জন) on a counted noun.** Bengali
   requires a classifier glued onto any number before a counted noun; dropping
   it is the single most obvious "this was machine-translated" tell.
   - Wrong: `"{count} পার্সোনা পাওয়া গেছে"` / `"৩ পার্সোনা"`
   - Right: `"{count}টি পার্সোনা পাওয়া গেছে"` / `"৩টি পার্সোনা"` — classifier
     glued directly to the number/placeholder, no space (see Typography).

2. **A plural suffix leaking into a `_one` key.** Plural handling is separate
   keys (`_one`/`_other`), not ICU — and in a `_one` key the count is always 1,
   so the noun must stay singular even though a classifier is still required.
   - Wrong (`channel_new_messages_one`): `"{count}টি নতুন বার্তাগুলো"` (adds the
     colloquial plural suffix গুলো on top of a count of 1 — contradictory).
   - Right: `"১টি নতুন বার্তা"` — the shipped, correct form: classifier present,
     no plural suffix.

3. **English SVO word order calqued instead of Bengali's verb-final order.**
   Bengali is SOV; a literal word-for-word rendering of an English sentence
   reads as obviously foreign.
   - Wrong: `"মুছুন এই পার্সোনাটি এখনই?"` (verb-first calque of "Delete this
     persona now?")
   - Right: `"এই পার্সোনাটি এখনই মুছবেন?"` (verb at the end, formal question form)

4. **Stacking "দয়া করে"/"অনুগ্রহ করে" ("please") on top of the formal verb
   ending.** The **-উন/-ুন** ending already signals politeness; adding
   "please" on every button/instruction reads as stilted over-translation.
   - Wrong: `"দয়া করে সংরক্ষণ বোতামে ক্লিক করুন"` (please click the save button)
   - Right: `"সংরক্ষণ করুন"` — reserve an explicit "please" for a genuinely
     high-stakes, irreversible confirmation, not ordinary buttons.

5. **Leaving English words bare mid-sentence instead of translating the
   whole clause.** This is the literal shape of today's untranslated gap —
   not a hypothetical risk.
   - Wrong (shipped today, `monitor.no_reviews`): `"কোনো pending reviews for
     this পারসোনা."`
   - Right: `"এই পার্সোনার জন্য কোনো অমীমাংসিত পর্যালোচনা নেই।"` (also fixes the
     পারসোনা→পার্সোনা spelling and the `.`→`।` punctuation in the same pass)

6. **Inconsistent script/spelling for the same borrowed word.** Two failure
   modes, both already present in the shipped file:
   - Conjunct drift: `পারসোনা` (missing the র্স conjunct) next to the correct
     `পার্সোনা` — normalize to `পার্সোনা` whenever you touch a string that has
     the other spelling.
   - Digit-script drift: `"গ্যালারিতে 1টি নতুন সম্পদ"` (Latin `1` glued to a
     Bengali classifier) instead of `"গ্যালারিতে ১টি নতুন সম্পদ"` — pick one
     script per quantity (Bengali digits for prose quantities, see
     Typography) and never mix mid-token.
