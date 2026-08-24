# Source-catalog defects (en.json)

Defects in the SOURCE catalog found while reviewing translations. These cap quality for every
locale and are the owner's to fix; flagged here, never silently worked around (law:
the-source-locale-is-the-source-of-truth). Append per run.

## 2026-08-24 — onboarding review wave (13 locales)

| key | problem | reported by |
|---|---|---|
| `onboarding.questions_waiting_one / onboarding.questions_waiting_other` | Source message format is frozen to one/other; Arabic needs all six CLDR categories (dual for 2, plural noun for 3–10, singular again for 11+), so no single _other string can be grammatical across its whole range. Locale-side mitigation applied below (AR-PLURAL-FREEZE mitigation 1). | ar |
| `onboarding.tour_intro_steps` | "{count} steps" has no plural-variant keys at all (single frozen string with a bare {count}); خطوات is only the correct noun form for the CLDR "few" range (3–10) — wrong for a tour with 2 or 11+ steps. | ar, cs |
| `onboarding.matrix_heading` | "sigils" has no settled Bengali rendering anywhere in this catalog or the termbase; the product should decide whether it's a literal thematic term (transliterate) or should be replaced with a plainer word before translation is finalized. | bn, es, hi, ko |
| `onboarding.adopt_button / step_adopt / progress_adopt` | The English source itself names the same onboarding step two different ways ("Set Up Agent" for adopt_button/step_adopt, "Adopt agent" for progress_adopt), which is very likely what caused the three-way Bengali drift (গ্রহণ/সেটআপ/অ্যাডপ্ট). | bn |
| `onboarding.tour_complete_recap` | Frozen single-value key carrying a live {total} count ('Dokončili jste všech {total} kroků.') with no _one/_few/_other branch; the genitive-plural noun is wrong if total is ever 1. | cs |
| `onboarding.more_connectors` | Frozen single-value key ('+{count} dalších') with no plural branch; genitive plural 'dalších' is wrong if count is ever 1. | cs |
| `onboarding.tour_minimized_hint` | Frozen single-value key embeds '{completed}/{total} kroků' with no plural branch on the step-count noun; wrong at total 1 or 2–4. | cs |
| `onboarding.progress_adopt` | Source text itself is inconsistent across the same step: adopt_button/step_adopt say "Set Up Agent" while progress_adopt says "Adopt agent" for what is presented as the same wizard step — the English source should pick one label before translations are re-audited for consistency. | es |
| `onboarding.questions_waiting_one/questions_waiting_other` | Runtime only exposes a two-slot (_one/_other) plural pair here, with no _few category — the same documented gap as the catalog's other counted strings. Caps every Russian (and cs) string of this shape at once; recorded once rather than patched per string. | ru |
| `onboarding.tour_intro_steps / tour_minimized_hint` | These count strings have no plural-suffixed variant at all (a single non-suffixed key holding {count}/{total}), so Russian has no slot mechanism to select the correct declined form even in principle — the rephrase fix works around it, but the runtime gap is the root cause. | ru |
