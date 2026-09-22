# Twin experience (`experience_opus`): research, decisions, prompt changes

Contest entry, 2026-09-21. This folder replaces the create dialog and the in-tab
Setup desk with one full-screen layer: make a twin, then train it at a card table.
This file records what the design rests on, what was adopted and rejected, what the
localization bundle contributed, and every prompt change with its before and after.

Nothing below claims a measured effect on real model output. The prompts were
rewritten and the deterministic post-checks are unit-tested, but no live run was
compared before and after. That comparison is owed (section 8).

---

## 1. The four complaints, and where each is answered

| Complaint | Answer | Where |
|---|---|---|
| Both surfaces cramped; creation and training are separate places | One layer over the whole app below the title bar. Create flows into the table without closing anything. | `ExperienceShell`, `ExperienceBody`, `launcher.ts` |
| Components and visuals poor | A card table: question card dealt face up, answer cards fanned and played, offers that turn over with a foil border and, when kept, send a token flying toward the twin's card while the count they changed pops; suits flare when readiness completes them. | `table/*`, `cardMotion.ts`, `experience.css` |
| Training sections not grounded in research | Section 2 and 3 below. Concrete changes: reply drills (write turns), verbatim samples, Always/Never rules, languages at creation, a revised training deck. | `setupContract.ts`, `useSetupSession.ts`, Rust prompt, `table/topicDeck.ts` |
| Generated text does not read as a person wrote it | Prompts rewritten in the register they ask for, a language named for each part of the turn, and mechanical tells fixed in code after generation. | `twin.rs`, `twin_voice.rs`, `twin_style/prompt.rs` |

---

## 2. What the research found

Two research passes ran: product docs and specs on the web, and GitHub repos and
papers. Claims below keep the source next to them. Where a source could only be read
through a search snippet, that is said.

### 2.1 Character card specs (SillyTavern V2 / V3)

