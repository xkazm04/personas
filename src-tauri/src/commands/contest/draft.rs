//! "Draft with Athena" (experimental): one metered one-shot call that turns an
//! idea into the five brief sections, quoting the top patterns of the
//! project's contest ledger (`<vault>/<subdir>/Patterns.md`) when there is one.

use std::path::Path;
use std::time::Duration;

use crate::companion::brain::oneshot;
use crate::companion::model_routing;
use crate::db::UserDbPool;
use crate::error::AppError;

use super::node;

/// The ledger tag of this leg (`companion_turn.trigger_kind`).
const LEG_CONTEST_BRIEF: &str = "contest_brief";
/// The call's absolute ceiling (the IPC wrapper waits 180 s).
const DRAFT_BACKSTOP: Duration = Duration::from_secs(150);
const MAX_PATTERNS: usize = 5;
const MAX_IDEA_CHARS: usize = 4000;

/// One pattern of `Patterns.md` (the instrument's `readPatterns`).
#[derive(Debug, Clone, PartialEq)]
pub struct Pattern {
    pub slug: String,
    pub statement: String,
    pub wins: u32,
    pub seen: u32,
}

/// Port of `readPatterns`: every `## <slug>` section, its first plain line as
/// the statement, `wins: n` / `seen: n` counters; sorted by wins, seen, slug.
pub fn read_patterns(text: &str) -> Vec<Pattern> {
    let text = format!("\n{}", text.replace("\r\n", "\n"));
    let mut out = Vec::new();
    for block in text.split("\n## ").skip(1) {
        let mut lines = block.lines();
        let slug = lines.next().unwrap_or("").trim().to_string();
        if slug.is_empty() {
            continue;
        }
        let body: Vec<&str> = lines.collect();
        let counter = |name: &str| {
            body.iter()
                .find_map(|l| l.strip_prefix(&format!("{name}: ")))
                .and_then(|n| n.trim().parse::<u32>().ok())
                .unwrap_or(0)
        };
        let statement = body
            .iter()
            .map(|l| l.trim())
            .find(|l| {
                !l.is_empty()
                    && !l.starts_with("wins:")
                    && !l.starts_with("seen:")
                    && !l.starts_with("- ")
            })
            .unwrap_or("")
            .to_string();
        out.push(Pattern {
            slug,
            statement,
            wins: counter("wins"),
            seen: counter("seen"),
        });
    }
    out.sort_by(|a, b| {
        b.wins
            .cmp(&a.wins)
            .then(b.seen.cmp(&a.seen))
            .then(a.slug.cmp(&b.slug))
    });
    out
}

pub fn build_prompt(idea: &str, patterns: &[Pattern]) -> String {
    let mut p = String::from(
        "You are drafting the brief for a blind design contest between AI coding agents. \
         Each participant reads this brief and builds several self-contained HTML/CSS/JS \
         prototypes of the idea. Write the brief in markdown with EXACTLY these five \
         sections, in this order, and nothing before or after them:\n\n\
         ## The idea\n## The material\n## The wow\n## Freedoms\n## Hard constraints\n\n\
         The idea: what is being built and for whom, in a few sentences. The material: the \
         data or content the prototypes must work with. The wow: what would make a variant \
         memorable. Freedoms: what participants may reinterpret. Hard constraints: what a \
         variant must never break. Be concrete and brief; no preamble, no code fences.\n\n",
    );
    if !patterns.is_empty() {
        p.push_str(
            "Earlier contests in this project named these philosophies in winning work. \
             Quote the relevant ones inside the brief as a floor, not a recipe:\n",
        );
        for pat in patterns {
            p.push_str(&format!(
                "- **{}** (won {}, seen {}): {}\n",
                pat.slug, pat.wins, pat.seen, pat.statement
            ));
        }
        p.push('\n');
    }
    p.push_str("The owner's idea, verbatim:\n\n");
    p.push_str(idea);
    p.push('\n');
    p
}

/// Strip a wrapping code fence the model may add despite the instruction.
pub fn clean_draft(text: &str) -> String {
    let t = text.trim();
    let t = t
        .strip_prefix("```markdown")
        .or_else(|| t.strip_prefix("```md"))
        .or_else(|| t.strip_prefix("```"))
        .map(|rest| rest.trim_end().strip_suffix("```").unwrap_or(rest))
        .unwrap_or(t);
    t.trim().to_string()
}

pub async fn draft(
    user_db: &UserDbPool,
    project_root: &Path,
    idea: &str,
) -> Result<String, AppError> {
    personas_core::validation::require_non_empty("idea", idea)?;
    let idea = idea.trim();
    let idea: String = idea.chars().take(MAX_IDEA_CHARS).collect();
    let (vault, subdir) = node::resolve_vault(project_root);
    let patterns = std::fs::read_to_string(vault.join(&subdir).join("Patterns.md"))
        .map(|t| read_patterns(&t))
        .unwrap_or_default();
    let top: Vec<Pattern> = patterns.into_iter().take(MAX_PATTERNS).collect();
    let prompt = build_prompt(&idea, &top);
    let text = oneshot::call_claude_text(
        user_db,
        &prompt,
        model_routing::ASIDE.model,
        LEG_CONTEST_BRIEF,
        DRAFT_BACKSTOP,
    )
    .await?;
    let brief = clean_draft(&text);
    if brief.is_empty() {
        return Err(AppError::Internal(
            "contest brief draft: Athena returned an empty draft".into(),
        ));
    }
    Ok(brief)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_pattern_ledger_like_the_instrument() {
        let md = "# Patterns\n\n## layered-centre\nA simple centre with detail one layer down.\nwins: 2\nseen: 3\n- contest-a\n\n## keyboard-first\n\nEvery action has a key.\nwins: 0\nseen: 4\n\n## loud\nwins: 2\nseen: 5\nBig type.\n";
        let p = read_patterns(md);
        assert_eq!(
            p.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(),
            vec!["loud", "layered-centre", "keyboard-first"]
        );
        assert_eq!(
            p[1].statement,
            "A simple centre with detail one layer down."
        );
        assert_eq!(p[0].statement, "Big type.");
        assert_eq!(p[2].wins, 0);
        assert!(read_patterns("").is_empty());
    }

    #[test]
    fn the_prompt_names_the_five_sections_and_quotes_patterns() {
        let pats = vec![Pattern {
            slug: "calm".into(),
            statement: "Quiet chrome.".into(),
            wins: 1,
            seen: 1,
        }];
        let p = build_prompt("A radio for agents", &pats);
        for h in [
            "## The idea",
            "## The material",
            "## The wow",
            "## Freedoms",
            "## Hard constraints",
        ] {
            assert!(p.contains(h), "{h}");
        }
        assert!(p.contains("**calm** (won 1, seen 1): Quiet chrome."));
        assert!(p.ends_with("A radio for agents\n"));
        assert!(!build_prompt("x", &[]).contains("philosophies"));
    }

    #[test]
    fn clean_draft_strips_a_wrapping_fence() {
        assert_eq!(
            clean_draft("```markdown\n## The idea\nx\n```"),
            "## The idea\nx"
        );
        assert_eq!(clean_draft("  ## The idea\n"), "## The idea");
    }
}
