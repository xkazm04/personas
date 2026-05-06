//! System-prompt composition for the companion's CLI session.
//!
//! Layers fed to Claude every turn:
//!   1. Constitution — static character + voice + provenance contract.
//!   2. Identity — evolving self-model from `identity.md`.
//!   3. Observability digest — current state of the Personas app.
//!   4. Recalled conversation — episodes via hybrid retrieval.
//!   5. Reference (doctrine) — relevant chunks of the curated app docs.
//!
//! The two recall sections are kept distinct so Athena can tell us-history
//! ("we discussed X") from canonical reference ("the docs say X").

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use crate::companion::brain::backlog::BacklogItem;
use crate::companion::brain::episodic::{self, Episode};
use crate::companion::brain::goals::Goal;
use crate::companion::brain::procedural::Procedural;
use crate::companion::brain::retrieval::{self, DoctrineHit, Recall};
use crate::companion::brain::semantic::Fact;
use crate::companion::connectors;
use crate::companion::disk;
use crate::companion::plugins;
use crate::companion::observability;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Build the full system prompt.
///
/// `query` is the user's current message — used to seed retrieval. Pass
/// an empty string for non-retrieval prompts (e.g., reflection cycles).
#[cfg(feature = "ml")]
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    embedder: Option<&Arc<EmbeddingManager>>,
    session_id: &str,
    query: &str,
    voice_enabled: bool,
) -> Result<String, AppError> {
    let root = disk::brain_root()?;
    let constitution =
        fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new());
    let identity = fs::read_to_string(root.join("identity.md")).unwrap_or_else(|_| String::new());

    let observability_md = observability::build(sys_db)
        .ok()
        .as_ref()
        .map(observability::format_for_prompt)
        .unwrap_or_default();

    let recall = match embedder {
        Some(emb) => retrieval::retrieve(user_db, emb, session_id, query)
            .await
            .unwrap_or_default(),
        None => Recall {
            episodes: episodic::list_recent(user_db, session_id, 20).unwrap_or_default(),
            doctrine: Vec::new(),
            facts: crate::companion::brain::semantic::list_facts(user_db, None, false, 6)
                .unwrap_or_default(),
            procedurals: crate::companion::brain::procedural::list_rules(user_db, None, false, 6)
                .unwrap_or_default(),
            goals: crate::companion::brain::goals::list_goals(
                user_db,
                Some(crate::companion::brain::goals::GoalStatus::Active),
                8,
            )
            .unwrap_or_default(),
            backlog: crate::companion::brain::backlog::list_items(user_db, None, true, 6)
                .unwrap_or_default(),
        },
    };

    let onboarding_md = onboarding_addendum_if_needed(&identity, &recall.episodes);
    let voice_md = voice_addendum_if_needed(voice_enabled);
    let connector_names =
        connectors::list_enabled_for_prompt(user_db).unwrap_or_default();
    let connectors_md = format_connectors(&connector_names);
    let plugin_names = plugins::list_enabled(user_db).unwrap_or_default();
    let projects = crate::companion::projects::list(user_db).unwrap_or_default();
    let plugins_md = format_plugins(&plugin_names, &projects);

    Ok(compose(
        &constitution,
        &identity,
        &observability_md,
        &recall,
        &plugins_md,
        &connectors_md,
        &onboarding_md,
        &voice_md,
    ))
}

