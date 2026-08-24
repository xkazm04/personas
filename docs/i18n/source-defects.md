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

## 2026-08-24 — wave 2: common/home/shared/status_tokens + catalog-wide sweeps

Most-corroborated: `home.summary_stats` carries English-only pluralization placeholders ({personasPlural}, {credentialsPlural}) that no non-English grammar can use — flagged independently by 7 locales. `home.nav.team` vs `home.nav.teams` and `home.nav.*.description` show a stale/duplicate source batch (locales translated an older en that mentioned n8n/GitLab CI). `home.nav.credentials.label` says "Connections" while key name and description say credentials.

| key | problem | reported by |
|---|---|---|
| `shared.reasoning_trace.heartbeat_silent` | Source fragment 's (silent' (and its siblings shared.progress_extra.s_elapsed, shared.progress_extra.s_remaining, shared.terminal_extra.lines_suffix, shared.terminal_extra.new_line/new_lines) is built by runtime concaten | ar, vi |
| `home.summary_stats` | Placeholders {personasPlural} and {credentialsPlural} exist only to carry English pluralization ('s'), which has no Bengali equivalent — even a fully corrected Bengali translation must keep these meaningless placeholders | bn, cs, fr, hi, ja, ko, ru |
| `shared.devtools_no_projects / shared.devtools_no_projects_hint` | The shipped target text (in English) doesn't match either language of the pair — it's a different English sentence than the key's own 'en' value ('No projects found' vs 'No codebases found'; a 'Dev Tools' mention not in  | bn |
| `home.nav.team.description / home.nav.teams.description` | Two keys with the same label ('Teams') and near-identical English source carry unrelated Czech content — looks like a stale/duplicate key pair (nav.team likely superseded by nav.teams); worth a dead-key check. | cs, vi, zh |
| `common.select` | Source itself hardcodes decorative ASCII dashes around the placeholder ('-- select --') rather than using a real UI convention for a placeholder option; every locale has to guess whether to mirror the ASCII dashes or loc | de |
| `home.operator` | en is "User" but target is "Operador" (Operator) — a full concept mismatch, not a translation nuance; either the English source drifted from an older 'Operator' label or the translator substituted a different concept. Ne | es |
| `home.nav.credentials.label` | en is "Connections" but the target ("Credenciales") and the sibling en description (about logins/passwords/credentials) both point to "Credentials" — the English label itself looks stale relative to its own description. | es |
| `home.nav.design-reviews.description` | Target mentions "flujos de n8n" and "galería de plantillas", content absent from the current en source ("Browse ready-made agent blueprints, import workflows, and generate new agent designs") — looks like a stale transla | es |
| `shared.progress_extra.click_generate` | quotes a literal English button label ("Generate Persona Draft") with no equivalent Hindi button label found elsewhere in this batch — ambiguous whether the quote should track an actual untranslated live UI string or be  | hi |
| `home.nav.credentials.label / home.nav.credentials.description` | English label reads "Connections" but the key name and description still describe credentials; the parallel home.nav.team / home.nav.teams pair in the same file (identical label+description duplicated under two keys) sug | id |
| `status_tokens.event_reason._comment_section` | Not a defect in the translatable value (per contract, _comment* segments are notes and rightly left verbatim), but flagging that this comment key was included in the review batch even though it never renders — no action  | id |
| `common.confirm_destructive_delete_persona / common.confirm_destructive_delete_persona_warning` | The English source values literally say 'Agent' although the keys are named delete_persona; the RU rendering ('агента') is a correct translation of the actual English word, but the source itself conflates persona/agent u | ru |
| `triggers.tab_shared_subtitle` | Ambiguous for native review: target ("发现并订阅其他代理共享的事件") mentions agents/personas sharing events, but the en source ("Subscribe to curated global events — including connector API updates — and wire them into your workflows | zh |
| `director.run_all` | Ambiguous for native review: target ("审查范围内所有代理") says "review all agents in scope", but the en source ("Review all in scope") does not specify what "in scope" refers to (could be personas/agents, or something else entir | zh |
| `shared.forms_extra.select_persona_icon / shared.forms_extra.select_agent_icon` | Two near-duplicate English keys ('Select persona icon' / 'Select agent icon') label what appears to be the same UI control with different English nouns (persona vs agent). Translators converged on 人格 for both in this bat | zh |
