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

/// Flagged credentials the always-on block carries before it truncates. A
/// vault where more than this many grants died at once is an incident, not a
/// list to read out — the truncation line says so and `reconnect_credential`
/// still works one at a time.
const REAUTH_PROMPT_ROWS: usize = 8;

/// Credentials the app has flagged as needing re-authorization, as an
/// always-on block.
///
/// **Why the prompt and not a read op.** A revoked grant is the one credential
/// state Athena may act on (`reconnect_credential`), and it is invisible from
/// the conversation: the user does not say "my Google token was revoked", they
/// say "why did the invoice trigger stop firing". Without this block the honest
/// answer requires a lookup she has no reason to make, so she guesses at the
/// cause — and the actual cause is sitting one row away.
///
/// Carries the bound account per row, because the whole failure mode a
/// reconnect can introduce is rebinding to a DIFFERENT account, and the only
/// defence is naming the right one out loud before the operator clicks.
///
/// Empty string when nothing is flagged — which is the usual case, and a header
/// over nothing is prompt tax paid on every turn.
pub(super) fn format_flagged_credentials(sys_db: &DbPool) -> String {
    let creds = match crate::db::repos::resources::credentials::get_all(sys_db) {
        Ok(c) => c,
        // A read failure is NOT "nothing is flagged": those are different facts
        // and only one of them means "do not propose a reconnect". Log and omit.
        Err(e) => {
            tracing::warn!(error = %e, "prompt: credential read failed; re-auth block omitted");
            return String::new();
        }
    };

    let flagged: Vec<(String, String, String, Option<String>)> = creds
        .iter()
        .filter_map(|c| {
            let ledger = personas_core::models::CredentialLedger::parse(c.metadata.as_deref());
            if ledger.needs_reauth != Some(true) {
                return None;
            }
            let account = ledger
                .to_value()
                .get("account_email")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned);
            Some((
                c.id.clone(),
                c.name.clone(),
                c.service_type.clone(),
                account,
            ))
        })
        .collect();
    if flagged.is_empty() {
        return String::new();
    }

    let total = flagged.len();
    let mut s = String::from("\n\n# Credentials that need re-authorization\n\n");
    s.push_str(
        "These grants are revoked or expired. Only the operator can re-consent — propose \
         `reconnect_credential` with the id below, name the bound account, and say what \
         stopped working. Never propose it for a credential that is not on this list.\n\n",
    );
    for (id, name, service, account) in flagged.iter().take(REAUTH_PROMPT_ROWS) {
        s.push_str(&format!(
            "- **{name}** ({service}) — `{id}`{}\n",
            match account {
                Some(a) => format!(", bound to {a}"),
                None => ", bound account not recorded".to_string(),
            }
        ));
    }
    if total > REAUTH_PROMPT_ROWS {
        s.push_str(&format!("\n(showing {REAUTH_PROMPT_ROWS} of {total})\n"));
    }
    s
}

/// Rows of the Whitelist the always-on prompt block carries. Past this it
/// truncates and says so — the same honest-truncation rule every bounded
/// index in this prompt follows.
const WHITELIST_PROMPT_ROWS: usize = 10;

/// The browser Whitelist, as the always-on block that teaches Athena what she
/// can actually reach (spark `browser-control`, WP3).
///
/// **Why this is in the prompt at all, when `browser_status` exists.** The
/// read op answers in detail on demand; this block answers the ONE question
/// she needs before she opens her mouth — is there a browser lane here at
/// all, and which sites are in it. Without it, the honest move on "can you
/// check my invoices" is a lookup she has no reason to make, so she guesses,
/// and the guess is either a refused proposal or a flat "I can't do that"
/// about a site the operator whitelisted weeks ago.
///
/// Empty string when the table is empty — a header over nothing is prompt
/// tax, and "no sites" is exactly what the absence of the section says.
pub(super) fn format_browser_whitelist(sys_db: &DbPool) -> String {
    let sites = match crate::db::repos::browser::sites::list(sys_db) {
        Ok(s) if !s.is_empty() => s,
        // A read failure is NOT reported as "no sites": the two are different
        // facts and only one of them means "do not propose a browser action".
        // It is logged and the block is omitted, so `browser_status` (which
        // says so out loud) stays the only place that answers the question.
        Ok(_) => return String::new(),
        Err(e) => {
            tracing::warn!(error = %e, "prompt: browser whitelist read failed; block omitted");
            return String::new();
        }
    };

    let total = sites.len();
    let mut s = String::from("\n\n# Browser Whitelist (the pages you may reach)\n\n");
    s.push_str(
        "Reading and navigating inside these origins auto-fires. Every WRITE — click, type, \
         select, submit, a page's own tool — is a `browser_act` approval the operator decides \
         on the orb. A page not listed here does not exist to you: ask once with \
         `browser_request_site`, never work around it. Call `browser_status` for leases, \
         budgets and which backend is up.\n\n",
    );
    for site in sites.iter().take(WHITELIST_PROMPT_ROWS) {
        s.push_str(&format!(
            "- `{}` — {}, tier {}{}\n",
            site.origin,
            if site.enabled { "enabled" } else { "PAUSED" },
            site.scan_tier
                .map(|t| t.to_string())
                .unwrap_or_else(|| "unscanned".into()),
            if site.credential_id.is_some() {
                ", credential bound (`browser_login` can sign in)"
            } else {
                ""
            }
        ));
    }
    if total > WHITELIST_PROMPT_ROWS {
        s.push_str(&format!("\n(showing {WHITELIST_PROMPT_ROWS} of {total})\n"));
    }
    s
}

/// The focused Browser page, as the dynamic block a chat turn carries
/// (athena-browser-react). Empty string when there is no capture — which is
/// every turn where the Browser is closed, no tab is focused, or the page did
/// not answer in time — so the block's ABSENCE is the signal "nothing is
/// open", and the constitution teaches her not to guess a page from it.
///
/// The cut is stated in words, once, above the text: the composer counts
/// this block by the char, and a model reading it needs to know the page may
/// hold more than the capture before it claims to have read all of it.
pub(super) fn format_browser_page(
    page: Option<&crate::browser_bridge::webview::PageCapture>,
) -> String {
    let Some(page) = page else {
        return String::new();
    };
    let mut s = String::from("\n\n# What you are looking at (Browser)\n\n");
    s.push_str(&format!("URL: {}\n", page.url));
    s.push_str(&format!(
        "Title: {}\n",
        if page.title.is_empty() {
            "(untitled)"
        } else {
            page.title.as_str()
        }
    ));
    s.push_str(&format!(
        "Captured visible text ({} chars, truncated: {}); the page may hold more than this capture.\n\n",
        page.text.chars().count(),
        if page.truncated { "yes" } else { "no" }
    ));
    s.push_str(&page.text);
    s.push('\n');
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
