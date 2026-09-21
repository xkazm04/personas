# Twin experience — research, decisions, copy

Contest worktree. Sources were opened, not recalled.

## Character-design sources

| Source | URL | What it actually specifies |
|---|---|---|
| Character Card V2 spec | https://raw.githubusercontent.com/malfoyslastname/character-card-spec-v2/main/spec_v2.md | `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, plus V2 `creator_notes`, `system_prompt`, `post_history_instructions`, `alternate_greetings`, `character_book` |
| Character Card V3 spec | https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md | V2 plus `assets`, `nickname`, `group_only_greetings`, lorebook decorators, CHARX container |
| Field roles (TavernSprite) | https://tavernsprite.com/blog/sillytavern-character-card-fields/ | Five fields shape the model: description (permanent), personality (4–6 traits), scenario, first_mes, mes_example. Example dialogue is the strongest style anchor |
| Kindroid personality | https://kindroid.ai/docs/?article=customizing-personality | Backstory (natural language, precise, no fluff) + example message for format + key memories as atomic facts |
| Kindroid memory | https://kindroid.ai/docs/?article=memory | Persistent (backstory, key memories, example messages, directives) vs cascaded vs retrievable |
| Kindroid vs Nomi | https://aicompanionguides.com/blog/kindroid-vs-nomi-2026/ | Kindroid: authored fields. Nomi: light setup, memory compounds. Specificity beats adjectives ("dry deadpan" vs "funny") |
| persona-clone | https://github.com/yylwdyx-commits/persona-clone | Failure mode: same memories, wrong voice. Fix: few-shot *real* messages + layered prompt (hard rules / identity / speech style) |
| ai-voice-capture-framework | https://github.com/omeyazic/ai-voice-capture-framework | Adaptive interview over voice, not a static form; output is a portable voice profile |
| written-voice-replication | https://github.com/aaddrick/written-voice-replication | Corpus → numeric style targets (sentence length, function-word rates) + few-shot |
| write-like-me | https://github.com/Hiro-Inagawa/write-like-me | Deterministic checker for AI tells (em dashes, hedges, filler) rather than asking the model to "sound human" |
| natural-talk | https://github.com/chengzhi-c/natural-talk | Peer register: first sentence is the point; ban customer-service padding |

## Adopted

1. **Example messages over adjectives (V2 `mes_example`, Kindroid example message, persona-clone few-shot).** Tone questions now ask for a sentence the user would actually send, and for one thing they would never write. The prompt forbids category-label suggestions.
2. **Atomic memories (Kindroid key memories, V2 `character_book`).** Memories slot asks for one fact, opinion, or named story per turn — not a life summary.
3. **Layered identity (V2 description + personality, Kindroid backstory).** Identity covers what they do, what they are known for, the hill they will die on, and how they want to be introduced. Situation prompts ("what do you tell someone who just asked what you do") beat "describe your personality".
4. **Channel as scenario.** Channels are *where* and *to whom*, not a list of logos. A typical message's job (decide, update, joke, decline) is the question.
5. **Hard rules / anti-tells (persona-clone layer 0, write-like-me, natural-talk).** Interviewer and bio prompts ban coach-speak and résumé polish.
6. **Voice as a starting card, not a questionnaire.** Kindroid templates exist; we already have ten style presets. They stay optional and only *record* a choice until the twin exists.

## Rejected

| Pattern | Why |
|---|---|
| V2/V3 `first_mes` / alternate greetings | A twin drafts *the user's* replies. It does not open chats as a character. Greeting style is absorbed into per-channel tone examples. |
| V3 assets, CHARX, emotion sprites | Wrong medium (desktop text twin, no sprite sheet). |
| Personality sliders as the source of truth | We already have 8 style dimensions in the studio. The guided table captures *samples*, which the research says outperform sliders. |
| Fine-tune / QLoRA on chat exports (Digital-Self-Replica, CloneWriter) | Out of scope; this surface is an interview. Corpus cloning remains a later training-studio job. |
| 100-question taste interview | Too long for one sitting. One card at a time, readiness is the stop condition. |
| Replika trait chips / appearance | Appearance is the gender glyph on the card. Trait chips are adjectives; we collect evidence instead. |
| SillyTavern `{{char}}` / `{{user}}` macros | Twin is the user. Those macros would invert the product. |
| New readiness slots | Readiness is the completion authority and already has five milestones. Richer *questions* land inside identity / tone / channels / memories. |