#[cfg(not(feature = "ml"))]
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    session_id: &str,
    _query: &str,
    voice_enabled: bool,
) -> Result<String, AppError> {
    let root = disk::brain_root()?;
    let constitution =
        fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new());
    let identity = fs::read_to_string(root.join("identity.md")).unwrap_or_else(|_| String::new());

    let observability_md = observability::build(sys_db)
        .ok()
        .as_ref()
        .map(observability::format_for_prompt)
        .unwrap_or_default();

    let recall = Recall {
        episodes: episodic::list_recent(user_db, session_id, 20).unwrap_or_default(),
        doctrine: Vec::new(),
        facts: crate::companion::brain::semantic::list_facts(user_db, None, false, 6)
            .unwrap_or_default(),
        procedurals: crate::companion::brain::procedural::list_rules(user_db, None, false, 6)
            .unwrap_or_default(),
        goals: crate::companion::brain::goals::list_goals(
            user_db,
            Some(crate::companion::brain::goals::GoalStatus::Active),
            8,
        )
        .unwrap_or_default(),
        backlog: crate::companion::brain::backlog::list_items(user_db, None, true, 6)
            .unwrap_or_default(),
    };

    let onboarding_md = onboarding_addendum_if_needed(&identity, &recall.episodes);
    let voice_md = voice_addendum_if_needed(voice_enabled);
    let connector_names =
        connectors::list_enabled_for_prompt(user_db).unwrap_or_default();
    let connectors_md = format_connectors(&connector_names);
    let plugin_names = plugins::list_enabled(user_db).unwrap_or_default();
    let projects = crate::companion::projects::list(user_db).unwrap_or_default();
    let plugins_md = format_plugins(&plugin_names, &projects);

    Ok(compose(
        &constitution,
        &identity,
        &observability_md,
        &recall,
        &plugins_md,
        &connectors_md,
        &onboarding_md,
        &voice_md,
    ))
}

fn format_episodes(episodes: &[Episode]) -> String {
    if episodes.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Recalled conversation (oldest first)\n\n");
    for ep in episodes {
        s.push_str(&format!(
            "## {} — {}\n\n{}\n\n",
            ep.role, ep.created_at, ep.content
        ));
    }
    s
}

