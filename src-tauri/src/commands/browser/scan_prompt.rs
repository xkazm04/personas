//! The controllability scan's prompt (spark `browser-control`, WP3).
//!
//! One question, asked of a headless Claude turn that holds the browser
//! bridge and nothing else: **how far can an agent drive this site, and what
//! stops it?** The answer is one JSON object per line, `{"site_finding": …}`,
//! matching `BrowserSiteScan` (`personas_core::models::browser`) — the same
//! shape `browser_sites.scan_report` stores and `src/features/browser/types.ts`
//! renders.
//!
//! Two things this prompt is written against, both learned from the scan
//! precedents in this repo:
//!
//! 1. **The scan must not write.** The session it holds is registered under
//!    `Principal::Session("scan:<origin>")` with `AllowPolicy::Whitelist`, and
//!    the gate classes every `browser_*` write as `Gated`, so a write would be
//!    filed as an approval rather than performed. **`AllowPolicy` has no
//!    read-only lane** — WP1 shipped two arms, `Pinned` and `Whitelist`, and
//!    neither is "reads only" — so the prompt states the prohibition
//!    explicitly AND the gate catches an attempt. Both, because a prompt is a
//!    request and a gate is a rule; see the WP3 report's counter-proposal for
//!    the third arm.
//! 2. **The answer is data, not prose.** `kpi_scan.rs` learned that the CLI's
//!    verbose stream delivers each turn twice (a JSON event and a plain-text
//!    line), so the parser keys on a marker (`"site_finding"`) and the scan
//!    takes the LAST well-formed object rather than every one it sees.

/// Build the controllability-scan prompt for one origin.
///
/// `label` is the operator's own name for the site; `tier_hint` carries what
/// a previous scan concluded, so a re-scan can disagree with itself
/// deliberately rather than by forgetting.
pub(crate) fn build_scan_prompt(origin: &str, label: &str, tier_hint: Option<u8>) -> String {
    let previous = match tier_hint {
        Some(t) => format!(
            "\nA previous scan graded this site **tier {t}**. Disagree with it if the page has \
             changed — but say so in `notes` rather than silently re-grading.\n"
        ),
        None => String::new(),
    };
    format!(
        r#"You are surveying ONE website to answer a single question: how far can a software agent drive it, and what stops it?

Site: {label} ({origin})
{previous}
You have exactly one toolset — the `browser_*` tools on the `browser` MCP server. They are the only way to see the page. There is no shell, no fetch, no file access.

## The one rule

**READ ONLY.** Navigate, snapshot, list the page's tools, read the console, wait for text. Do NOT click, type, select, submit, or call a page tool. This is a survey of a stranger's site on the operator's own logged-in machine: a click here is a real click on a real account. The gate will refuse a write and file it as an approval the operator has to dismiss, so an attempt costs them a click and tells you nothing.

If you cannot answer something without acting, that is a FINDING — record it as a blocker, do not act.

## What to do

1. `browser_navigate` to {origin}.
2. `browser_snapshot` the landing page. Note the landmarks (the page's structural regions: `main`, `nav`, `search`, a named table, a dashboard).
3. `browser_page_tools` — does the page declare its own tools (WebMCP, native or polyfill)? Most sites do not; "none" is the normal answer and is not a failure.
4. Count the OPERABLE elements a generic agent could drive: buttons, links, inputs, selects that a snapshot gives a stable ref for. An estimate to the nearest ten is fine; say so in `notes`.
5. Identify the forms. For each: a name a human would use, how many fields, and its kind (`login`, `search`, `payment`, `other`).
6. If there is a sign-in form, record its three refs — the username field, the password field, and the submit control — EXACTLY as the snapshot spells them. Personas fills those refs from the vault later; a wrong ref means a credential typed into the wrong box.
7. Note what would stop an agent: a CAPTCHA, a login wall in front of everything, a Content-Security-Policy or frozen globals that make the page read as zero tools.

## Grading (`tier`)

- **0** — read-only. You can see the page but nothing can be driven: no stable refs, a hard login wall, or a CAPTCHA at the door.
- **1** — generic hands. The page has stable refs and ordinary controls; an agent can click and type its way through it.
- **2** — the page declares its OWN tools (WebMCP), so an agent can call intent-shaped operations instead of pushing pixels.

Tier 2 requires page tools you actually saw listed. Do not grade up because a site "looks modern".

## The answer

Emit ONE line, exactly this shape, and nothing after it:

{{"site_finding": {{"transport": "none", "page_tools": [], "operable_count": 0, "landmarks": [], "forms": [], "login_form": null, "blockers": [], "tier": 0, "notes": ""}}}}

Field contracts:
- `transport`: `"webmcp-native"` | `"webmcp-polyfill"` | `"none"`.
- `page_tools`: `[{{"name": "", "description": "", "reversible": false, "side_effects": "none"|"internal"|"external", "class": "read"|"auto"|"gated"}}]`. Report `reversible` and `side_effects` as the page's OWN manifest declares them; do not infer them from the name. Set `class` to `"gated"` unless the manifest proves `reversible` and non-external.
- `operable_count`: an integer.
- `landmarks`: short strings, at most 12.
- `forms`: `[{{"name": "", "fields": 0, "kind": "login"|"search"|"payment"|"other"}}]`.
- `login_form`: `null`, or `{{"user_ref": "", "pass_ref": "", "submit_ref": ""}}` with the refs verbatim from a snapshot.
- `blockers`: any of `"captcha"`, `"login_wall"`, `"csp_frozen_globals"`.
- `tier`: 0, 1 or 2.
- `notes`: one or two sentences for the operator — what you could not see, what you estimated, what you would want to re-check. Never a credential, never a personal detail you read on the page.

Write the line ONCE, at the end. If the site refuses to load, emit the line anyway with `tier: 0` and the reason in `notes` — a scan that reports nothing is indistinguishable from a scan that never ran."#
    )
}

/// The marker a `site_finding` line carries. Keyed on rather than parsed
/// blindly because the CLI's verbose stream delivers each turn twice.
pub(crate) const FINDING_MARKER: &str = "\"site_finding\"";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_states_the_read_only_rule_and_the_answer_shape() {
        let p = build_scan_prompt("https://x.example", "X", None);
        assert!(p.contains("READ ONLY"));
        assert!(p.contains(FINDING_MARKER));
        assert!(p.contains("https://x.example"));
        assert!(
            !p.contains("A previous scan"),
            "no tier hint means no re-scan paragraph"
        );
        let p = build_scan_prompt("https://x.example", "X", Some(2));
        assert!(p.contains("tier 2"));
    }

    /// The emitted example must itself parse as the type the scan stores, or
    /// the prompt is teaching a shape the repo cannot accept. This is the
    /// tripwire that catches a field rename on the Rust side.
    #[test]
    fn the_example_answer_parses_as_a_browser_site_scan() {
        let p = build_scan_prompt("https://x.example", "X", None);
        // Line-oriented on purpose: the prompt TELLS the model to emit the
        // answer as one line, so finding it the way the parser does — by the
        // marker, over whole lines — is the same question the runtime asks.
        // (A backward brace scan would also trip the census rule that exists
        // to stop hand-rolled envelope extraction spreading.)
        let line = p
            .lines()
            .find(|l| l.contains(FINDING_MARKER) && l.trim_start().starts_with('{'))
            .expect("the prompt carries its example answer on one line");
        assert!(
            super::super::sites::parse_site_finding(line).is_some(),
            "the prompt's own example must round-trip into BrowserSiteScan: {line}"
        );
    }
}
