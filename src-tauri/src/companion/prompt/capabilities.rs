//! What Athena can reach: the real Dev Tools registry, the enabled plugins,
//! and the wired connectors.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use crate::db::DbPool;

/// Active goals — short list, sorted by priority. Athena should glance
/// at this before responding so she doesn't lose track of what the
/// user said they're working toward. NOT cited the way facts are —
/// goals are ongoing, not historical claims.
/// Goals hub: inject the dev projects' goals + latest progress signal so Athena
/// The REAL Dev Tools registry (`dev_projects`, execution store) shaped for the
/// prompt's dev-tools block. Sources from `sys_db` — the SAME rows
/// `enqueue_dev_job` scans against — so what Athena sees matches what she acts
/// on. Previously the block read `companion_known_project` (brain DB), which
/// had drifted to worktree/duplicate registrations unrelated to the Dev Tools
/// projects the user actually manages — so she'd "analyze" a registry that
/// bore no relation to reality. Scan recency comes from the latest `dev_scans`
/// row per project.
pub(super) fn dev_tools_registry_for_prompt(
    sys_db: &DbPool,
) -> Vec<crate::companion::projects::KnownProject> {
    use crate::companion::projects::KnownProject;
    use crate::db::repos::dev_tools as dt;
    let projects = match dt::list_projects(sys_db, None) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    projects
        .into_iter()
        .map(|p| {
            let latest = dt::list_scans(sys_db, Some(p.id.as_str()), Some(1))
                .ok()
                .and_then(|s| s.into_iter().next());
            let (last_scan_at, last_scan_summary) = match latest {
                Some(s) => (
                    Some(s.created_at),
                    Some(format!("{} scan, {} ideas", s.scan_type, s.idea_count)),
                ),
                None => (None, None),
            };
            KnownProject {
                id: p.id,
                name: p.name,
                path: p.root_path,
                description: p.description,
                last_scan_at,
                last_scan_summary,
                created_at: String::new(),
                updated_at: String::new(),
            }
        })
        .collect()
}

/// Render the "Plugins enabled" block. Each enabled plugin gets its
/// own awareness section so Athena knows what she can lean on. Plugins
/// are *internal* app capabilities — separate from connectors which
/// are external credentials. Empty when no plugins are toggled on.
///
/// `projects` is forwarded into the dev_tools block so Athena always
/// sees the live project registry (with their scan status) — passed
/// in rather than read here so the function stays sync + testable.
///
/// `tracking_pulses` carries today's per-project pulse blocks
/// (rendered Markdown). Empty unless the project_tracking master
/// toggle is on AND `dev_tools` is among `enabled`. Phase 5 wires
/// this; before then it's always empty.
pub(super) fn format_plugins(
    enabled: &[String],
    projects: &[crate::companion::projects::KnownProject],
    tracking_pulses: &str,
) -> String {
    if enabled.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Plugins enabled (capabilities the user has turned on for you)\n\n");
    for name in enabled {
        match name.as_str() {
            "dev_tools" => {
                s.push_str(
                    "## Dev Tools\n\n\
                     The user has the **Dev Tools plugin** enabled. They want you to lead \
                     the product-development lifecycle of their projects.\n\n\
                     ### Registered projects\n\n",
                );
                if projects.is_empty() {
                    s.push_str(
                        "_No projects registered yet._ If they ask you about a project, \
                         offer to register it with `register_project` (you need a \
                         filesystem path + a short name). Registering also creates the \
                         Dev Tools project + codebase connector and kicks off a context \
                         scan, so a team can be adopted for that repo right after.\n\n",
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

                if !tracking_pulses.is_empty() {
                    s.push_str("### Today's project pulses\n\n");
                    s.push_str(tracking_pulses);
                    s.push_str(
                        "\n_These pulses are produced once an hour by the project-tracking \
                         consolidator (Sonnet 4.6) over git commits and the active-runs \
                         ledger. When the user asks 'what's happening on X' or 'what's drifting', \
                         lean on these directions and tensions; cite specifics, don't invent. \
                         For deeper drill-in (recent commits behind a direction), say so and \
                         offer to dig — don't fabricate hashes._\n\n",
                    );
                }

                s.push_str(
                    "### Available actions\n\n\
                     **Long-running scans run as background jobs** — you don't block the \
                     chat waiting for them. The worker picks queued jobs up within a few \
                     seconds, runs them, and appends a system episode with the result so \
                     you see it on your next turn. Tell the user that explicitly when you \
                     enqueue (\"I started the scan, will report back; what else?\").\n\n\
                     1. **Set up a project** — `register_project` with `name`, `path`, \
                        optional `description`. Idempotent on path. This creates the real \
                        Dev Tools project (a `dev_projects` row), which is what makes the \
                        **codebase connector** available to any team adopted for that repo, \
                        AND auto-starts a full context scan (Claude maps its structure in \
                        the background). One action = repo ready for a team. To set up \
                        several repos, call it once per path.\n\
                     2. **Scan / re-scan a project (context map)** — `enqueue_dev_job` with \
                        `kind: \"scan_codebase\"` and `project_id` (or `params.path` / \
                        `params.project_name`). This runs the REAL context scan: Claude maps \
                        the repo into business-domain groups + per-feature contexts \
                        (dev_context_groups / dev_contexts). Use it whenever the user says \
                        \"scan\", \"context scan\", \"map\", \"index\", or \"analyze the \
                        codebase\" — for a fresh repo OR to refresh one whose code changed.\n\
                     3. **Capture decisions** — `write_goal`, `write_backlog_item`, \
                        `write_fact` ops let the lifecycle have memory.\n\n\
                     ### CRITICAL — scan ≠ build an agent\n\n\
                     \"Scan / context-scan / map / index / analyze the codebase\" is a \
                     **context scan** (action #2 above) — it reads code structure and changes \
                     NOTHING. Do NOT respond to a scan request with `build_oneshot`, \
                     `prefill_persona_create`, or by proposing a new reviewer/triage agent. \
                     `build_oneshot` is ONLY for an explicit \"build / create / spin up an \
                     agent (or team) that …\" request. If the user asks to scan a repo \"for \
                     bugs and tests\", that is STILL a context scan (action #2) — the existing \
                     SDLC team's Code Reviewer / QA handles bug-and-test review, so mention \
                     that team rather than building a new agent.\n\n\
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
                // the prompt. Surface it minimally so the user sees it's
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
pub(super) fn format_connectors(names: &[String]) -> String {
    if names.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Connector tools (the user has pinned these in your sidebar)\n\n");
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

// ── Per-block size ledger ───────────────────────────────────────────────
//
// Prompt assembly had zero size accounting until 2026-08. The dev-mode
// context index silently grew to ~30.6KB injected on EVERY turn and was
// caught by accident (rolled up to group level in 12651a18c). A block that
// grows without anyone noticing is a permanent, invisible tax on every
// Athena turn, so compose() now reports what each named block cost and
// warns when one breaches its budget.