## Localization bundle (`ai-registry/knowledge/localization`)

Started at `index.md` and `_laws.md`, then `craft/`.

**Applied**

- **The source locale is the source of truth.** LLM-ish English in `en.json` and in the prompts is a source defect. It caps every locale. The fix belongs here, not in a translator workaround.
- **The format skeleton is inviolable.** New keys keep `{name}`, `{items}`, `{count}` as named placeholders.
- **One concept, one rendering.** Overlay copy uses one word per idea: twin, table, card, play, skip, slot.
- **Clean strings stay untouched.** Only the new `twin.experience_grok.*` keys (and, in the prompt commit, the interviewer/bio prompts plus a few existing twin strings that still render) were rewritten.
- **Coverage is counted, not claimed.** Every new English key is translated into all 13 other locales in the same change.

**Did not apply**

- Translation-pipeline topology (canonical/derived split, source-hash cache, sharded CI). This repo already has `translate-extract` / `translate-merge` / `check:i18n:strict`.
- Translation quality estimation, per-pair engines, human-review sampling. We are writing source English plus a completeness pass, not scoring MT.
- Language-subject techniques (Japanese register, Arabic bidi, Czech plurals, CJK measure words). Those govern *target* catalogs. They do not tell an English interviewer how to sound like a person.
- Hand-authored exception contract. That is for landing pages kept out of a machine pipeline.

The bundle has no craft for "stop the model writing like a model." That is a prompting problem. The laws still matter because they say: fix the English source, keep placeholders, don't "improve" unrelated strings.

## Prompt changes (implemented in the prompt commit)

### `build_setup_turn_prompt` — interviewer

**Before (opening).** "You are a warm, efficient interviewer helping someone set up a digital twin of themselves — a stand-in that will later write in their voice. Ask like a person, not a form…"

**After (opening).** "You are sitting across a table from this person, dealing one card at a time. You are a sharp colleague, not a coach, not a chatbot, not a form." Plus a ban-list of chatbot/coach/résumé tells. Questions are one spoken sentence naming a real situation. Suggestions are first-person fragments they could paste.

**Slot guidance before → after**

- identity: "who they are — what they do, what they are known for, what matters to them" → situation first ("what do you tell someone who just asked what you do"), plus the hill they will die on
- tone: "rhythm, length, formality, what they never do" → a sentence they would send + one thing they would never write; bound channel over generic
- channels: "which channels, to whom, in what capacity" → who is on the other side + what a typical message is doing
- memories: "concrete facts, opinions and stories" → one atomic fact or named story per turn
- training: "specific, conversational, and answerable from lived experience rather than generic" → "a situation, not a category", as someone who already knows them a little

### `twin_generate_bio`

**Before.** "Generate a concise professional bio (2-3 sentences, first person) for a digital twin named … Use these keywords/topics as input." Refine: "improve clarity, flow, and word choice."

**After.** "Sound like this person introducing themselves to a colleague they just sat down next to." Ban "passionate about" / "results-driven" / "I am a digital twin". Refine still keeps every fact; it is told not to add LinkedIn polish.

## UI mapping

Create and Setup both open `experience/` as a full-viewport `BaseModal` popover. Create flows into the table without `setTwinTab('setup')`. Training still goes through `useSetupSession`. Keyboard (1–3, arrows, Enter, E, S) and the voice composer are unchanged in contract, restyled as the table.
