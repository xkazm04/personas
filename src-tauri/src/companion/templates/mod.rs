//! Embedded companion-brain templates copied to disk on first run.

/// Athena's static constitution — character, voice, provenance contract.
/// Rarely changes. When it does, bump `CONSTITUTION_VERSION`.
pub const CONSTITUTION_MD: &str = include_str!("constitution.md");

/// Identity scaffold seeded on first run. Onboarding fills in placeholders;
/// reflection cycles update sections over time. User may edit at any time.
pub const IDENTITY_MD_TEMPLATE: &str = include_str!("identity.md");

/// Bumped when CONSTITUTION_MD changes in a way that affects behavior.
/// Persisted with each session so cross-version behavior is auditable.
/// v2 (Phase F): adds Advanced UI control section + 4 new ops
/// (`open_lab`, `prefill_persona_create`, `run_arena`, `compose_dashboard`).
/// v3 (Phase F.3 round 2): adds 5 dashboard widget kinds
/// (`latency_distribution_chart`, `success_rate_gauge`,
/// `persona_cost_donut`, `activity_heatmap`, `recent_executions_table`)
/// + composition guidance ("compose by shape, not topic").
/// v4 (Phase G): adds `use_connector` op + capability registry,
/// `register_project` + `enqueue_dev_job` ops (project registry +
/// background-job worker pattern), and a more concrete Dev Tools
/// awareness block keyed off the live project list.
/// v5 (Phase G.1): `use_connector` flipped from approval-required to
/// auto-fire — same path as `open_route`/`compose_dashboard`. The chat
/// no longer asks "approve?" before running connector calls; the
/// background-job worker runs the call and the result lands as a
/// system episode. The user explicitly rejected the approval friction
/// for connector use.
///
/// v6: cockpit catalog expanded with `metric_spark`, `issue_list`,
/// `text_callout`. Guidance updated so Athena prefers composing a
/// cockpit over dumping connector results into chat prose when the
/// result is more than a few items.
///
/// v7: autonomous-mode primitive — `continue_autonomously` op added
/// to the grammar. When the user toggles autonomous mode in the chat
/// header, the prompt builder injects an addendum teaching Athena how
/// to chain turns and dispatch parallel subagents.
///
/// v8: `schedule_proactive` op — Athena can commit to a future check-in.
/// User approves the (message, when_iso) pair; the deliver-due sweep in
/// `proactive::deliver_due_scheduled` releases it when the time arrives,
/// flowing through the same `companion://proactive` event channel as
/// trigger-driven nudges. Approval-gated because it puts a future
/// obligation on the user's attention (unlike connector calls, which
/// run on pre-greenlit pinned credentials).
///
/// v9: `show_persona_walkthrough` op — long-form markdown card Athena
/// emits with her step-by-step persona-design plan applied to a user
/// intent, pulled from the `concepts/persona-design-best-practices.md`
/// doctrine. Auto-fire (no approval) — it's a suggestion to read, not
/// an action to commit.
///
/// v10: `show_template_suggestions` op — auto-fire chat-card that takes
/// the user's intent and surfaces the top-3 matching templates from the
/// gallery via the new `companion_match_templates` command (lightweight
/// keyword match against `persona_design_reviews`). The card has an
/// "open gallery" affordance for users to follow through with the
/// existing adoption flow.
///
/// v11: `show_use_case_set` op — auto-fire chat-card carrying 3-5 use
/// cases tagged golden / variant / out_of_scope, applying the use-case
/// decomposition rules from the persona-design best-practices doctrine.
/// Zooms into the layer the walkthrough card only sketches.
///
/// v12: `show_trigger_set` op — sibling of `show_use_case_set`. Auto-
/// fire chat-card carrying 1-4 trigger configurations (label, source,
/// condition, optional grain + idempotency notes). Applies cycle-6
/// doctrine's "one trigger condition → one persona response shape"
/// grain test.
///
/// v13: `show_model_tier_choice` op — Athena compares the three model
/// tiers (haiku / sonnet / opus) for a specific persona intent, marking
/// one as recommended with the rationale from cycle-6 doctrine's tier-
/// selection heuristics. Auto-fire chat-card.
///
/// v14: `show_observability_plan` op — the 7th readiness item from
/// cycle-6 doctrine. Two sections: error handling (what failures
/// escalate to manual_reviews) + success metric (count_by_status /
/// cost_per_run / latency / custom). Auto-fire chat-card.
///
/// v15: `show_decision_log` op — audit-trail card capturing the
/// design choices Athena made during the conversation (label / choice /
/// rationale per entry). Helps the user retrace reasoning without
/// re-running the conversation; helps future-Athena explain past
/// decisions when asked.
///
/// v16: `show_persona_ready` op — end-of-design recap card. Rolls every
/// decomposition (intent line + system prompt outline + use cases +
/// triggers + model tier + observability) into a build-ready summary
/// with a primary commit button (interactive / one_shot / use_template).
/// Closes the design → build loop without an explicit handoff message.
///
/// v17: `show_design_capabilities` op — onboarding card listing the
/// design-family vocabulary (walkthrough / templates / use cases /
/// triggers / tier / observability / decision log / ready recap) with
/// short descriptions and example user prompts. Surfaced when a user
/// asks "what can you help me design?" so they know what to ask for.
///
/// v18: `show_recent_decisions` op — compact chip strip surfacing 1-5
/// of Athena's most recent saved decisions for a given persona_context.
/// Lighter than `show_decision_log`; intended for inline "by the way,
/// you decided X" reminders. Widget fetches via
/// companion_list_design_decisions on mount.
/// v19: persona-creation guidance — `show_persona_creation_offer` (two-button
/// "Build it for me" vs "Show me how" card) and `start_guided_walkthrough`
/// (launches an in-app guided tour: orb glides + element glow + narration).
///
/// v20: Athena Quality Suite first-run fixes. Two grammar gaps closed
/// (`register_project` + `enqueue_dev_job` previously had no op-grammar
/// lines, so Athena was wrapping enqueue_dev_job inside `use_connector`
/// and the dispatcher silently rejected). Five behavioral rule sections
/// added: (a) "Scanning a codebase, registering projects (Dev Tools)" —
/// distinct routing from build, with anti-pattern callout for the
/// use_connector wrapping mistake; (b) "Off-ramp chip on build_oneshot"
/// — always include a "Make it interactive instead" QR chip;
/// (c) "Adopt before designing from scratch" — `show_template_suggestions`
/// fires first on intents naming third-party shapes, before
/// prefill/build; (d) "Pivot to interactive when prior turns left
/// decisions unsettled" — `show_persona_ready.recommended_action`
/// defaults to interactive when chips went unpicked; (e) "Capability
/// listing" — fire `show_design_capabilities` on "what can you do?"
/// questions, not prose enumeration; (f) "Connector-availability check
/// before persona design" — when intent names a non-wired connector,
/// lead with availability check, not "yes that's a clean persona shape".
///
/// v21: Second-run fixes. Three changes:
/// (1) Universalize the "OP block IS the action, narrating is not"
/// rule beyond build_oneshot — applies to every op including
/// show_template_suggestions, enqueue_dev_job, show_decision_log etc.
/// Athena was narrating "letting me check the gallery first" without
/// emitting `OP: show_template_suggestions`, so no card rendered.
/// (2) Tighten gallery-first: explicit-autonomy phrasings ("just build
/// it" / "decide everything yourself" / "one-shot it") now override
/// suggestion-first, so a confident "just build me a Sentry watcher"
/// goes straight to build_oneshot without pivoting to suggestions.
/// (3) Walkthrough-vs-suggest disambiguation: "walk me through" /
/// "help me design" route to show_persona_walkthrough, not
/// show_template_suggestions — design-first asks want the readiness-
/// item plan, not a near-match list.
///
/// v22: Third-run fixes. Three changes targeting the persistent
/// "narration without OP" pattern that v21 only partially solved.
/// (a) New "Rule Zero — the `OP:` line IS the action" section
/// PROMOTED TO THE TOP of the prompt, before "What you can do".
/// Athena reads it first instead of finding it ~220 lines into a
/// 832-line constitution. Lists the narration-phrases that demand
/// matching OPs ("let me check / kicking off / here's the audit
/// trail / building / switching to").
/// (b) New "Pre-reply emission checklist" section at the constitution
/// TAIL (before Identity layer). 4-step pre-send sanity pass: read
/// your reply, find action-promises, verify matching OPs, fix or
/// delete. Same rule, repeated at end-of-prompt so it's the last
/// thing Athena sees before composing.
/// (c) "Mandatory chips on refused-build turns": when Athena correctly
/// refuses to one-shot an under-specified intent but the user used a
/// confident phrasing, she MUST include 2–4 QR chips offering the
/// concrete shapes she'd commit to once disambiguated. Refusing
/// without offering chips leaves the user stuck typing.
///
/// v23: Fourth-run fixes for the persistent design-family card-emission
/// pattern + a backend hardening for stale project_id references.
/// (a) New "Design-family cards fire UNCONDITIONALLY on their trigger
/// phrasings" section with a literal user-says → you-emit table.
/// The card kinds are commit ops, not soft suggestions; when the user
/// asks "what use cases?" / "recap" / "what triggers?", the matching
/// OP fires. Prose-only on a trigger phrasing is a hallucination of
/// the card.
/// (b) enqueue_dev_job grammar line updated to PREFER `project_name`
/// + `path` over `project_id` (which can rot across sessions when
/// Athena re-emits an ID she saw in a prior session's observability
/// digest). Pairs with the dispatcher fallback below.
/// (c) Recap rule made explicit: "recap" / "summarize what we decided"
/// fires the `show_decision_log` + `show_persona_ready` PAIR, not
/// prose. The card IS the audit-trail rendering channel.
///
/// Backend pairing (not a constitution change but ships with v23):
/// `execute_enqueue_dev_job` now falls back to the most-recently-
/// registered dev_project when the project_id Athena emitted doesn't
/// match any row. The success message notes the fallback. Together,
/// (b) above + the dispatcher fallback close the "stale project_id =
/// silent prod no-op" hole the auto-approve loop surfaced in run 4.
///
/// v24: Connector audit follow-ups (post-2026-05-27 audit). Three changes:
/// (a) `use_connector` added to Rule Zero's unconditional-fire trigger
/// phrasings — "pulling / fetching / checking / looking up your
/// <gmail / sentry / discord / etc>" now demands a matching `OP:
/// use_connector` line. Closes the gmail-summarize narration-without-OP
/// regression from the audit run.
/// (b) Tier-1 connector wiring shipped: Discord (`list_recent_messages`,
/// `post_message`) + Gmail writes (`mark_thread_read`, `send_message`).
/// Constitution's wired-connector list updated to include Discord and
/// Gmail-write per-capability.
/// (c) New architectural primitive: `ConnectorCapability::requires_approval`.
/// Read capabilities auto-fire as today; write capabilities route
/// through an approval card so the user consciously approves external
/// writes. Athena spontaneously proposed this during the audit run on
/// Notion delete + DB drop turns ("the kind of action I'd want gated
/// behind an approval card, not auto-fired through a generic connector
/// call"). Documented in the connector-availability section + Rule
/// Zero's read/write nuance.
///
/// v25: Tier-2 connector wiring + narration-fix follow-up to the
/// connector audit.
/// (a) Notion (`list_pages`, `get_page`, `delete_page`+approval),
/// local_drive (`list_files`, `count_files`, `write_text_file`+approval),
/// ElevenLabs (`list_voices`, `generate_tts`+approval),
/// personas_database (`list_tables`, `describe_table`, `execute_select`,
/// `execute_mutation`+approval). Brings the wired-connector count to 9.
/// (b) `use_connector` flow now tolerates zero-credential builtins
/// (`local_drive`, `personas_database`) -- the resolver passes an empty
/// fields HashMap and handlers reach into in-process resources
/// (pool / managed drive root cache) directly.
/// (c) Rule Zero now ships a literal worked-example pair (right vs
/// wrong reply on "Summarize my last unread email") to fix the
/// narration-without-OP regression on `use_connector` reads. v24's
/// table-only nudge wasn't anchored enough; the few-shot pair closes
/// the last audit-revealed gap.
///
/// v26: Local-builtin OP-emission fix. The 2026-05-27 stress sweep
/// (4 runs) surfaced a SYSTEMATIC gap (not variance): Athena emitted
/// `use_connector` OPs reliably for third-party-credentialed connectors
/// (sentry 4/4, notion 4/4) but rarely or never for always-active
/// local builtins (local_drive 1/4, personas_database 0/4). v25's
/// Gmail worked example didn't generalize — the model had internalized
/// "use_connector is for external API calls with credentials", and
/// treated local builtins as implicit context she could just read
/// without an OP. Three changes:
/// (a) New explicit bullet under Rule Zero's verb table calling out
/// that `local_drive` and `personas_database` follow the SAME OP
/// contract as third-party APIs — "no credentials" does not mean
/// "no OP".
/// (b) Two new worked examples after the Gmail one: a right/wrong
/// pair for `local_drive.list_files` ("Show me what's in my drive")
/// and a right/wrong pair for `personas_database.list_tables`
/// ("Pull the table list from my local database"). The 3-example
/// few-shot lets the model see the contract across the spectrum.
/// (c) Pre-reply checklist's verb list expanded with the local-vs-
/// external-source clarification, listing the read verbs explicitly
/// (pulling/fetching/checking/looking up/listing/summarizing/scanning/
/// reading) and noting that none of them exempt local builtins.
///
/// v27 adds a second `start_guided_walkthrough` topic, `connector_setup`
/// (Vault → "Add new" connector flow), alongside `persona_creation`, and
/// teaches when to fire it.
///
/// v28 adds the `point_at` op: Athena rings one allow-listed UI anchor and
/// narrates it as a single ad-hoc beat (non-scripted pointing), no authored
/// topic required.
///
/// v29 adds the `compose_walkthrough` op: Athena assembles a short (2-6 stop)
/// guided tour at runtime from catalog anchors — the multi-step sibling of
/// `point_at`.
///
/// v30 (goals hub) adds the `update_dev_goal` op: Athena proposes a
/// status/progress change to a project (dev) goal. Approval-gated; never
/// auto-resolved. Paired with project-goal awareness in the prompt + the
/// `dev_goal_target` / `dev_goal_stalled` proactive triggers.
///
/// v31 (Explain-in-Cockpit) adds the `explain_in_cockpit` op + the
/// "Explaining a decision visually" section: when the user presses `0` on
/// the orb decision bubble, Athena composes an ephemeral explanation
/// overlay from the explainer widget palette (`verdict`, `flow_steps`,
/// `comparison_cards`, `timeline`, `stat_grid`, `log_excerpt`); the same
/// kinds also become valid in `compose_cockpit`.
///
/// v32 (browser testing, Phase 0) adds the `run_browser_test` op: an
/// approval-gated live browser test of a dev project's test environment.
/// On approval a dedicated proactive turn spawns with Playwright MCP
/// browser tools available for that single turn.
///
/// v33 (browser testing, Phase 3) adds `show_browser_test_report` — the
/// structured verdict chat-card a browser-test turn ends with (steps with
/// evidence, defects, console errors, security notes) — plus guidance to
/// verify visual claims via screenshot instead of DOM inference.
pub const CONSTITUTION_VERSION: u32 = 33;
