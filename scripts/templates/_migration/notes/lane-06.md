# Notes - lane-06

Creative and design: audio, video, visual assets, social publishing, newsletters (11 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.

## 09:20 - GATE - the gate is global, so it will not be green until all ten lanes are
- `check-recipes.mjs` walks the whole `recipes/` tree, so every scaffolded-but-unwritten
  recipe in someone else's lane fails it. Filter to your own work with
  `node .../check-recipes.mjs 2>&1 | grep -i "<your_domain>"` and read the summary line:
  if your domain appears only in the `domains:` count line, you have zero problems and zero
  notes. Run the unfiltered gate at the end of your lane, not as a per-recipe pass/fail.

## 09:24 - PATTERN - scaffold first, then read the rendered RECIPE.md for the empty cases
- `rx.mjs scaffold` renders immediately, and the renderer already has good prose for the
  empty shapes: an empty `connector_types` renders as "None. This work needs no external
  connector: the tools the agent already has are enough." So a recipe with no connector is
  a first-class outcome the lane already anticipated. Leave the array empty and say nothing
  extra in the body rather than inventing a type to fill it.

## 10:05 - PATTERN - a model's score is not a measurement; make it answer closed questions
- Three drafts in this lane leaned on "a multimodal AI scores the output 1-10 and it
  proceeds above 7". That number is not reproducible between runs on identical input, so it
  cannot be thresholded honestly. The enrichment that worked: split the judgment in two.
  The **checkable** properties (dimensions, aspect ratio, file weight, palette against
  declared colors, contrast, a text transcription compared to what it should say) are
  computed and are pass/fail; the model is only ever asked one closed question at a time,
  so two runs can be compared. The score knob survives, re-described as a patience setting.
- Reusable anywhere a recipe uses an LLM to judge its own output. "Rate this" is a taste
  claim wearing a number.

## 10:07 - DECISION - an enum OPTION that names a connector is a leaked binding too
- Lane-10 flagged binding-shaped `input_schema` defaults. The same leak hides in enum
  option VALUES: `scheduling_preference: ["immediate", "buffer_queue"]` names a connector
  inside a field the two-layer table says never carries one. I renamed it to `queue`.
  Check your options arrays, not just your defaults and descriptions.

## 10:09 - PATTERN - "a success that looked like a failure" is the sharpest need sentence for any write recipe
- For anything that writes to an external system (publish, send, file, commit, schedule),
  the failure practitioners actually hit is not the failure: it is the request that timed
  out after it succeeded, retried, and did the thing twice. It makes an excellent `need`
  clause and an excellent third outcome ("a retry cannot double post"), and it forces two
  useful activities into the shape: carry something that makes a repeat recognisable, and
  READ THE DESTINATION BACK rather than trusting the response you got.
- Its twin, straight from FIELD_GUIDE 3b: queued is not done. A confirmation carrying only
  a scheduled time has told the approver nothing about whether the thing went out.

## 10:11 - RESEARCH - the numbers behind the audio and video recipes, if anyone else needs them
- Spoken pace: comfortable narration is roughly 130-160 words per minute; below about 120 a
  listener disengages, above about 180 they tire. That is what turns a target runtime into a
  word budget, so a script's length is knowable BEFORE synthesis instead of discovered after.
- Loudness: spoken word convention is about -16 LUFS integrated with true peak under -1
  dBTP, and every major platform re-normalizes at playback anyway (Spotify ~-14, Apple ~-16).
  The transferable shape: **a downstream system that normalizes will not fix what is uneven
  INSIDE your artifact.** Whole-file gain cannot rescue one host being quieter than another.
  Worth asking of any recipe whose output a platform post-processes.
- TTS stitching: generated clips carry their own leading and trailing silence, which
  compounds into dead air when concatenated; final syllables get truncated; volume varies
  between voices. So a total-runtime check is weak (a swallowed syllable costs under a
  second and passes any tolerance) and the real check is per segment against its own text.

## 10:40 - RESEARCH - two verified standards for anything that ships a video, a page or a list send
- **Captions.** WCAG 2.2 SC 1.2.2, level A: captions are required for ALL prerecorded audio in
  synchronized media, and they must carry speaker identification and meaningful non-speech
  sound, not just dialogue. The single exception is media that is a clearly labelled
  alternative for text already on the page. A silent screen capture falls under 1.2.1 instead,
  where the equivalent is the steps in writing. Verified by fetch:
  w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html
- **Bulk email.** Google's bulk sender requirements (support.google.com/a/answer/81126,
  verified by fetch): spam rate reported in Postmaster Tools must stay below 0.30% with 0.10%
  recommended; senders above 5,000 messages a day must support one click unsubscribe
  (List-Unsubscribe-Post plus List-Unsubscribe); SPF, DKIM and DMARC all required. Useful to
  any lane whose recipe ends in a list send, as a dependency adoption must VERIFY rather than
  as an instruction.
- Both were fetched after WebSearch was exhausted. The pattern that worked: name the
  authoritative document from your own knowledge and fetch it directly. Marketing blogs about
  a standard are not fetchable substitutes for the standard.

## 10:44 - PATTERN - the fourth description field is where a draft's vagueness usually hides
- Across eleven drafts the weakest field was consistently `need`, and the fix was always the
  same: append the sentence describing what the work looks like when it is done BADLY BUT
  PLAUSIBLY. "An approved script is not a listenable briefing" is a truism; "it renders
  without an error and ships with a clipped last word and one host quieter than the other" is
  a claim a practitioner nods at. FIELD_GUIDE 3a says this and it is worth taking literally:
  it was the highest-yield single edit in the lane, and it costs one clause.

## 10:46 - DECISION - a knob whose default IS the failure the recipe argues against
- Three of my drafts exposed a quality score from a model as a threshold, and one exposed a
  segment gap measured as raw inserted silence when the real quantity is the gap AFTER the
  generator's own padding is trimmed. Following lane-04's note, I kept the knob and rewrote
  its `description` to name the correct quantity and say why, rather than deleting it. An
  adopter who reads only the knob still gets the judgment, and the consuming app's contract
  is unchanged. Delete only when the knob's VALUE is a binding; rewrite when the knob's
  MEANING is wrong.