- **V2** ([spec_v2.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)) keeps V1's `name, description, personality, scenario, first_mes, mes_example` and adds `creator_notes` ("MUST NOT be used inside prompts"), `system_prompt`, `post_history_instructions`, `alternate_greetings`, `character_book` (keyword-triggered lore: `keys, content, insertion_order, priority, constant, position` …), `tags`, `creator`, `character_version`, `extensions`.
- `description` / `personality` / `scenario` "SHOULD be included by default in every prompt"; `mes_example` exchanges are separated by `<START>` and "SHOULD … only be included … until actual conversation fills up the context size, and then be pruned".
- The [V2 README](https://raw.githubusercontent.com/malfoyslastname/character-card-spec-v2/main/README.md) gives the reason `post_history_instructions` exists: "system instructions written *after* the conversation history have a much stronger weight on current models' generations than instructions written *before*."
- **V3** ([SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)) adds `nickname`, `creator_notes_multilingual`, `source`, `assets`, `group_only_greetings`, dates, lorebook `use_regex`, and decorators (`@@depth`, `@@role`, `@@activate_only_after`, …).

### 2.2 How the style signal is actually used

- SillyTavern's docs name the **first message**, not the example dialogues, as the strongest anchor: "The model is more likely to pick up the style and length constraints from the first message than anything else" ([ST character design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)). Its chat-completion path sends each example block as a named system message and, unless pinned, lets them drop out as history grows ([openai.js](https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/openai.js), [power-user.js](https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/power-user.js)).
- SillyTavern already ships the twin's exact task as its "impersonation prompt": write the user's next message "using the chat history so far as a guideline for the writing style of {{user}}".
- Ali:Chat's thesis: traits "can be implicit – the way they talk & act" ([AliCat](https://rentry.co/alichat)). W++/PList are token-saving formats for small models ([kingbri](https://rentry.co/kingbri-chara-guide): one card went from ~1300 to 599 tokens). The format debate is about context budgets, not quality on current models.

### 2.3 Companion products: fields and limits

- **Character.AI**: Greeting 0–500 chars; Short Description 0–50; Long Description 0–500, "written from the perspective of the Character, in their own words"; Definition 0–32,000, mostly example dialog ([greeting](https://book.character.ai/character-guide/character-attributes/greeting.md), [long description](https://book.character.ai/character-guide/character-attributes/long-description), [definition](https://book.character.ai/character-guide/character-attributes/definition)). Stance: "less can be more" ([advanced creation](https://book.character.ai/character-guide/advanced-creation)).
- **Kindroid** (community guide mirroring help-center snippets; the official docs did not render): Backstory 2,500 chars; Key Memories 1,000, "atomic facts, not narratives"; Response Directive 150, "positive guidance, not prohibitions"; Example Message 750, sets "tone, mannerisms, and message lengths"; Journal entries triggered by keyphrases ([guide](https://www.scribd.com/document/950525928/Kindroid-Profile-Design-Guide-2025-04-25), [help center](https://kindroid.ai/docs/article/customizing-personality/)).
- **Nomi**: backstory 2,000 chars for paid users ([Nomi update](https://nomi.ai/updates/september-17th-update-memory-improvements-increased-backstory-length-increased-nomi-response-length-and-more/)); other fields (appearance, preferences, desires, **boundaries**) per a third-party snippet only ([techraisal](https://www.techraisal.com/blog/nomi-ai-explained-how-it-works-and-what-to-expect-as-a-user/)).
- **Janitor AI**: the Bio "is not used within the bot itself"; personality under ~2,500 permanent tokens ([Janitor](https://help.janitorai.com/en/article/the-basics-the-character-creation-page-overview-15xevon/)). Replika's help page returned 403 (snippet only).
- **Delphi** (a real person-cloning product): content uploads flagged "by or about you", Q&A pairs, plain-language training feedback ("be more concise"), response settings including at most three custom instructions ([content](https://docs.delphi.ai/the-basics/add-content-and-train-mind.md), [settings](https://docs.delphi.ai/advanced/response-settings.md)).
- Open editors: Agnai (`sampleChat`, `postHistoryInstructions`, persona formats) ([library.ts](https://raw.githubusercontent.com/agnaistic/agnai/dev/common/types/library.ts)); RisuAI (`exampleMessage`, `depth_prompt`, author's note stored with the chat) ([database.svelte.ts](https://raw.githubusercontent.com/kwaroran/RisuAI/main/src/ts/storage/database.svelte.ts)); a16z companion-app (short always-on preamble, then a seed chat of "examples of the character's voice", then backstory in a vector DB) ([repo](https://github.com/a16z-infra/companion-app)). None of the open repos had gamified onboarding.

### 2.4 Repos that clone a real person

- [GPT-is-you](https://github.com/rchikhi/GPT-is-you): "The style is copied from the training responses, not the training prompts", and "it is clear that the LLM *did not* capture personality."
- [Digital-Twin](https://github.com/FALIKHFIKRI/Digital-Twin): stores style stats plus ~3,800 real (their message → your reply) pairs, retrieves similar ones per incoming message, then applies an `enforce_style()` pass (lowercase, trailing punctuation) in code; retrieval "narrows that gap a lot but won't eliminate it."
- [voice-dna-creator](https://raw.githubusercontent.com/az9713/ai-co-writing-claude-skills/main/.claude/skills/voice-dna-creator/SKILL.md): schema includes `never_say`, `formatting_preferences`, `voice_examples`; validates by writing a paragraph from the profile and asking "does this sound like you?"
- [writing-dna-discovery](https://raw.githubusercontent.com/robertguss/claude-code-toolkit/main/skills/writing/writing-dna-discovery/SKILL.md): "One question at a time—Always"; comparative choices ("'walked' or 'stepped'?"), crossing out words you avoid, rewriting generic text in your own voice; one register per session.
- [WeClone](https://github.com/xming521/WeClone), [PersonaClone](https://github.com/Huzaifanasir95/PersonaClone), [style-modeler](https://github.com/leifericf/style-modeler) ("Most AI 'style prompts' are vague and unstable"). PersonaClone's "95%+" figure is the author's own and unverified.

### 2.5 Research on style imitation

- **Catch Me If You Can? Not Yet** (EMNLP Findings 2025, 400+ authors) ([paper](https://arxiv.org/html/2509.14543), [code](https://github.com/jaaack-wang/llms-implicit-writing-styles-imitation)): few-shot beats zero-shot (blogs: 39.39 vs 17.22 top-5 attribution); going from 2 to 10 examples "affects the four metrics very little"; formal writing imitates well (email authorship verification 96.15) and casual badly (Reddit 63.65); detectors judged imitations human "always below 55% and often less than 20%" of the time. Picking examples by topic similarity *hurt* by reducing stylistic diversity.
- **How Well Do LLMs Imitate Human Writing Style?** ([arXiv 2509.24930](https://arxiv.org/abs/2509.24930)): few-shot up to 23.5× better style matching than zero-shot; matched outputs were still more predictable than human text (perplexity 15.2 vs 29.5).
- **StyleTunedLM** ([arXiv 2409.04574](https://arxiv.org/html/2409.04574v1)): instruction-only 0.263 style-classifier accuracy, 5-shot 0.693, LoRA 0.879.
- **RoleLLM** ([paper](https://ar5iv.labs.arxiv.org/html/2310.00746)): examples presented as real dialogue turns beat examples listed in the prompt (61.79% vs 30.19% win rate).
- **TwinVoice** ([arXiv 2510.25536](https://arxiv.org/abs/2510.25536)) and **PersonaGym** ([arXiv 2407.18416](https://arxiv.org/html/2407.18416v2)): syntactic style and linguistic habits are the weakest capability across models.

### 2.6 Interview technique

- Ghostwriters ask for scenes ("Take me to the day…"), avoid yes/no and "What did you learn?" questions, log verbal tics and words the person never uses, and validate with "Does this sound like you? What feels off?" ([River](https://rivereditor.com/blogs/how-ghostwriters-capture-client-voice-first-interview), [Association of Ghostwriters](https://associationofghostwriters.org/cracking-voice-with-ghostwriting-clients/)).
- Voice is constant, tone varies by context; describe it as "X but not Y" pairs ([NN/G](https://www.nngroup.com/articles/tone-of-voice-dimensions/), [Mailchimp](https://styleguide.mailchimp.com/voice-and-tone/)).

### 2.7 Tells of generated text

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing): era-specific vocabulary (delve, tapestry, underscore, fostering), "serves as" for "is", negative parallelisms ("not just X, but Y"), the rule of three, promotional words (vibrant), heavy em dashes, "I hope this helps". Its own caveat: humans use these too, and the list is not prescriptive.
- Anthropic's prompting guidance: say what to do rather than what not to do, and match the prompt's style to the output you want ([best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices); quoted wording via a [summary](https://prosperinai.substack.com/p/official-claude-prompting-everything) because the page was too large to fetch). Kindroid's "positive guidance, not prohibitions" agrees.

---

## 3. Decisions: adopted and rejected

| Pattern (source) | Decision | Why | Implemented in |
|---|---|---|---|
| Real example messages as the strongest style signal (`mes_example`, StyleTunedLM, Catch Me, GPT-is-you) | **Adopted, as the core.** | Instruction-only 0.263 vs 5-shot 0.693. A voice is shown, not described. | Write turns + verbatim sample offers (`sampleOffer`, `SetupProposal.part: 'examples'`) |
| Suggestion cards written by the model for voice questions | **Rejected for samples, kept for choices.** | If the person picks a model-written reply as their sample, the twin learns the model's voice. Cards stay for categorical choices ("'Sounds good!' / 'sg' / 'Sounds good.'"), where writing-dna-discovery shows comparative choice works. | `answerMode: 'write'` → empty hand by contract, enforced in Rust `parse_setup_turn` and TS `requestTurn` |
| Reply-to prompts ("reply exactly as you would") | **Adopted.** | Produces samples inside the interview; the SillyTavern first-message finding says a real reply anchors style and length. | Tone-slot brief; `incoming` shown as a message bubble; training topic "Reply drills" |
| Never-say list / constraints (`never_say`, `post_history_instructions`, Nomi "boundaries") | **Adopted as Always/Never rules**, per channel. | Checkable, short, and what the reply prompts already render (`constraints_json`). | `part: 'constraints'` proposals; "Lines you hold" topic; channels-slot brief asks what the twin must never say or promise |
| Mechanics per channel (capitals, sign-offs, emoji, length) | **Adopted in the questions.** | Casual/syntactic style is where models are weakest (Catch Me, TwinVoice, PersonaGym), so it has to be captured explicitly. | Tone-slot brief |
| Always-in-context short identity (`description`, Character.AI long description "in their own words", 500 chars) | **Adopted** for the bio proposal and the bio generator. | First person, their phrasing, under 500 characters. | Bio proposal rule; `build_bio_prompt` |
| Keyword-triggered memory (`character_book`, Kindroid atomic memories) | **Kept as it is** (memories + Brain review). | The twin already has approved memories and a bound KB; nothing in this brief needed a new store. | unchanged |
| Scenes over summaries (ghostwriters) | **Adopted.** | "10x more usable voice data"; avoids performative answers. | Memories brief; "Work stories" topic |
| Validation loop ("does this sound like you?") | **Deferred.** | Worth doing (voice-dna-creator, River), but it needs a draft-as-twin call wired into the table. Named in section 8. | not built |
| Languages | **Adopted.** Asked at creation; every generated part of a turn now names its language. | Every generator reads `profile.languages`; nothing asked for it, and the setup prompt named no language at all. | `LanguageChips`, `setup_languages` |
| `scenario`, `first_mes`/`alternate_greetings`, `group_only_greetings` | **Rejected.** | Fiction openers and swipes. The real incoming thread is the scenario; the lesson of `first_mes` survives as reply drills. | n/a |
| `personality` trait lists, W++/PList, Big Five | **Rejected.** | Adjectives are the weakest signal (0.263); the formats are token savers for small models. The existing 8-dimension style presets stay as a *starting point* only, and the create screen says your answers beat any preset. | n/a |
| User-editable `system_prompt` / jailbreak toggles, assets/emotion images, `talkativeness` | **Rejected.** | The app owns the prompt; the rest is roleplay chrome. | n/a |
| Separate register per channel | **Kept and extended.** | A register the person names in conversation ("I mostly write email") now becomes a tone row and stays covered, before any channel is bound. | `toneChannels` in TS and `setup_tone_channels` in Rust include tone rows |
| Code-level fixes for mechanical habits (Digital-Twin `enforce_style`) | **Adopted for the generator's own tells.** | Deterministic checks decide what a rule can decide (section 5). | `twin_voice.rs` |

---

## 4. The sections, questions and fields now

**Setup suits** (readiness is still the only completion authority; `deriveReadiness` is untouched):

- **Identity**: what they do, what they're known for, how they'd introduce themselves. Offers a first-person bio (under 500 chars, their facts and phrasing) and a short role.
- **Voice**: one channel at a time, thinnest first. Two question kinds: a choice between concrete variants, and a reply drill every second or third question. Offers voice directives (1–3 short positive instructions, under 300 chars) and Always/Never rules (under 120 chars). The person's own replies are offered back verbatim as samples.
- **Channels**: where they write, who reads it, how they shift between a manager, a client and a friend, and what the twin must never say or promise for them. Offers rules. (Completing this suit still needs a bound channel; see section 8.)
- **Memories**: scenes, opinions, facts. In the setup stage the table offers the switch to training instead, because a setup-stage answer is not saved (the session's own rule, kept).

**Training deck** (same six preset ids, so coverage keeps crediting answers):

| id | Before | Now |
|---|---|---|
| communication | Communication Style: "Ask me how I prefer to communicate — formality, humor, directness…" | **Reply drills**: realistic messages to reply to exactly as I would (a request I'd turn down, a vague ask, someone chasing me, a thank-you) |
| background | Work & Background: "…professional background, career history, and current role." | **Work stories**: one scene at a time; ask what happened, not what I learned |
| opinions | Tech Opinions: "…technology, tools, and frameworks" | **Takes you'd defend**: in my field and outside it; push once if I sit on the fence |
| expertise | Domain Expertise: "Ask me deep questions…" | **What people ask you**: the questions people bring me, answered as to a colleague |
| values | Values & Principles | **Lines you hold**: what I won't do, and what my twin must never say, promise or agree to for me |
| personal | Personal Interests | **Off the clock**: what I do with my time, what I could talk about for hours |

**New or newly used fields**: `profile.languages` (asked at creation), tone `examples_json` (filled from verbatim samples; before, the guide never wrote it), tone `constraints_json` (filled from accepted rules), tone rows for registers without a bound channel.

**Contract extensions** (additive; the old Desk still compiles and works): `SetupTurnResult.answerMode` + `incoming`; `SetupProposal.part`; `SetupSessionApi.answerMode / incoming / toneChannel / redeal()`; `setupTurn(…, locale)`.

---

## 5. The localization bundle: what applied and what didn't

Read: `index.md`, `_laws.md`, `craft/translation-quality-measurement/*`, and per-language
technique files (Czech de-anglicization and register in full; the others via the
translators, section 5.3).

### 5.1 Applied

- **"Language mastery is transplantable"; read as if written first in each language** (`index.md`). The setup prompt named no language, so a Czech twin was interviewed and offered answers in English. Now the guide asks in the app's language and every suggestion and proposal is written in the twin's primary language, with the instruction to write natively "instead of translating from English: its own word order, idioms and punctuation". That sentence is the bundle's de-anglicization idea (CS-NOM, CS-PASS and siblings) applied to generation instead of translation.
- **"Quoted human speech is evidence, not product voice"** (the closing note of the Czech de-anglicization set). A suggested answer is the person's speech, so it follows the person (their language, their dashes if they use them), while the guide's question follows the product.
- **Deterministic checks before estimates** (`craft/translation-quality-measurement/techniques/deterministic-checks-before-estimates.md`): "every defect class a rule can decide is decided by the rule". Filler openers, clause dashes, assistant-speak and duplicate or model-written samples are decided in `parse_setup_turn` / `twin_voice.rs`, not by asking the model nicely. Only what a rule cannot decide (does this read like a person) is left to the prompt.
- **Every finding cites an anchor** (`_laws.md`). Each rule is a named function with a test (`strip_filler_opener`, `soften_dashes`, `reads_as_assistant`, `uses_dashes`), so a later review can cite what a fix rests on.
- **The format skeleton is inviolable** / **source locale is the source of truth**. Every new string is one key with named placeholders; no sentence is concatenated from fragments. The one list in the UI (open suits in the greeting) is joined by `Intl.ListFormat` in the reader's language, not with a hard-coded English comma. Translators were told placeholders may move but never change.
- **The authority is a hypothesis until counted.** Before choosing an address form for the translations, the catalog was counted: formal address outnumbers informal in de (1,255 vs 186 matches), fr (1,134 vs 145) and cs (557 vs 191). The translators were told to use the formal form there and why, and to count their own catalog elsewhere. The Spanish translator counted the two nearest sections (`twin.setup` 12 tú / 0 usted, `twin.training` 16 / 15) and chose tú, citing the Spanish register rule for consumer features; the whole-catalog count for es was too noisy to overrule that. The German translator kept Sie everywhere except the six topic prompts, which are the person talking to the interviewer ("Frag mich…").
- **One concept, one rendering.** Translators were pointed at their locale's existing `twin.*` renderings for "twin", "Brain", "Setup", "Training", "memories", so the new keys reuse the settled words.

### 5.2 Did not apply

- The pipeline-topology craft (source-hash caches, sharded CI, canonical/derived split) is about running a translation store; nothing here changes that pipeline.
- Quality estimation, human review sampling, per-pair engine selection: no measurement budget in this change, and no estimator was run.
- The bundle has no subject for **English** as a target, and nothing on generated (as opposed to translated) text. Its closest help for "doesn't sound like a person" is the de-anglicization idea used above; the concrete English tell list came from Wikipedia and Anthropic's guidance instead.

### 5.3 Found while counting

- `twin.setup.subtitle` in de.json uses informal "du" ("Antworte, wähle oder tippe…") inside a catalog that is formal 6:1: the drift pattern DE-ADDRESS describes (conversational surfaces pulled toward du). Not fixed here: it is an existing key owned by the old surface.

---

## 6. Prompt changes: before and after

### 6.1 `twin_setup_turn` (`src-tauri/src/commands/infrastructure/twin.rs`)

**Before** (opening and suggestion rule, verbatim):

> You are a warm, efficient interviewer helping someone set up a digital twin of themselves — a stand-in that will later write in their voice. Ask like a person, not a form: one question at a time, concrete over abstract, and never re-ask something the material below already answers.
>
> Also offer 2-3 SUGGESTED ANSWERS they could adopt or edit. A suggestion is a plausible answer in THEIR voice, drawn from what is known above — not a category label — and each carries a one-line reason it is being offered.

Slot guidance was one clause each ("how they write and sound on a given channel — rhythm, length, formality, what they never do"). No language was named. Nothing distinguished a choice from a writing sample, so every answer card was model-written.

**After** (key parts, verbatim):

> You're interviewing {name} to set up their digital twin, a stand-in that will later write messages in their voice. Work like a good ghostwriter in a first session: people describe their own style badly and show it well, so ask what they actually do and write, not which adjectives fit them.

Tone slot:

> Right now you're working on how they write. Take one channel at a time from: {channels}. Start with the one that has the fewest sample messages, and name it in the question. If they write somewhere that isn't listed, like email or LinkedIn, ask about that too and use a plain lowercase name for it as the channel id.
> The facts that make a twin sound like someone are small and checkable: how they open and sign off, how long a message runs, capital letters and full stops, emoji, exclamation marks, pet phrases, words they'd never use, how they say no. Two kinds of question work well. A choice between concrete variants, like: Which is more you on Slack: "Sounds good!", "sg", or "Sounds good."? And a reply drill: give them a realistic message someone might send them on that channel and ask them to reply exactly as they would. Make every second or third question a reply drill.

How to ask, write mode, suggestions:

> One question about one thing, in a sentence if you can (a reply drill may need two), under 30 words. Open with the question itself: no greeting, no thanks, no comment on their last answer. …
>
> Set "answerMode" to "write" when their answer will itself be a writing sample … Put the message they're replying to in "incoming" … and return "suggestions": [], because a sample you wrote would teach the twin your voice instead of theirs. …
>
> A suggestion is an answer they could send back as it is. Make the options genuinely different from each other (different choices, not one answer reworded), keep each as short as their real answer would be … Give each a "reason" of a few words saying what picking it tells the twin, like "sets the email sign-off" or "keeps Slack lowercase".

Language and voice:

> Write "question" and "incoming" in {guide language}. Write every suggestion and every proposal value in {twin language}, the way {name} writes. Write natively in each language instead of translating from English: its own word order, idioms and punctuation.
>
> Write the way a thoughtful person types to someone they know: plain words, short sentences, contractions where they'd use them. Say the thing directly and stop. Keep praise, thanks and recaps of what was just said out of it, and don't group things in threes for rhythm. Join clauses with commas and full stops rather than dashes. Leave out the words people now read as machine-written: delve, tapestry, testament, vibrant, seamless, leverage, elevate, unlock, journey, realm, crucial, navigate, and the "not just X, but Y" construction.

The identity, channels, memories and training briefs are rewritten in the same register (section 4). The prompt also now shows the guide, per tone row, how many sample messages exist and which rules are already accepted, so it can go after the thinnest channel and not re-propose a rule.

### 6.2 `parse_setup_turn`: fixed in code, not asked for

| Check | Before | After |
|---|---|---|
| Praise/filler opener on the question | passed through | `strip_filler_opener` drops a leading "Great, that helps!" sentence when a question follows |
| Clause em/en dashes | passed through | `soften_dashes` turns them into commas in the question, suggestions, reasons and proposal values; **unless the person's own answers use dashes** (`uses_dashes` allowance) for suggestions and proposals. Sign-off dashes at line start and numeric ranges survive. |
| Assistant-speak in a suggestion ("I'd be happy to", "as an AI", "delve") | dealt | dropped (`reads_as_assistant`) |
| Duplicate suggestions, more than three | dealt | deduplicated case-insensitively, capped at 3 |
| Suggestions on a write turn | n/a | cleared: the answer is a writing sample |
| Model-written sample (`part: "examples"`) | n/a | dropped: a sample is the person's words or nothing |
| Unknown proposal kind | passed through to the client | dropped |

Tests: `setup_turn_tests` (6 new) and `twin_voice::tests` (6).

### 6.3 `twin_generate_bio`

**Before**:

> Generate a concise professional bio (2-3 sentences, first person) for a digital twin named "{name}", role: {role}. Use these keywords/topics as input: {keywords}. Output ONLY the bio text, nothing else. No quotes, no preamble.

**After**:

> Write a short bio for {name}, who works as {role}, in the first person, the way they'd introduce themselves to someone they just met: two or three plain sentences, under 500 characters. Build it only from their notes below, using their facts and as much of their wording as reads naturally. If the notes are thin, write less rather than filling the gap with adjectives, achievements or claims they didn't make.
>
> {shared voice brief}
>
> Reply with the bio text only.
>
> Their notes: {keywords}

The refine branch keeps "whose voice it is": every fact, their wording where it works, fix only what reads awkwardly.

**Compatibility shim, stated plainly.** Two callers send a whole task through `keywords` rather than notes: the Hub's dig-deeper (`hub/useHubFeed.ts`, live) and the unmounted `useTrainingSession`. Wrapped in the old bio frame, dig-deeper questions came back bio-shaped, and those questions are then asked verbatim at the training table. A task-shaped `keywords` (it contains "Output ONLY" or starts with "Generate exactly") now runs as the task, with the voice brief appended. Those callers should get their own command; until then this keeps their output a question and in the same voice. Tested in `bio_prompt_tests`.

### 6.4 Style studio (`twin_style/prompt.rs`)

Register varies by style (a cheerleader is allowed exclamation marks), so only the tells that hold in every register were added (`MACHINE_TELLS`):

- Roll, after the `sample` rule: "A person reads all four while choosing how they sound, so write them the way people talk, not the way products describe themselves." + tells.
- Materialize, after "Write as the person, in first person…": "The examples should read like messages a real person sent, in whatever register the style sets." + tells.

### 6.5 Static copy (`en.json`)

Existing keys were left as they are, because the brief puts new copy in a per-contestant namespace so the branches merge cleanly, and the old surfaces still render them. The new surface uses `twin.experience_opus.*` only. Representative before/after:

| Old key (old surface) | Old | New key | New |
|---|---|---|---|
| `twin.wizard.title` | Create twin | `create.title` | Make your twin |
| `twin.setup.subtitle` | Answer, pick or type. Nothing is stored until you say so. | `table.subtitle` | One question at a time. Nothing is saved until you keep it. |
| `twin.setup.desk.greeting` | Let's set things up. We'll go through {items} together. | `table.greeting` / `greetingFresh` | Picking up where you left off. Still open: {items}. / {name} is on the table. We'll cover {items}, one question at a time. |
| `twin.setup.desk.thinking` | Drafting the next question | `table.dealing` | Dealing the next question |
| `twin.setup.generatorError.title` | The guide could not draft this turn. The slot stays open. | `notices.guideDown` | The guide couldn't deal this one. Nothing was saved, and the suit stays open. |
| `twin.style.create.hint` | Optional. Choose how this twin talks to begin with. You can change it any time in Setup. | `create.styleHint` | Pick one and your twin drafts replies for each of your channels for you to look over. Or skip it: your own answers teach your voice better than any preset can. |
| `twin.training.topicHint` | Pick a topic area or describe your own. AI will generate tailored questions for you to answer. | `topics.label` + per-topic blurbs | Training deck. "Realistic messages to answer the way you would." … |
| `twin.setup.desk.legendAccept` | Enter accept | `keys.play` | ↵ play |

All 137 new keys are translated into the 13 other locales (section 5.1 for how).

---

## 7. The experience in one page

- **Entry**: "New twin" (roster and first-run hero) opens the layer in create mode. The Setup tab, and every twin-card slot jump that lands on it, opens it in train mode; closing it leaves a launch card with "Carry on setting up" and "Start a training round".
- **Create**: one screen. The twin's card fills in live (sigil, name, languages), and a starting-style deck sits beside it; each preset card flips on hover or focus to show a sample reply and what the style never does. "Create and start" runs `createTwinProfile` → `setActiveTwin` → `setPendingStyleStart`, then deals the table in the same layer.
- **Table**: suits (setup) or the training deck (training) on the left; the question card, its offers and the hand in the middle; the twin's card, the style dock and the played pile on the right. Keys: 1–3 pick, ← → move, Enter play, E edit, S skip, Esc close. Voice: dictation in the composer, speaker and hands-free in the top bar (`useSetupVoice`, unchanged).
- **Motion**: answers are dealt from the question, played up into it, swept left on a skip; offers turn over as they land, and a kept one sends a token flying toward the twin's card, where the count it changed pops; a suit flares when readiness completes it. Everything degrades to opacity-only under the OS setting or the in-app Reduce Motion toggle, and the CSS foil and sheen stop.
- **Loading**: a surface waiting on the guide shows card backs and a ghost question card, never a spinner; buttons the person pressed use `AsyncButton`.
- **Fields and Batch**: the typed fields (`SetupFieldsPage`) and the batch studio (`TrainingStudio`) render inside the layer unchanged. The style deck slides over any view and keeps drafting while the person plays.

---

## 8. Known gaps and what is owed

1. **Not run live.** No Tauri dev session was started (the operator's app is running). The flow, the animations and the prompts' real output need a smoke test (the final report lists the steps).
2. **No before/after measurement of generated text.** The prompt changes rest on the sources above and on unit-tested deterministic checks, not on a measured run.
3. **Channels cannot be completed anywhere.** The channel-binding UI was deleted in `3bfe8d18bc` ("delete the six retired sub-pages") and nothing replaced it, so the Channels suit reads its real status and cannot reach "set". The table still asks about channels, audiences and boundaries, which produces rules.
4. **Dig-deeper runs through the bio command** (6.3 shim). It should get its own command.
5. **Validation round not built** (voice-dna-creator / ghostwriter "does this sound like you?"): let the twin draft a reply at the table and have the person mark what is off.
6. **Tour anchors** (`gen-tour-anchors.mjs`) were not regenerated for the new `xo-*` test ids; the next `predev` codegen does it.
