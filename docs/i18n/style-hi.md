# Hindi (hi) style guide

Companion to `glossary.md`. Read that file first — this one is the Hindi-specific
ruling on top of it. Evidence for every decision below comes from the ~75% of
`src/i18n/locales/hi.json` that is already shipped, real, human-reviewed Hindi —
not from the ~25% that is still raw English (that raw English is the gap the 40
translator agents are closing, not a style precedent).

## Register & address

Use **आप** (formal "you") with the matching **करें / सहेजें / हटाएँ**-class formal
verb forms everywhere — imperatives, instructions, error text, everything.
Never use तुम or तू (both are absent from the shipped file — 0 occurrences —
against 435 occurrences of आप). Concretely:

- Buttons/commands: verb stem + **-ें** (सहेजें "save", हटाएँ "delete", भेजें "send",
  रद्द करें "cancel", पुनः प्रयास करें "retry").
- Instructions to the user: "आपका …", "अपना …" (e.g. "अपना जवाब लिखें…" = "write
  your reply…"), never a bare/blunt imperative root without the -ें ending.

Justification: Personas is a professional developer tool addressed to an
operator, and आप is the only register the shipped corpus uses — zero exceptions.

## Casing

Hindi (Devanagari) has no letter case, so "capitalize the first word" does not
apply the way it does in Latin scripts — there is nothing to capitalize inside a
Devanagari string. The casing decision that *does* transfer is: **don't
Title-Case-imitate by capitalizing an embedded Latin word or acronym that
doesn't need it.** Concretely:

- Leave technical identifiers and brand names exactly as they appear in English
  (`API`, `JSON`, `SQLite`, `Personas`, `Claude`) — don't lowercase them, don't
  invent a Devanagari-style pseudo-capital.
- Sentence-level punctuation and rhythm carry the "sentence case" idea instead:
  one idea per sentence, ending in **।** (see Typography), not a run-on Title
  Case phrase.
- Buttons/labels are short verb phrases, not noun-phrase titles: "सहेजें" not
  "सेव करना" as a label.

## Typography & punctuation

- **Ellipsis: always the real glyph `…`, never three periods `...`.** The
  shipped file is inconsistent here (485 literal `...` vs 210 real `…`) — that
  inconsistency is exactly the kind of drift this guide exists to stop. Every
  new string must use `…`. Do not "fix" it by copying whichever variant you see
  in a neighboring key.
- **Sentence-ending punctuation is the Devanagari danda `।`, not the Latin
  period `.`** — 1,585 uses in the shipped file vs. the Latin period reserved
  for abbreviations, decimals, and inside code/URLs/emails. `"चिंता न करें।"` not
  `"चिंता न करें."`. Mid-sentence dashes/parentheticals stay as-is (`--`, `(...)`
  patterns already in the file are fine to keep).
- **Quotes: plain straight double quotes `"…"`.** Hindi has no dedicated native
  quotation glyph and the shipped corpus uses ASCII `"`, not curly `“ ”` or
  Latin guillemets — stay consistent with what's already there rather than
  introducing a glyph the rest of the file never uses.
- **Numerals stay Western (`0-9`), never Devanagari numerals (`०-९`).** 1,218
  Western-digit occurrences, 0 Devanagari-digit occurrences in the shipped
  file — this is a fully settled convention, not a personal choice.
- **ZWNJ (U+200C):** the shipped file has zero ZWNJ characters. Prefer the
  standard/common spelling of a word that never needs a joiner-breaking mark
  (e.g. संबंध, not a ZWNJ-split variant) rather than reaching for one. If a
  specific word genuinely requires ZWNJ to render its conjunct correctly, use
  the real U+200C code point — never a visible substitute like a hyphen or
  space.
- No RTL marks apply (Devanagari is LTR). No full-width punctuation (that's a
  CJK convention) — always half-width Latin punctuation for `{}`, `()`, `:`, `%`.
- `·` middot separators, `{placeholders}`, URLs, emoji: pass through byte-for-byte
  per the glossary — this is unaffected by script.

## Length discipline

Hindi in this corpus runs **noticeably longer than English** for full sentences
(Devanagari conjuncts + postpositions add width) but **shorter or equal for
single-word UI labels**, because so many of them are borrowed/transliterated
1:1 (टेम्पलेट, मॉनिटर, ड्राफ्ट, कनेक्टर are the same syllable count as their English
source). The length problem shows up specifically in:

- **Buttons**: keep to the shortest correct verb form. "सहेजें" not "परिवर्तन
  सहेजें" unless the longer form is the *existing* shipped string for that exact
  action. When a button's natural Hindi phrasing would wrap, cut qualifiers
  first ("आगे बढ़ें" → "जारी रखें" is already the established choice for
  "Continue"), not the verb.
- **Badges/counters**: prefer the transliterated noun over a native compound —
  "{count} अलर्ट" not "{count} चेतावनी सूचनाएं" — the shipped corpus already makes
  this call for अलर्ट, स्किल, टियर, चेन, वर्कफ़्लो, etc. (see Termbase).
- **Narrow columns / table headers**: abbreviate by dropping the postposition
  chain, not the noun — "स्कोर" alone beats "प्राप्त स्कोर की मात्रा".
- When in doubt on a short surface, transliterate rather than translate — a
  borrowed word is reliably shorter than compounding a native phrase.

## Loanword policy

This is the highest-leverage decision in the whole guide, so: **be decisive,
follow the majority pattern already shipped, do not "improve" it toward a more
literary/native vocabulary.** The corpus's actual pattern, by frequency:

1. **Core product nouns are transliterated, not translated**, even where a
   native word exists: पर्सोना (persona), एजेंट (agent), कनेक्टर (connector),
   क्रेडेंशियल (credential), वॉल्ट (vault), रेसिपी (recipe), टेम्पलेट (template,
   118 occurrences — the single most consistent term in the file), ट्रिगर
   (trigger), शेड्यूल (schedule), डिप्लॉयमेंट (deployment), ड्राफ्ट (draft), मॉनिटर
   (monitor), अलर्ट (alert — chosen over चेतावनी "warning", which is reserved for
   the distinct severity-level concept), चेन (chain), वर्कफ़्लो (workflow), स्किल
   (skill), टियर (tier), लैब (lab).
2. **Product/plugin surface names transliterate into Devanagari script, not
   Latin script** — ट्विन (Twin), ब्रेन (Brain), फ्लीट (Fleet), डायरेक्टर (Director),
   कॉकपिट (Cockpit). The file has drifted on this (some keys still show bare
   Latin "Twin"/"Fleet"/"Director"/"Brain"/"Cockpit") — that drift is gap, not
   policy; always emit the Devanagari transliteration form. Reason: a lone
   Latin-script word stranded inside a Devanagari sentence breaks the visual
   rhythm and font shaping far more than it does in Latin-script target
   languages — the whole point of transliterating is to keep the sentence in
   one script.
3. **Everyday verbs and connective tissue are native Hindi**, not transliterated
   — करें, चलाएँ, हटाएँ, बंद करें, सक्षम करें, सफल, विफल, आवश्यक, वैकल्पिक. Don't
   transliterate "enable"/"disable"/"required"/"optional" — native words already
   own this territory completely.
4. **Domain-abstraction nouns without a snappy 1:1 borrow go native**: क्षमता /
   क्षमताएँ (capability — never "फीचर" or "एबिलिटी"), समीक्षा (review), अनुमोदन
   (approval), निष्पादन (execution), अवलोकन (overview), उपचार (healing — a broad
   everyday word for "remedy/fix", not the clinical इलाज).
5. **"रन" (transliterated) is the noun, "चलाएँ" (native) is the verb** — keep
   this split. "रन हटाएं" (delete the run) but the Run button reads "चलाएँ", never
   "रन करें".

When a new English term isn't in the termbase below and doesn't obviously fall
into category 3/4 above, default to **transliteration** — it's the dominant
pattern in this locale and it's what keeps buttons short (see Length
discipline).

