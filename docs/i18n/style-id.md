# Indonesian (id) style guide — Personas Desktop

Companion to `docs/i18n/glossary.md`. Read that first. This file is the
locale-specific contract: register, casing, typography, length, loanwords,
the full termbase, and the pitfalls a machine translator (or a careless human)
will hit in Indonesian specifically. When in doubt, this file wins over
instinct; if it doesn't cover a case, extend it and keep going — don't guess
silently.

Evidence base: `src/i18n/locales/id.json` as of 2026-07-09 (14,577 lines,
~11,500 keys). About a quarter of values are still raw English — that's the
gap this effort closes, not a style precedent. The rest of this file is
derived from the **shipped, translated three-quarters**, reconciled against
the glossary where the shipped file itself disagrees with itself (and it does,
in a few places called out below).

---

## Register & address

**Use formal `Anda` everywhere — capitalized, no exceptions, including
companion/Athena chat and onboarding copy.** Indonesian verbs don't conjugate
for person or formality (there is no Sie/Anda verb-form split like German or
French) — the entire register signal lives in the pronoun. That makes the
rule simple and absolute: **the second-person pronoun is always `Anda`,
never `kamu`, `kau`, `lo/lu`, or the bare imperative-with-implied-"kamu"
tone of casual chat apps.**

Justification: Personas is a professional developer tool addressed to an
operator, and the shipped file is already 100% consistent on this — every
sampled instance of a second-person reference uses `Anda` (`perubahan Anda`,
`koneksi Anda`, `Jelaskan tujuan otomatisasi pertama Anda`, `Twin Anda`).
There is no drift to fix here, unlike some other locales — keep it that way.

Two concrete implications for new copy:
- Always capitalize `Anda` (it is a proper term of address in Indonesian
  orthography, like a title), in every position in the sentence, not just
  sentence-initial.
- Imperatives (button labels, instructions) drop the pronoun entirely, as
  Indonesian imperative mood already does —`Simpan`, `Coba lagi`, not
  `Anda harus simpan`. This is not a register downgrade; formal Indonesian
  imperatives are bare-verb by default.

---

## Casing

**Sentence case for everything.** Capitalize only the first word of a
sentence/label and true proper nouns (Personas, Claude, GitHub, and the
product's own borrowed feature names — `Lab`, `Cockpit`, `Twin`, `Brain`,
`Director`, `Deployment`). Indonesian has no German-style
capitalize-every-noun rule and no English-style Title Case convention —
mid-sentence common nouns (`kredensial`, `kemampuan`, `konektor`) are always
lowercase.

Buttons and short labels: one or two words, sentence case, imperative for
actions — `Simpan`, `Batal`, `Coba lagi`, `Buka monitor`. **Not**
`Coba Lagi`, `Buka Monitor`. A button that wraps to two lines is a bug (see
Length discipline below).

> **Known drift to fix, not imitate:** the shipped file inconsistently
> Title-Cases short 2–3 word buttons and section headers, most likely because
> a translator (human or machine) pattern-matched the English source's Title
> Case instead of applying Indonesian sentence case. Examples: `"Simpan &
> Pindah"` (should be `"Simpan & pindah"`), `"Edit Cepat"` (should be `"Edit
> cepat"`), `"Ke Dasbor"` (should be `"Ke dasbor"`), `"Muat Ulang Aplikasi"`
> (should be `"Muat ulang aplikasi"`). Meanwhile plenty of other strings in
> the same file get it right (`"Simpan dan lanjutkan"`, `"Coba Lagi"` is
> actually the more common bad case but `"Segarkan"`, `"Batal"` etc. are
> fine as single words where casing is moot). Fix any Title-Cased 2+ word
> label you touch to sentence case; don't add new ones.

The **Personas trap** (see glossary) has no special casing wrinkle in
Indonesian the way it does in German — Indonesian doesn't capitalize common
nouns, so a lowercase `persona`/`personas` in running text is unambiguously
the common noun, and a capitalized `Personas` is unambiguously the brand.
Judge by the call site's meaning as usual, but in Indonesian the casing
itself is also a (weak, not sufficient-alone) signal — trust the meaning
first.

---

## Typography & punctuation