/// Render facts grouped by scope. Each fact lists its sources so Athena
/// can cite back to the source episodes when she draws on it. Facts
/// without sources don't reach this layer (rejected at write time), but
/// we defensively skip empty-source rows just in case.
fn format_facts(facts: &[Fact]) -> String {
    if facts.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Semantic memory (facts you've distilled — every entry is cited)\n\n");
    let mut last_scope: Option<&str> = None;
    let mut sorted: Vec<&Fact> = facts.iter().collect();
    sorted.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(b.importance.cmp(&a.importance))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    for f in sorted {
        if last_scope != Some(f.scope.as_str()) {
            s.push_str(&format!("## {} facts\n\n", capitalize(&f.scope)));
            last_scope = Some(f.scope.as_str());
        }
        let sources = if f.sources.is_empty() {
            "no-sources".into()
        } else {
            f.sources.join(", ")
        };
        s.push_str(&format!(
            "- **{key}** (importance {imp}, conf {conf:.0}%) — {value}  [from {srcs}]\n",
            key = f.key,
            imp = f.importance,
            conf = f.confidence * 100.0,
            value = f.value.trim(),
            srcs = sources,
        ));
    }
    s.push('\n');
    s
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

/// Active goals — short list, sorted by priority. Athena should glance
/// at this before responding so she doesn't lose track of what the
/// user said they're working toward. NOT cited the way facts are —
/// goals are ongoing, not historical claims.
fn format_goals(goals: &[Goal]) -> String {
    if goals.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Active goals (what Michal said he's working toward)\n\n");
    for g in goals {
        let target = g
            .target_date
            .as_deref()
            .map(|d| format!(" · target {d}"))
            .unwrap_or_default();
        s.push_str(&format!(
            "- **{title}** (priority {p}{target}) — {desc}\n",
            title = g.title.trim(),
            p = g.priority,
            target = target,
            desc = first_paragraph(&g.description, 240)
        ));
    }
    s
}

/// Procedural rules — durable behaviors. Render with the trigger as the
/// "when" and behavior as the "do". Sources cite back to the episodes
/// where the rule was confirmed.
fn format_procedurals(rules: &[Procedural]) -> String {
    if rules.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Procedural rules (how to behave — every rule is cited)\n\n");
    let mut last_scope: Option<&str> = None;
    let mut sorted: Vec<&Procedural> = rules.iter().collect();
    sorted.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(b.importance.cmp(&a.importance))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    for r in sorted {
        if last_scope != Some(r.scope.as_str()) {
            s.push_str(&format!("## {} rules\n\n", r.scope));
            last_scope = Some(r.scope.as_str());
        }
        let sources = if r.sources.is_empty() {
            "no-sources".into()
        } else {
            r.sources.join(", ")
        };
        s.push_str(&format!(
            "- **When:** {trigger}  \n  **Then:** {behavior}  \n  _(imp {imp}, conf {conf:.0}%, from {srcs})_\n\n",
            trigger = r.trigger.trim(),
            behavior = first_paragraph(&r.behavior, 240),
            imp = r.importance,
            conf = r.confidence * 100.0,
            srcs = sources
        ));
    }
    s
}

/// Open backlog — what Athena has committed to do, plus capability
/// gaps she's flagged. The user shouldn't have to remind her.
fn format_backlog(items: &[BacklogItem]) -> String {
    if items.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Open backlog (your commitments + flagged capability gaps)\n\n");
    let (promises, gaps): (Vec<&BacklogItem>, Vec<&BacklogItem>) =
        items.iter().partition(|i| i.kind == "self_promise");
    if !promises.is_empty() {
        s.push_str("## Self-promises\n\n");
        for p in promises {
            let src = p
                .source_episode_id
                .as_deref()
                .map(|x| format!(" [from {x}]"))
                .unwrap_or_default();
            s.push_str(&format!("- {summary}{src}\n", summary = p.summary.trim()));
        }
        s.push('\n');
    }
    if !gaps.is_empty() {
        s.push_str("## Capability gaps\n\n");
        for g in gaps {
            s.push_str(&format!("- {summary}\n", summary = g.summary.trim()));
        }
    }
    s
}

fn first_paragraph(s: &str, max_len: usize) -> String {
    let firstline = s.lines().next().unwrap_or("").trim();
    if firstline.len() <= max_len {
        firstline.to_string()
    } else {
        let mut end = max_len;
        while !firstline.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}…", &firstline[..end])
    }
}

fn format_doctrine(doctrine: &[DoctrineHit]) -> String {
    if doctrine.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Reference — Personas docs (cite by path when you draw on these)\n\n");
    for d in doctrine {
        s.push_str(&format!("## From `{}`\n\n{}\n\n", d.file_path, d.content));
    }
    s
}

/// Render the "Plugins enabled" block. Each enabled plugin gets its
/// own awareness section so Athena knows what she can lean on. Plugins
/// are *internal* app capabilities — separate from connectors which
/// are external credentials. Empty when no plugins are toggled on.
///
/// `projects` is forwarded into the dev_tools block so Athena always
/// sees the live project registry (with their scan status) — passed
/// in rather than read here so the function stays sync + testable.
fn format_plugins(
    enabled: &[String],
    projects: &[crate::companion::projects::KnownProject],
) -> String {
    if enabled.is_empty() {
        return String::new();
    }
    let mut s = String::from(
        "\n\n# Plugins enabled (capabilities Michal has turned on for you)\n\n",
    );
    for name in enabled {
        match name.as_str() {
            "dev_tools" => {
                s.push_str(
                    "## Dev Tools\n\n\
                     Michal has the **Dev Tools plugin** enabled. He wants you to lead \
                     the product-development lifecycle of his projects.\n\n\
                     ### Registered projects\n\n",
                );
                if projects.is_empty() {
                    s.push_str(
                        "_No projects registered yet._ If he asks you about a project, \
                         offer to register it with `register_project` (you need a \
                         filesystem path + a short name).\n\n",
                    );
                } else {
                    for p in projects {
                        let scan_line = match (&p.last_scan_at, &p.last_scan_summary) {
                            (Some(at), Some(summary)) => {
                                format!(" · last scanned {at}: {summary}")
                            }
                            _ => " · **never scanned**".into(),
                        };
                        s.push_str(&format!(
                            "- **{name}** (`{id}`) — `{path}`{scan}\n",
                            name = p.name,
                            id = p.id,
                            path = p.path,
                            scan = scan_line,
                        ));
                    }
                    s.push('\n');
                }

                s.push_str(
                    "### Available actions\n\n\
                     **Long-running scans run as background jobs** — you don't block the \
                     chat waiting for them. The worker picks queued jobs up within a few \
                     seconds, runs them, and appends a system episode with the result so \
                     you see it on your next turn. Tell Michal that explicitly when you \
                     enqueue (\"I started the scan, will report back; what else?\").\n\n\
                     1. **Register a project** — `register_project` with `name`, `path`, \
                        optional `description`. Idempotent on path.\n\
                     2. **Scan a project** — `enqueue_dev_job` with `kind: \"scan_codebase\"` \
                        and `project_id` (or raw `params.path`). Returns instantly; result \
                        lands as a system episode (file count by language, top TODOs).\n\
                     3. **Capture decisions** — `write_goal`, `write_backlog_item`, \
                        `write_fact` ops let the lifecycle have memory.\n\n\
                     ### When to lean on this\n\n\
                     He's asking \"what should I work on next?\", \"what's stale?\", \
                     \"give me ideas\", \"how are things?\", or \"scan codebase\" / \
                     \"check projects\". Read the room; don't dump all flows. If he asks \
                     about a project that's never been scanned (look at the registry above \
                     — `never scanned`), proactively offer to enqueue a scan instead of \
                     saying you can't see it.\n\n\
                     ### Direct read paths (no ops)\n\n\
                     - **Doctrine block above** — you can already cite `features/personas/`, \
                       `features/execution/`, etc. for how the Personas app works.\n\
                     - **Observability digest above** — agent health, recent failures, \
                       open Human Reviews. Cite specifics; don't invent counts.\n\n",
                );
            }
            other => {
                // Forward-compat: an unknown plugin slug shouldn't break
                // the prompt. Surface it minimally so Michal sees it's
                // pinned, even if Athena can't yet act on it.
                s.push_str(&format!(
                    "## `{other}`\n\nThis plugin is enabled but its awareness block \
                     hasn't been wired yet — mention it if asked, otherwise ignore.\n\n",
                ));
            }
        }
    }
    s
}

/// Render the "Connector tools" block with concrete capabilities per
/// pinned connector. Empty when no pinned connectors are enabled.
/// For each enabled connector with a registered capability set, list
/// what Athena can actually do; for connectors without a registry
/// entry, surface the name + flag the wiring as in flight so she's
/// honest rather than inventing a method.
fn format_connectors(names: &[String]) -> String {
    if names.is_empty() {
        return String::new();
    }
    let mut s = String::from(
        "\n\n# Connector tools (the user has pinned these in your sidebar)\n\n",
    );
    s.push_str(
        "Each entry below is *active* — the user enabled it and you can \
         act on it via the `use_connector` op. Capabilities are \
         intent-shaped: emit the slug and args; the executor handles \
         the API call.\n\n\
         Format:\n\n\
         ```\n\
         OP: {\"op\": \"propose_action\", \"action\": \"use_connector\", \"params\": \
         {\"connector_name\": \"<slug>\", \"capability\": \"<capability_slug>\", \
         \"args\": {<arg_name>: <value>, ...}}, \"rationale\": \"<why now>\"}\n\
         ```\n\n\
         **`use_connector` auto-fires** — no approval card, no \
         click. The call goes straight to the background-job worker, \
         runs, and the result lands as a system episode you'll see on \
         your next turn. Set expectations in your reply (\"I'm pulling \
         the latest issues — back in a moment\") rather than waiting \
         for confirmation. Quote slugs exactly; the dispatcher rejects \
         hallucinated ones with a warning that surfaces in your next \
         turn's context.\n\n",
    );
    for n in names {
        match crate::companion::connectors::capabilities_for(n) {
            Some(caps) => {
                s.push_str(&format!("## `{n}`\n\n"));
                for c in caps {
                    s.push_str(&format!(
                        "- **{slug}** — {desc}  \n  _args: {args}_\n",
                        slug = c.slug,
                        desc = c.description,
                        args = c.args
                    ));
                }
                s.push('\n');
            }
            None => {
                s.push_str(&format!(
                    "## `{n}`\n\n\
                     Pinned but its capability set isn't registered yet. \
                     Acknowledge it (\"you have `{n}` attached\") but don't \
                     propose a `use_connector` call — wiring is in flight.\n\n",
                ));
            }
        }
    }
    s
}

fn compose(
    constitution: &str,
    identity: &str,
    observability_md: &str,
    recall: &Recall,
    plugins_md: &str,
    connectors_md: &str,
    onboarding_md: &str,
    voice_md: &str,
) -> String {
    let episodes_md = format_episodes(&recall.episodes);
    let doctrine_md = format_doctrine(&recall.doctrine);
    let facts_md = format_facts(&recall.facts);
    let goals_md = format_goals(&recall.goals);
    let procedurals_md = format_procedurals(&recall.procedurals);
    let backlog_md = format_backlog(&recall.backlog);

    let mut out = String::with_capacity(
        constitution.len()
            + identity.len()
            + observability_md.len()
            + episodes_md.len()
            + doctrine_md.len()
            + facts_md.len()
            + goals_md.len()
            + procedurals_md.len()
            + backlog_md.len()
            + onboarding_md.len()
            + voice_md.len()
            + 256,
    );
    out.push_str(constitution);
    if !identity.is_empty() {
        out.push_str("\n\n# Identity (live, evolves)\n\n");
        out.push_str(identity);
    }
    // Facts sit just below identity — enduring knowledge about *who*.
    // Goals + procedurals follow: who he's trying to be (goals) and
    // how she's agreed to behave (procedurals). All three are stable
    // context that should color every response, not retrieval-of-the-day.
    out.push_str(&facts_md);
    out.push_str(&goals_md);
    out.push_str(&procedurals_md);
    out.push_str(observability_md);
    out.push_str(&episodes_md);
    // Backlog sits near episodes — the open commitments are conversational,
    // tied to specific past turns; this is where Athena scans for "did I
    // promise to follow up on something?"
    out.push_str(&backlog_md);
    out.push_str(&doctrine_md);
    // Plugins block: capabilities Michal has toggled on for Athena
    // (currently just dev_tools). Sits between doctrine and connectors
    // because plugins are *internal* app capabilities — closer to
    // Athena's own toolkit than to external services.
    out.push_str(plugins_md);
    // Connectors block: which third-party tools the user has pinned
    // into the chat surface. Athena uses this to mention what she has
    // access to ("you have GitHub attached — want me to look at recent
    // commits?"). Empty string when none are pinned, so this adds zero
    // tokens to the typical prompt.
    out.push_str(connectors_md);
    // Onboarding sits at the very end so its instructions are the last
    // thing Athena reads before forming a reply — most recency-weighted.
    out.push_str(onboarding_md);
    // Voice addendum: only included when the user has voice playback on.
    out.push_str(voice_md);
    out
}

/// Voice addendum: only when the user toggled voice playback on. Tells
/// Athena to emit a TTS line in addition to her normal markdown reply.
/// Skipped entirely when voice is off so we don't waste tokens or
/// confuse Athena with capabilities she shouldn't use.
fn voice_addendum_if_needed(voice_enabled: bool) -> String {
    if !voice_enabled {
        return String::new();
    }
    String::from(
        r#"

# VOICE PLAYBACK — emit a TTS line this turn

Voice playback is on. Alongside your normal markdown reply, emit one
line that's safe to speak aloud — suitable for ElevenLabs synthesis.

Format (exactly one line, anywhere in the reply):

    TTS: "Two lab agents are failing. Want me to walk you through them?"

Discipline:

- Spoken text is a *different rendering* of the same content, not a
  transcription. Bullet lists, headings, code blocks, file paths,
  citations — none of them sound right read aloud.
- 1–3 sentences total. Headlines, not the full reply.
- First-person, conversational, no preamble. ("I see two failures, both
  in the lab — let me know if you want to dig in.")
- Plain English. No markdown, no parens, no lists, no code-style names.
  If you'd say "see ``persona-capabilities/00-vision.md``" in writing,
  speak it as "the vision doc."
- Never read out IDs, paths, or hashes verbatim — describe instead.
- Match the visual reply's tone but trim ruthlessly — if the written
  answer is one sentence, the spoken version is the same sentence
  cleaned of any formatting cruft.
- If the visual reply is purely a question or a chip-prompt, the TTS
  line can mirror it verbatim.
- One TTS line per turn. Don't emit if the visual reply has no
  meaningful spoken summary (rare; most replies do).
"#,
    )
}

/// Detect a fresh-install state (no prior conversation + identity.md is
/// still placeholder-shaped) and return a focused interview-mode addendum.
/// Empty string in normal operation.
fn onboarding_addendum_if_needed(identity: &str, episodes: &[episodic::Episode]) -> String {
    let no_episodes = episodes.is_empty();
    // Identity is "fresh" if it still contains the placeholder bullets we
    // seed it with. Once Athena writes a real identity (or the user edits
    // it), those markers disappear.
    let identity_is_placeholder = identity.contains("(seeded from intake interview)")
        || identity.contains("(rhythms, patterns, what flow looks like for him)");
    if !no_episodes || !identity_is_placeholder {
        return String::new();
    }
    String::from(
        r#"

# ONBOARDING MODE — first conversation

This is Michal's first conversation with you. His identity layer is still
just placeholders. Your job in this conversation is to run a real intake
interview that produces a foundation worth building on. Be present and
warm — this is the start of a long working relationship, not a form to
fill out.

The interview has five phases. Don't rush. One phase per turn unless he
asks you to move faster.

1. **Orientation** (1 turn) — introduce yourself briefly. Be honest about
   what you are and how the relationship works (the constitution is your
   reference, you have a brain that grows over time, every fact you'll
   remember about him will be cited). Then ask what he'd like to be
   called and what's on his mind today.
2. **His work** (2-3 turns) — what is he building. Who for. What does
   "shipping" look like. What's the *current* phase. Don't accept vague
   answers; press gently for specifics. The texture matters more than
   the bullet points.
3. **His patterns** (2-3 turns) — when does he ship vs. stall. What kind
   of nudge helps when he's stuck. What *doesn't* help (the things that
   feel patronizing or generic). When does he go to sleep.
4. **Boundaries** (1-2 turns) — anything off-limits to discuss; quiet
   hours for proactive nudges; how he wants the "execute with approval"
   flow to feel for him specifically (more pre-amble or less; cite IDs
   or describe in prose).
5. **Identity draft** (1 turn) — synthesize what you heard into a fresh
   identity.md. Show him the draft *in your reply* (in plain markdown,
   not a code block) and emit:

       OP: {"op": "propose_action", "action": "update_identity", "params": {"content": "<the full new identity.md content>"}, "rationale": "first-pass identity from our intake — please review and approve"}

   The approval card lets him review and approve the write. If he wants
   changes, iterate before approving.

Do NOT emit propose_action for any other action during onboarding —
keep this conversation focused on the interview itself.
"#,
    )
}