## Termbase

| English | Hindi | note |
|---|---|---|
| persona | पर्सोना | Transliterated. The app's central noun — never confuse with एजेंट. |
| agent | एजेंट | Transliterated. Distinct word from पर्सोना — the two must never collapse to one Hindi term even though English sometimes uses them near-synonymously. |
| capability | क्षमता (sg.) / क्षमताएँ (pl.) | Native. Not "फीचर", not "एबिलिटी". |
| connector | कनेक्टर | Transliterated. Distinct from क्रेडेंशियल (the bound instance). |
| credential | क्रेडेंशियल | Transliterated. Not "सर्टिफिकेट". |
| vault | वॉल्ट | Transliterated. Fully consistent across the file — never "तिजोरी"/"भंडार". |
| recipe | रेसिपी | Transliterated. Distinct from टेम्पलेट. |
| template | टेम्पलेट | Transliterated. The single most-repeated term in the corpus (118×) — never vary the spelling. |
| trigger | ट्रिगर | Transliterated. |
| execution | निष्पादन | Native (Sanskrit-derived). Sidebar label "निष्पादन", used throughout observability copy. |
| run (noun) | रन | Transliterated noun — "delete the run" = "रन हटाएं". |
| run (verb) | चलाएँ | Native verb — the Run button reads "चलाएँ", never "रन करें". Keep noun/verb split. |
| schedule | शेड्यूल | Transliterated. |
| deployment | डिप्लॉयमेंट | Transliterated. |
| healing | उपचार | Native, broad "remedy/fix" sense — not the clinical इलाज. |
| fleet | फ्लीट | Transliterated (Devanagari script, not Latin "Fleet"). |
| draft | ड्राफ्ट | Transliterated. |
| promote | प्रकाशित करना (publish) | Native — glossary explicitly wants "publish/activate" over "advertise"; प्रकाशित is the shipped word for publish-type actions across events, teams, and gallery/community flows. Use "प्रकाशित करें" for the promote-a-draft action. |
| review | समीक्षा | Native. Distinct from अनुमोदन (approval, the record of approving one). |
| approval | अनुमोदन | Native. Keep paired with समीक्षा, never used interchangeably. |
| lab | लैब | Transliterated (Devanagari, not Latin "Lab"). |
| overview | अवलोकन | Native. Sidebar/dashboard route label. |
| monitor | मॉनिटर | Transliterated. "पर्सोना मॉनिटर" is the shipped page title. |
| cockpit | कॉकपिट | Transliterated (Devanagari, not Latin "Cockpit"). |
| event | इवेंट | Transliterated. |
| alert | अलर्ट | Transliterated — chosen over चेतावनी ("warning"), which the file reserves for the severity-level concept, not the surfaced-problem concept. |
| chain | चेन | Transliterated. "चेन कैस्केड" (chain cascade), "ट्रिगर और चेन" (triggers and chains). |
| workflow | वर्कफ़्लो | Transliterated. |
| skill | स्किल | Transliterated. "स्किल्स" title, "स्किल चुनें" (select a skill). |
| tier | टियर | Transliterated when used as the pricing/feature-level word itself. Keep the tier NAMES (Starter, Team, Builder) in English per the glossary — don't translate the brand names even though "टियर" the word is Hindi-script. |
| twin | ट्विन | Transliterated (Devanagari, not Latin "Twin"). The digital-twin plugin. |
| director | डायरेक्टर | Transliterated (Devanagari, not Latin "Director"). The meta-persona scoring surface. |
| brain | ब्रेन | Transliterated (Devanagari, not Latin "Brain"). The Obsidian-brain plugin surface. |