- **Ellipsis**: real `…` (U+2026), never three periods. **The shipped file
  gets this wrong more often than right** (473 literal `...` in translated
  Indonesian strings vs only 211 real `…`) — this is legacy debt, not a
  precedent to follow. Always use `…` going forward; fix `...` to `…` in any
  string you touch.
  Wrong: `"Memuat..."` · Right: `"Memuat…"`
- **Quotes**: plain straight double quotes `"…"`, matching the dominant
  shipped convention (198 escaped `\"…\"` instances vs only 3 stray curly
  `"…"`/`"…"` pairs — treat those 3 as copy-paste noise, not a second valid
  style). Indonesian orthography (PUEBI) has no distinct low-high or
  guillemet quote tradition the way German or French do — don't invent one.
  Use quotes only to wrap a literal user-supplied value
  (`Tidak ada persona yang cocok dengan "{query}"`), not for emphasis.
- **Dashes**: em dash `—` with a space on both sides for parenthetical
  asides and clause breaks (`"Kegagalan belum dibaca di {personaName} —
  selidiki"`). This is the dominant shipped pattern (511 correct vs 101
  legacy double-hyphen `--`). Fix `--` to `—` (with surrounding spaces) in
  any string you touch; don't introduce new `--`.
  Wrong: `"Tindakan ini -- tidak dapat dibatalkan"`
  Right: `"Tindakan ini — tidak dapat dibatalkan"`
- **The `·` separator**: never translated, never spaced differently than the
  source — already consistent in the shipped file (`"{reviews} tinjauan
  tertunda · {system} tugas sistem"`-style strings). Leave it exactly as it
  appears in English.
- **RTL marks / ZWNJ / full-width punctuation**: not applicable. Indonesian
  is written in unmodified Latin script, left-to-right, with ordinary ASCII
  punctuation spacing (no French-style non-breaking space before `: ! ? ;`,
  no CJK full-width `。、（）`). Nothing to do here.
- **Diacritics**: standard modern Indonesian spelling uses no diacritics
  (no `é`, `ê`, etc. — those only survive in a handful of loanwords like
  `café`, which don't occur in this product's vocabulary). Don't add accent
  marks a machine-translation model might hallucinate from Malay or French
  cognates.
- Numbers, dates, currency: never hardcode — always left to runtime
  formatting per the glossary. This applies unchanged to Indonesian (which,
  notably, uses comma as the decimal separator and period as the thousands
  separator — the *opposite* of English — which is exactly why this must
  never be hand-formatted in a translated string).

---

## Length discipline

Indonesian runs **close to English in short labels, and roughly 10–15%
longer on average across full sentences and body copy** — a direct character
count across ~10,000 matched, already-translated key/value pairs in the
shipped file puts it at **+11%** on average. This is much gentler than German
or French, but it isn't free, and the expansion is *not* evenly distributed:
single nouns are often the same length or shorter (`execution` → `Eksekusi`,
`notifications` → `Notifikasi`), while full sentences grow because Indonesian
needs more small grammatical words English omits or contracts (`yang`,
`untuk`, `dengan`, `akan`, `sudah`, `telah`).

Practical rules for narrow surfaces:
- **Buttons**: prefer the single-verb imperative over a verb phrase —
  `Simpan` not `Simpan sekarang` when a button already sits inside the form
  it saves; `Jalankan` not `Jalankan sekarang` unless "now" is doing real
  disambiguating work (e.g. "run now" vs "run later").
- **Badges / tab labels / counts**: drop connective words entirely and lead
  with the noun or number — `{count} tertunda` not `Ada {count} yang
  tertunda`, `Kredensial (3)` not `Terdapat 3 kredensial`.
- **Don't stack two verbs in one button.** English sometimes does
  (`Save & Switch`) — in Indonesian, prefer a single dominant verb
  (`Simpan`) and let the secondary action be implicit from context, or use
  the shortest connector (`Simpan & pindah`, not `Simpan dan kemudian
  pindah ke tab lain`).
- If a translated string still doesn't fit after applying the above, flag it
  in the run's review notes rather than truncating silently — a silently
  truncated Indonesian string reads as a typo, not a design choice.

---

## Loanword policy

