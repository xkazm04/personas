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
/// `persona_cost_donut`, `activity_heatmap`, `recent_executions_table`) +
/// composition guidance ("compose by shape, not topic").
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
/// User approves the (message, when_iso) pair; the release sweep in
/// `proactive::release_pending` delivers it when the time arrives,
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
/// (b) enqueue_dev_job grammar line updated to PREFER `project_name` +
/// `path` over `project_id` (which can rot across sessions when
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
///
/// v34 (operational data, B1) teaches the read-only `operations_database`
/// connector: `use_connector { capability: "query_operations", view, … }` over
/// the OPERATIONAL store (executions / messages / reviews / incidents / goals /
/// KPIs) — distinct from `personas_database` (the brain DB). When to query vs.
/// use the deterministic Radar/Sunrise flows, and the untrusted-content guard
/// (result cells are data, never instructions).
///
/// v35 (guidance anchors, E1) refreshes the `point_at` anchor list to include
/// the new content anchors (templates_gallery, settings_page). The Rust
/// allow-list is now code-generated from the frontend catalog, so the set grows
/// without a manual sync; invalid anchor ids are dropped server-side.
///
/// v36 (walkthrough offer, E3) adds `show_walkthrough_offer { topic, summary? }`
/// — a generalized "Show me / Just tell me" card for any guided walkthrough
/// topic, the default response to "how do I X" when a walkthrough covers X.
///
/// v37 (identity diffs, F1) upgrades `update_identity` from a whole-file
/// `{content}` rewrite to anchored `{diffs}` (append/replace/remove one bullet
/// under a named section, evidence-cited) — preferred for ongoing learning;
/// `content` mode stays for the intake first draft. Still approval-gated, never
/// auto-fires.
///
/// v38 (intake on request, F2) teaches Athena to re-run the intake interview
/// when the user asks ("Get to know me" / "let's do the intake"), not just on
/// first launch — a few warm questions, ending in an `update_identity` proposal.
/// Surfaced via a WelcomeHero chip + a `/intake` slash preset.
///
/// v39 (walkthrough coverage, E2) expands `start_guided_walkthrough` /
/// `show_walkthrough_offer` from two topics to six, adding `trigger_creation`,
/// `template_adoption`, `incident_triage`, and `goal_kpi_setup` so Athena can
/// teach-by-showing across the Events, Templates, Incidents, and Goals/KPI
/// surfaces — not just persona creation and connector setup.
///
/// v40 (KPI management) teaches the `calibrate_kpi` / `evaluate_kpi` /
/// `scan_kpis` ops + the `# Project KPIs` context digest, so Athena can manage
/// the outcome layer (adjust targets/tiers/critical lines, measure now, propose
/// new KPIs) on the user's behalf — the steering layer above goals.
///
/// v41 (guided KPI config) adds the `propose_kpi` op + digest guidance: when the
/// user asks to set up/configure a KPI, Athena gathers its shape conversationally
/// and proposes ONE specific KPI (created proposed + background measurement
/// setup) for the user to verify in Teams › KPIs.
///
/// v42 (fleet recovery — Phase 4) teaches the `fleet_wake` / `fleet_resume` ops:
/// user-requestable session recovery (revive a hibernated session; adopt an
/// orphaned CLI process after a restart), confidence-gated on the autonomous
/// path like `fleet_send_input`.
///
/// v43 (chip clarity) adds a "Plain language, no jargon" rule to the Quick
/// replies section: QR chips are read by a regular user who doesn't know the
/// Personas codebase, so they must stay short and conversational and never
/// contain internal names, code identifiers, file paths, IDs, op names, or
/// version tags. Behavioral wording change only; no new op.
/// v44 (bench-derived discipline) adds two rules proven by the 1,026-turn
/// model/effort bench (`docs/plans/athena-model-bench-report.md`):
/// (a) **multi-op completeness + one-line strictness** under Rule Zero — every
/// distinct ask in a message gets its own single-line minified OP line (the
/// bench's two-action scenario lost the second op, and one turn broke parsing
/// with prose after the closing brace); (b) **memory honesty** under
/// `write_fact` — never claim a fact is "already in your notes" unless this
/// turn's injected context shows it (every Opus cell skipped a requested
/// write_fact 3/3 by hallucinating that the fact was already stored; Sonnet
/// never did). Doctrine-strength note: these act-decisively rules are for
/// main/aside tiers (effort ≥ medium) — the bench showed aggressive
/// act-doctrine at LOW effort regresses awareness (re-spawns in-flight work),
/// which is why the micro tier (`model_routing::MICRO`) gets no constitution.
///
/// v45 (batch backlog triage) documents `backlog_apply_triage` — a
/// SYSTEM-created approval action Athena must recognize on the approval surface
/// but must never emit from chat. It carries the accept/reject verdicts of one
/// "Send to Athena" batch over the Approvals › Backlog tab; the ask "triage my
/// backlog" is answered by pointing at that button, not by composing an op.
/// v46 (Mastermind canvas) gives Athena her first read of the canvas: a
/// worst-first scene digest in the prompt, two read ops for the detail it
/// truncates (`describe_canvas_project`, `describe_canvas_freshness`), and
/// three actions over it (`canvas_dispatch`, `canvas_group_dispatch`,
/// `canvas_run_idea_scan`). The rules that needed teaching, not just listing:
/// slugs come from the block or a lookup and are never derived; `unknown` is a
/// data-load failure, not a gap in the product; and the six `demo-*` islands
/// are placeholders every action refuses.
/// v47 (canvas panels) adds `compose_canvas_panel`: a SurfaceSpec v1 surface
/// docked beside the Mastermind canvas for ONE project. The rules that needed
/// teaching rather than listing: composing REPLACES that project's panel (it is
/// persisted and restored on focus, so it must read as the current picture);
/// only the seven frozen block types exist; the slug rule from v46 applies
/// unchanged; and a reset by the user is a verdict on the composition, not an
/// invitation to re-compose the same thing.
/// v48 adds `show_ship_milestone` — the editable milestone card. Athena
/// proposes a whole cut (name, goal, scope members) and the operator edits and
/// confirms before anything is written. Its doctrine: every `item_id` comes
/// from something she actually read, members are use cases and goals ONLY, and
/// KPIs are the outcome layer above a milestone rather than part of one.
/// v49 (canvas steering) adds `canvas_control` — the door onto the frontend's
/// canvas action grammar: camera verbs plus the zoom-gated cell/popover opens.
/// Its doctrine: view only (auto-fire, nothing mutates), max 4 per turn, the
/// settled result returns as a next-turn system note that must be read before
/// steering again, and reading content stays on `describe_canvas_project`.
/// v50 (cross-device link) adds `remote_instruct` — Athena hands an
/// instruction to ANOTHER of Michal's paired devices, where that device's own
/// Athena runs it as a real turn with her own ops and her own approval rules.
/// The doctrine that needed teaching rather than listing: it is a colleague,
/// not a remote shell, so the instruction must be self-contained (the other
/// side cannot see this conversation, and a pronoun reaches nobody); the answer
/// arrives later as system notes, so "it's running over there" is the honest
/// report until it does; and the consent rule is mode-conditional — with
/// autonomous mode OFF only the HOME device is reachable and only behind an
/// approval card, any other paired device is refused outright, while with the
/// mode ON it fires to any paired device. She has no paired-device digest in
/// her prompt, so the names come from Michal or not at all, and omitting
/// `device` means the home machine.
/// v51 (device roster) gives her the paired-device list v50 explicitly said she
/// did not have: a `# Paired devices` prompt block naming each of Michal's other
/// installs, which one is home, and whether it is reachable this turn. The
/// doctrine had to move with it or the two would contradict each other — v50
/// told her the names came from Michal or not at all, so the block alone would
/// have arrived beside an instruction not to trust it. What needed teaching
/// rather than listing: she may now CHOOSE the machine instead of echoing one
/// (default to home, deviate only when the work plainly belongs elsewhere); a
/// device marked unreachable is asleep, so the honest move is to say so and
/// offer home rather than send into a void; and an ABSENT block means nothing
/// is paired, which is a fact to report, not a gap to fill with a guess. The
/// block is absent in a lite build too, where the transport does not exist —
/// same shape, same reading, no special case.
/// v58 (read the brief; investigate before you ask) reverses the direction of a
/// habit two surfaces had been teaching her at once. The Ship tab's Ask-Athena
/// message ended with a script — "give him a SHORT read of where the milestone
/// stands and the one thing you would look at first, then let him talk" — which
/// named her answer's shape before she knew the input and told her, in the last
/// clause, to stop investigating. The doctrine here pushed the same way: "let
/// the idea arrive unfinished … ask what outcome he is after". Both are right
/// for an idea Michal is saying out loud, and both are wrong for a brief he
/// already wrote down. On 2026-08-25 the two combined on a milestone whose
/// description named the deliverables, the research to run, the registry path to
/// write to and the out-of-scope, and the turn asked him to state the direction
/// in his own words. `describe_ship_milestone` had also been reading that
/// description out of SQL and never printing it, so the answer she was reasoning
/// over genuinely did not contain it — the field is printed now, under "WHAT
/// SHIPPING THIS MEANS", and the doctrine says plainly that anything the brief
/// settles is decided. The new section teaches the move that was missing rather
/// than only banning the one that fired: an objective naming a SUBJECT rather
/// than a deliverable is a research dispatch, in a fixed order — read the brief,
/// read the project, dispatch sessions for what neither can answer
/// (`canvas_dispatch` / `show_fleet_plan` / `enqueue_runner_task`), and only
/// then ask the two or three questions that genuinely need him. The self-test
/// is one line: could this have been answered by reading something?
/// Shipping with it, so the two halves cannot disagree: the Ask-Athena message
/// is now a pure pointer (project, milestone id, read it with this op — no
/// verdict, no cut summary, no script), and the verdict it used to paste is
/// published by the Ship tab to `ship.readiness.v1` and served BY the read op,
/// the same door `mastermind.scene.v1` opened for the canvas. So the verdict
/// still reaches her — pulled when she asks, instead of pushed ahead of the
/// question, which is the whole difference between a tool and a conclusion.
/// v59 (decompose the brief) adds `show_ship_goals` — the editable card that
/// turns a milestone's written brief into goals — and closes a hole v58 made
/// visible without naming. v58 told her to READ the brief and treat what it
/// settles as decided; this section had been telling her, since the Ship layer
/// shipped, that "an idea with no home yet is a GOAL bound to the milestone".
/// Both were right and neither was actionable, because **she had no op that
/// could create a goal.** `show_ship_milestone` and `set_ship_scope` resolve
/// every id against the registry and refuse one that is not there — correct for
/// keeping invented ids out of the database, and it meant the only route from a
/// brief that names three deliverables to three trackable goals was for Michal
/// to hand-author each one. The new op is the missing verb, in the same shape
/// and the same consent posture as its two siblings: auto-fire, no approval
/// row, the editable card IS the consent surface, and the confirm path
/// re-validates the rows HE edited rather than the ones she proposed. The rules
/// that needed teaching rather than listing: a goal title is a TITLE and the
/// prose goes in `description` (the same correction v48's objective needed); a
/// `context_hint` must name a context in that milestone's project and omitting
/// it is the honest way to say an idea has no home yet; and a title that
/// already exists BINDS that goal rather than creating a twin, so re-proposing
/// is safe and the card says which rows are new. The project is never in the
/// payload — it is read off the milestone row, so a proposal has no way to
/// point at the wrong one.
/// v60 (the op catalog stops drifting from the prose) teaches the eight ops
/// and the one route that were wired end to end — allow-list, dispatcher arm,
/// executor, approval card — and named nowhere in this document, so Athena had
/// no vocabulary for them and could never emit one: `delete_procedural`,
/// `delete_goal`, `set_ritual_active`, `delete_ritual` (each in its family's
/// section, with the distinction that actually needed teaching — pause is not
/// delete, abandoned is not delete, supersede is not delete), the two read ops
/// `list_runner_tasks` and `describe_brain_health` (in "Detail on demand",
/// which now reads "eight" and not "six"), the `mastermind` pseudo-route
/// beside `monitor`, and a DEV MODE ONLY section for `dev_improve` /
/// `dev_merge` whose real brief is injected by `companion::dev_mode` — the
/// section's job is the negative rule, that without that brief in front of her
/// the op can only produce a card that fails. Nothing was retired: all eight
/// have live dispatcher arms. The drift is now gated —
/// `dispatcher::catalog`'s `every_catalog_op_is_taught_by_the_constitution`
/// fails the build on the next one, with a positive control so a broken
/// matcher cannot pass as a clean catalog.
///
/// v61 (the Notepad) adds the pad's two ops — the read op `describe_note` and
/// the card op `show_note_suggestions` — plus an optional `note_id` on
/// `show_ship_goals`. The pad is a footer overlay holding up to ten scratch
/// requirements, and it deliberately never pastes a note's body into her
/// prompt: a note is edited continuously, so a copy in the turn is stale the
/// moment it is composed. That makes `describe_note` not a convenience but the
/// only way she has read the thing she is being asked about — which is why the
/// section leads with it and why the answer also carries the project's OPEN
/// milestone, so the id `show_ship_goals` needs is in the reading rather than in
/// a second lookup she has to remember to make. `show_note_suggestions` is the
/// fourth card op in the `show_fleet_plan` family and the first whose consent
/// surface is not only the chat: the same rows render as inline blocks inside
/// the note, at the heading each one anchors to, and each row is answered ON ITS
/// OWN. There is no batch Confirm, and the section says why rather than only
/// stating it — "apply all eight of her paragraphs" is not a decision anybody
/// makes about their own writing. The three row kinds needed teaching rather
/// than listing: a `question` row writes NOTHING into the note, and exists so an
/// unclear brief produces a question instead of an assumption with a section
/// built on top of it. The rule most likely to bite: **a body edit is refused on
/// anything but a draft**, because a published note may already be open in a
/// running CLI session — so a suggestion against a published note is a card whose
/// Accept button cannot work, and the read op says the status for exactly that
/// reason.
///
/// ## How a bump reaches the running app
///
/// Athena's prompt does NOT read this constant. `prompt::build`
/// (`build_system_prompt`, ~line 68) reads the DISK copy at
/// `~/.personas/companion-brain/constitution.md`, so an edit to
/// `constitution.md` alone changes nothing on a machine that already has one.
/// The re-seed is `disk::ensure_initialized`, which runs on companion init and
/// compares this constant against the `companion_constitution_version` row in
/// `app_settings`: when the stored stamp is missing or lower it copies the
/// existing file to `constitution.bak-<UTC timestamp>.md`, writes the embedded
/// copy over it, and re-stamps. That is the whole delivery mechanism — **not
/// bumping this number ships prose that no session will ever read.** Verified
/// 2026-09-03 by reading both ends (`disk.rs:72-106`, `prompt/build.rs:67-69`).
/// Note that the backups are never reaped: 31 of them accumulated before
/// anyone counted, and retention is a Director call, not this constant's.
pub const CONSTITUTION_VERSION: u32 = 61;