## Pitfalls

1. **ICU/plural syntax leaking into rendered text.** The shipped file has a
   real, live bug at `agents.lab.run_arena` — the value is literally
   `"{count} {count, plural, one {} एरिना चलाएं ( मॉडल अन्य {s}})"`. That's a
   previous machine translation attempting to "translate" ICU plural syntax it
   didn't recognize as code. There is no ICU in this runtime (see the format
   contract) — plurals arrive as separate `_one`/`_other` keys and you translate
   only the natural-language value.
   - Wrong: `"{count} एजेंट, प्लूरल, एक {एजेंट} अन्य {एजेंट्स}"`
   - Right (as a `_one` key): `"{count} एजेंट"` — Right (as an `_other` key): `"{count} एजेंट्स"` or, more idiomatically, keep the same noun without a plural suffix since Hindi often doesn't mark plural on a following counted noun: `"{count} एजेंट"` for both, if that's the more natural reading for the specific noun.

2. **Renaming or recasing a placeholder to match Hindi grammar.** `{count}`,
   `{name}`, `{persona}` must appear byte-identical in the Hindi string. You may
   move the placeholder to wherever Hindi word order wants it (verb-final,
   postpositions after the noun) but the token itself is frozen.
   - Wrong: `"{संख्या} एजेंट"` (translated the name) or `"{Count} एजेंट"` (recased it).
   - Right: `"{count} एजेंट"` (moved or not, spelling untouched).

3. **Postposition calque from English preposition order.** English "for this
   persona" translates word-for-word as "इस पर्सोना के लिए" and that's correct —
   but a common machine-translation error is to leave the postposition (के लिए,
   में, पर, से) stranded at the *front* the way an English preposition would sit,
   producing "के लिए इस पर्सोना" — ungrammatical. Postpositions always trail
   their noun in Hindi.
   - Wrong: "के लिए यह क्षमता" (calqued "for this capability")
   - Right: "इस क्षमता के लिए"

4. **Translating "Personas" the brand.** Per the glossary's trap: lowercase
   "persona(s)" (the common noun for a configured agent) becomes पर्सोना/पर्सोनाs,
   but capital-P "Personas" (the product) never does. A frequent slip is
   over-correcting and transliterating the brand too, e.g. rendering
   `chrome.app_title` as "पर्सोनाज़" — wrong, it must stay "Personas".
   - Wrong: `"Personas में एक क्लिक में"` → don't touch "Personas"; but a common
     miss goes the other way — `"पर्सोनाज़ में एक क्लिक में"` is wrong because it
     translates the brand.
   - Right: `"Personas में एक क्लिक में यह एजेंट खोल सकता है।"` (brand untouched,
     verb phrase around it in Hindi).

5. **Mixing "..." and "…" within the same PR.** Because the shipped corpus is
   already inconsistent (485 vs. 210), it's tempting to pattern-match a
   neighboring key that still has "...". Always emit `…`, regardless of what a
   nearby unrelated key does — don't let existing drift justify new drift.

6. **Literal-script product surface names left in Latin inside a Hindi
   sentence.** `"Fleet निष्पादन जिन्होंने मूल्य प्रदान किया"` (mixing Latin "Fleet"
   into an otherwise Devanagari sentence) is exactly the drift item #2 under
   Loanword policy calls out. Always transliterate these five surface names —
   ट्विन, ब्रेन, फ्लीट, डायरेक्टर, कॉकपिट — never leave them in Latin script, even
   though older shipped keys sometimes do.