Decisive, per-term — this is the single biggest source of translator drift
in this locale, because Indonesian has **two entirely different, both-valid
ways** to absorb an English tech word, and mixing them within one concept is
the error:

1. **Adapted-spelling absorption** (the KBBI/PUEBI standard route): the word
   is respelled to Indonesian phonetics/orthography and *becomes* Indonesian
   — it is not a code-switch, it's the correct native word.
   `computer`→`komputer`, `click`→`klik`, `dashboard`→`dasbor`,
   `export/import`→`ekspor/impor`, `configure`→`konfigurasi`,
   `connect`→`koneksi`, `session`→`sesi`, `version`→`versi`,
   `credential`→`kredensial`, `connector`→`konektor`,
   `execution`→`eksekusi`, `capacity`→`kapasitas`,
   `notification`→`notifikasi`, `draft`→`draf`. **Use these, not the raw
   English spelling** — writing `Dashboard` when `Dasbor` is the established
   absorbed form looks like laziness, not borrowing.
2. **Unassimilated borrowing** (kept as literal English, no respelling):
   reserved for product/feature *proper nouns* and a short list of
   developer-facing tech nouns with no naturalized Indonesian form in
   practice — `Lab`, `Cockpit`, `Twin`, `Brain`, `Director`, `Deployment`
   (the feature/section noun — see Termbase), `Plugin`, `Filter`, `skill`
   (lowercase inline, see Termbase), and the do-not-translate list in the
   glossary (API, CLI, JSON, webhook, OAuth, …).

**The decision rule**: if the concept is something a non-developer end user
configures or reads about routinely (persona, connector, credential, recipe,
capability, execution, schedule, event), use the adapted-spelling / native
word — that's what makes the UI feel actually localized, not just
Latin-alphabet English with sprinkled Indonesian grammar. If the concept is a
proper-noun-like *feature name* that labels a tab or a whole product surface
(Lab, Cockpit, Twin, Brain, Director), borrow it unassimilated — respelling
`Cockpit` to some invented Indonesian word would be both unnecessary and
harder for a developer user to recognize than the English name they already
know from the rest of the product's marketing and docs.

**Verbs are always native, never borrowed-as-a-verb.** `toggle` →
`alihkan`/`aktifkan`/`nonaktifkan` (never "toggle-kan"), `save` → `simpan`,
`browse` → `jelajahi`, `refresh` → `segarkan`. The one systemic exception is
`klik` ("click") — fully naturalized to the point of being the only word
Indonesian developer-tool UI ever uses for it; `mengklik`/`diklik` are
completely normal inflected forms. Don't reach for `menekan tombol` ("press
the button") as a NIH substitute — `klik` is correct and expected.

**Do NOT translate** (per glossary §1, unchanged for Indonesian): brand
names, technical identifiers (API, CLI, JSON, HTTP, cron, webhook, SQLite,
MCP, OAuth, JWT, SDK, npm, git, regex, UUID, KPI, LLM, CPU/GPU/RAM),
placeholders, emoji, `·`, URLs, code identifiers, enum/status codes.

---

## Termbase

Every term from `glossary.md` §2, with the Indonesian rendering actually
shipped (or the decisive fix where the shipped file contradicts itself).

| English | Indonesian | note |
|---|---|---|
| **persona** | persona / personas | Lowercase, lightly-naturalized loanword already common in Indonesian marketing/UX vocabulary (e.g. "brand persona"). This is the word the glossary's Personas-trap rule protects — lowercase `persona` is always the common noun; capitalized `Personas` is always the untranslated brand. Never render the common noun as `agen`. |
| **agent** | agen | Distinct word from persona — used for the runtime actor executing a persona, and in older UI surfaces near-synonymously with persona. Never mix the two within one string; if a sentence needs both concepts, use `persona` and `agen` exactly as the English source distinguishes them. |
| **capability** | kemampuan | **Fix needed**: shipped file mixes `kemampuan` (26 instances) with the stiffer, more Latinate `kapabilitas` (19 instances) for the identical concept. `kemampuan` is the natural, dominant, and correct Indonesian word for "a thing this persona can do" — standardize on it; treat `kapabilitas` as a drift to fix on sight. Must stay distinct from **skill** (see below). |
| **connector** | konektor | Adapted-spelling loanword, fully naturalized and 100% consistent in the shipped file. Not `plugin`, not `koneksi` (that's closer to the bound instance/credential). |
| **credential** | kredensial | Adapted-spelling loanword, extremely well established (380+ shipped instances). Not `sertifikat` ("certificate"). |
| **vault** | brankas | "Safe/strongbox" — well established (30+ shipped instances: `Brankas Kredensial`, `Brankas perlu perhatian`, `Impor dari Brankas Eksternal`). Not `gudang` ("warehouse"), not `ruang bawah tanah` ("cellar"). Capitalize as `Brankas` when it's the section/feature name; lowercase `brankas` in running prose ("diimpor ke brankas Anda"). |
| **recipe** | resep | Direct culinary-metaphor translation, reads naturally in Indonesian and is already the shipped, consistent choice ("Resep Tersimpan", "Ubah kemampuan ini menjadi resep..."). Must stay distinct from **template**. |
| **template** | templat | Adapted-spelling loanword, distinct from `resep` — a templat is adopted as-is; a resep is parameterized. |
| **trigger** | pemicu | Native word ("that which sets something off"), fully established as the standalone noun (`"triggers": "Pemicu"`, `"Pemicu Jadwal"`, `"Pemicu Aktif"`). Don't borrow "trigger" — Indonesian has no naturalized borrowed form of this one, unlike connector/credential. |
| **execution** | eksekusi | Adapted-spelling loanword, extremely well established (220+ shipped instances) — the dominant term in this product's vocabulary. |
| **run** | *verb*: jalankan · *noun*: proses | The verb is unambiguous and universal (`Jalankan`, `Jalankan ulang`, `Jalankan Persona`). The noun ("compare two runs") is less consistent in the shipped file; the clearer of the two shipped patterns is `proses` (`"compare_runs": "Bandingkan proses"`) — prefer it over borrowing "run" as a bare noun (`"Hapus run"` is a shipped gap/drift, not a pattern to repeat). When the noun really means "one execution", `eksekusi` is also acceptable and sometimes clearer — pick whichever reads less awkwardly in context, but never leave the English word "run" bare as a noun. |
| **schedule** | jadwal | Native word, fully established and consistent (`"Jadwal"`, `"Pemicu Jadwal"`, `"Jadwalkan"` as the derived verb). |
| **deployment** | Deployment (feature/section noun) · penerapan (the act of deploying, in body/status copy) | The shipped file genuinely splits these two senses and does so consistently: the section/tab/page name is always the borrowed `Deployment` (`"title": "Deployment"`, `"Semua Deployment"`), while the action described in a sentence is the native `penerapan` (`"Penerapan gagal"`, `"penerapan alur kerja"`). Keep this split — don't force one word to cover both; a translator collapsing everything to `Deployment` would produce awkward verb-less body copy, and collapsing everything to `Penerapan` would break the established page/tab title. |
| **healing** | penyembuhan | Chosen deliberately as the "recovery" metaphor (as in "wound healing"/self-repair), **not** a disease-cure framing — Indonesian `penyembuhan` reads as recovery/repair in a mechanical-systems context, not as "being cured of an illness" the way an over-literal medical translation would (`pengobatan`, `terapi` — avoid both). Well established (30+ instances: "Penyembuhan AI dimulai", "Diagnosis Penyembuhan AI"). |
| **fleet** | armada | Well established and fully consistent — the collective-fleet-of-ships/agents sense, never a speed/swiftness reading (that would be a different, unrelated word entirely — Indonesian has no false-friend risk here the way German does). |
| **draft** | draf | Adapted spelling. Well established (`"Draf"`, `"Draf diterima dan diterapkan"`, `"Perubahan Draf"`). The one legitimate exception is the fixed GitHub term **"Draft PR"** (a specific GitHub feature name, e.g. `"Kirim sebagai Draft PR"`) — treat that compound as a technical identifier and leave "Draft" untranslated only in that exact phrase, never elsewhere. |
| **promote** | promosikan (verb) / dipromosikan (state) | Move a draft to live. Well established (`"Promosikan"`, `"Promosikan ke Produksi"`, `"Dipromosikan"`). Not `iklankan` ("advertise") per the glossary's explicit warning. |
| **review** | tinjauan (noun) / tinjau (verb) | **Fix needed**: the shipped file mixes `tinjauan`/`tinjau` (150 instances, dominant and used in the Director/monitor core flows) with `ulasan` (55 instances, e.g. `quick_reviews_header`, `review_titlebar`). Standardize on `tinjauan`/`tinjau` going forward — it's both more frequent and the term used in the higher-stakes review-and-approval flows (Director coaching, monitor review queue). Fix `ulasan` to `tinjauan` in any string you touch. |
| **approval** | persetujuan | Verb `setujui` (`"Setujui"` button), noun `persetujuan` (`"Persetujuan Anda diperlukan"`, `"Minta persetujuan saya"`). Keep paired with `tinjauan` — an approval is the outcome of a review. |
| **lab** | Lab | Borrowed, per glossary "translate or borrow; keep short — it labels a tab." Fully consistent in the shipped file (`"tab_lab": "Lab"`, `"Buka Lab"`, `"Kirim ke Lab"`). Do not translate to an invented Indonesian word. |
| **overview** | ringkasan | The dashboard route (`"overview": "Ringkasan"`). Also used generically for "summary" elsewhere in the product — that's the same correct word, not a collision. |
| **monitor** | Monitor | Borrowed — Indonesian tech usage already reads "monitor" as a live-oversight view (as well as a screen), and the shipped file borrows it consistently (`"Monitor Persona"`, `"Persona Monitor"`). Lowercase `monitor` when used as a common noun mid-sentence, capitalize as part of the feature name. |
| **cockpit** | Cockpit | Borrowed, per glossary "translate or borrow; keep short." Shipped as-is (`"cockpit": "Cockpit"`). Do not invent a native equivalent — Indonesian has no everyday non-aviation word for this control-surface metaphor. |
| **event** | peristiwa | **Fix needed**: the shipped file mostly gets this right (162 instances of `peristiwa`) but drifts to `acara` in a handful of places (27 instances, e.g. `"cloud_events": "Acara Cloud"`). `acara` means a social occasion/ceremony ("a wedding *acara*") — wrong register entirely for a message on an internal event bus. Standardize on `peristiwa`; fix `acara` to `peristiwa` in any string you touch (see Pitfalls). |
| **alert** | peringatan | Well established and fully consistent. Shares the word with "warning" in this product's vocabulary (both map to `peringatan`) — that's an accepted, harmless overlap, not a term collision to fix, since English itself uses "alert" and "warning" near-interchangeably in this product's copy. |
| **chain** | rantai | Native word, well established (`"Rantai Kaskade"`, `"Rantai: {id}"`, `"Rantai Percobaan Ulang"`). Distinct from **workflow**. |
| **workflow** | alur kerja | Native two-word phrase ("flow of work"), the dominant and correct choice (35 shipped instances vs. a single stray borrowed "Workflow"). Unlike German/French, Indonesian does not borrow this one — always `alur kerja`, two words, lowercase mid-sentence. |
| **skill** | skill (borrowed, lowercase inline) | **Fix needed — deliberately kept borrowed, distinct from capability**, mirroring the same collision risk documented for German. The Claude Skills feature (`.claude/skills`, the skill library/drawer in Dev Tools) consistently keeps "skill" borrowed and lowercase throughout its ~17 shipped instances (`"Sumber skill"`, `"Cari skill…"`, `"Pasang skill ke dalam proyek"`). Meanwhile the generic sidebar nav item translates `skills` as `"Keahlian"` and a Dev Tools page title translates it as `"Keterampilan"` — a *third*, different word for the same concept. Going forward: **always** render skill as borrowed `skill`/`Skill` to keep it lexically distinct from `kemampuan` (capability). Fix `"Keahlian"` and `"Keterampilan"` to `"Skill"` the next time either key is touched. |
| **tier** | tingkat | The generic word only — covers model tier (Haiku/Sonnet/Opus), config-resolution tier (agent/workspace/global), and pricing tier. Tier **names** (Starter, Team, Builder) stay English per the glossary. **Fix needed**: the shipped `tiers` section currently translates the plan names themselves (`starter_label: "Sederhana"`, `team_label: "Canggih"`) — this contradicts the glossary rule and should not be repeated; keep future plan-name strings in English. |
| **twin** | Twin | Borrowed — product/plugin surface name, fully consistent throughout the `twin` section (`"Buat twin baru"`, `"Twin Profiles"`, `"Twin Anda terlatih penuh"`). Lowercase `twin` when used as a common noun mid-sentence ("twin ini"), capitalized `Twin` as the feature/section name. |
| **director** | Director | Borrowed — treated as the meta-persona's proper feature name, not a common noun (`"tab_director": "Director"`, the entire top-level `director` section keeps the name in English). Do not translate to `Direktur` — that reads as a literal job title, not the feature name. |
| **brain** | Brain (feature/plugin name) · otak only in playful/explanatory prose if ever needed | The Obsidian-knowledge-base plugin keeps its name borrowed and capitalized throughout (`"brain": "Brain"`, section title `"Twin wiki"` sibling section). Never `otak` ("brain" the body part) in product chrome — it reads clinical/juvenile for a knowledge-base feature, exactly the same trap as German's `Gehirn`. |

---

## Pitfalls

Concrete errors seen in the shipped file or predictable from a machine
translating English into Indonesian. Fix these on sight in any string you
touch.

1. **Pronoun register slip: `kamu`/`kau` instead of `Anda`.** The shipped
   file is clean today, but this is the single most common failure mode for
   a model translating casual-sounding English companion copy — it reads
   the friendly tone and reaches for the informal pronoun. The tone can stay
   warm; the pronoun stays formal, always.
   Wrong: `"Ceritakan tentang dirimu"` · Right: `"Ceritakan tentang diri
   Anda"`

2. **The `"di mana"` relative-clause calque.** English "a page where you
   can manage personas" translates word-for-word into a clunky, foreign-
   sounding `"halaman di mana Anda dapat mengelola persona"`. Natural
   Indonesian either drops the relative clause and uses a purpose phrase, or
   uses `tempat` (not `di mana`) if a locative relative pronoun is truly
   needed.
   Wrong: `"Halaman di mana Anda dapat mengelola persona"`
   Right: `"Halaman untuk mengelola persona"`

3. **Term drift: `kapabilitas` for capability.** A machine translator often
   reaches for the more English-cognate-looking `kapabilitas` because it
   requires less lexical work than `kemampuan`. Both are technically
   understood, but the product's dominant, established term is `kemampuan`
   — see Termbase. Mixing the two within the same UI (a badge says one, a
   tooltip says the other) reads as two different concepts.
   Wrong: `"3 kapabilitas akan rusak"` · Right: `"3 kemampuan akan rusak"`

4. **Term drift: `acara` for a system event.** `acara` is the word for a
   social occasion (a wedding, a ceremony, a scheduled function) — a fluent
   but careless translator reaches for it because it's the first dictionary
   hit for "event." The internal-bus / trigger sense needs `peristiwa`.
   Wrong: `"Acara Cloud"` (as a section for system events)
   Right: `"Peristiwa Cloud"`

5. **Needless plural reduplication when a `{count}` placeholder already
   carries the number.** Indonesian marks plurality by reduplication
   (`kontak-kontak`) or by an explicit quantity word, not by a suffix like
   English `-s`. A machine translator that sees an English plural noun
   inside a counted string over-applies reduplication even though the
   `{count}` variable already tells the reader there's more than one —
   producing redundant, unnatural copy.
   Wrong: `"{count} persona-persona aktif"`
   Right: `"{count} persona aktif"` (the shipped file gets this right almost
   everywhere — e.g. `"{count} agen aktif"` — keep it that way; don't
   introduce reduplication just because the English source is plural)

6. **English Title Case bleeding into Indonesian buttons and headers.**
   Covered in Casing above, repeated here because it's the single most
   frequent mechanical error a literal machine translation makes: it copies
   the English source's capitalization pattern token-for-token instead of
   re-deriving Indonesian sentence case.
   Wrong: `"Simpan & Pindah"` · Right: `"Simpan & pindah"`
