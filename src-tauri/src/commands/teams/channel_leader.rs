//! Team-channel LEADER: the member who routes work the user did not address.
//!
//! Before this module a mention-free directive in the team channel became a
//! whole-team `consumer='inject'` row that waited for the next step boundary
//! (an idle team answered nothing), and a persona's channel reply was
//! display-only — a member could not hand work to a teammate. The team schema
//! already carried pipeline-position roles (`orchestrator` / `router`) that
//! no runtime behaviour consumed.
//!
//! The squad protocol adopted here (multica `squad_briefing.go`, `/research`
//! 2026-09-05): the leader is woken FIRST and ALONE, reads the directive with
//! a roster it can address by exact `@Name`, delegates by mention, stops after
//! dispatching, and leaves a typed verdict every turn — so a silent no-op is a
//! recorded decision, not a missing reply. Everything that touches the summon
//! machinery (spawning executions, inserting replies, delegating from replies)
//! stays in `team_channel.rs`; this module is the leader's data and prose:
//! who the leader is, what it is told, and how its verdict is read back.

use rusqlite::{params, OptionalExtension};

use crate::db::DbPool;
use crate::error::AppError;

/// Pipeline-position roles (`persona_team_members.role`) that make a member
/// the channel leader. `orchestrator` is the natural fit; `router` is the
/// schema's other dispatch-shaped role and is accepted so a team that named
/// its dispatcher that way gets the behaviour without a migration.
pub(crate) const LEADER_PIPELINE_ROLES: &[&str] = &["orchestrator", "router"];

/// Event type carrying a leader's per-turn evaluation record. Registered in
/// `event_vocabulary.rs` (never listener-matched — informational).
pub(crate) const LEADER_VERDICT_EVENT: &str = "team.channel.leader_verdict";

/// The line a leader must end its reply with. Parsed by [`parse_leader_verdict`].
pub(crate) const VERDICT_MARKER: &str = "VERDICT:";

/// Typed outcome of one leader turn. The values are the wire/DB tokens; a
/// leader that ends without the marker is recorded as `unstated`, which is a
/// finding about the leader, never a success.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeaderVerdict {
    /// Delegated (or, when the roster had nobody suitable, acted itself).
    Action,
    /// Evaluated and decided nothing is needed.
    NoAction,
    /// Hit an error and could not evaluate.
    Failed,
    /// No `VERDICT:` line in the reply.
    Unstated,
}

impl LeaderVerdict {
    pub(crate) fn token(self) -> &'static str {
        match self {
            Self::Action => "action",
            Self::NoAction => "no_action",
            Self::Failed => "failed",
            Self::Unstated => "unstated",
        }
    }
}

/// The resolved channel leader of a team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChannelLeader {
    pub(crate) persona_id: String,
    pub(crate) name: String,
}

/// Resolve the team's channel leader: the first ENABLED member whose
/// pipeline-position role is in [`LEADER_PIPELINE_ROLES`], oldest membership
/// first so the pick is stable across ticks. `None` means the team has no
/// leader and mention-free directives keep the whole-team inject path.
pub(crate) fn channel_leader(
    pool: &DbPool,
    team_id: &str,
) -> Result<Option<ChannelLeader>, AppError> {
    let conn = pool.get()?;
    // The role list is a compile-time constant of plain identifiers, so
    // splicing it as quoted literals is the single-source-of-truth choice, not
    // an injection surface.
    let roles = LEADER_PIPELINE_ROLES
        .iter()
        .map(|r| format!("'{r}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut stmt = conn.prepare(&format!(
        "SELECT p.id, p.name
         FROM persona_team_members ptm
         JOIN personas p ON p.id = ptm.persona_id
         WHERE ptm.team_id = ?1
           AND p.enabled = 1
           AND ptm.role IN ({roles})
         ORDER BY ptm.created_at ASC, ptm.id ASC
         LIMIT 1"
    ))?;
    let leader = stmt
        .query_row(params![team_id], |r| {
            Ok(ChannelLeader {
                persona_id: r.get::<_, String>(0)?,
                name: r.get::<_, String>(1)?,
            })
        })
        .optional()
        .map_err(AppError::Database)?;
    Ok(leader)
}

/// One roster row as the briefing renders it.
#[derive(Debug, Clone)]
pub(crate) struct RosterMember {
    pub(crate) name: String,
    pub(crate) role: String,
    pub(crate) capability: String,
}

/// The leader's addressable roster: every OTHER enabled member, with the
/// semantic role (`preset_role` from `config`, falling back to the pipeline
/// role) and the headline capability `team_context` already derives for the
/// alignment block — the leader delegates by capability, not by guessing
/// from a name.
pub(crate) fn leader_roster(
    pool: &DbPool,
    team_id: &str,
    leader_persona_id: &str,
) -> Result<Vec<RosterMember>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, ptm.role, ptm.config, p.design_context, p.description
         FROM persona_team_members ptm
         JOIN personas p ON p.id = ptm.persona_id
         WHERE ptm.team_id = ?1 AND p.enabled = 1
         ORDER BY ptm.created_at ASC, ptm.id ASC",
    )?;
    let rows = stmt
        .query_map(params![team_id], |r| {
            let id: String = r.get(0)?;
            let name: String = r.get(1)?;
            let role: String = r.get(2)?;
            let config: Option<String> = r.get(3)?;
            let design_context: Option<String> = r.get(4)?;
            let description: Option<String> = r.get(5)?;
            Ok((id, name, role, config, design_context, description))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)?;
    Ok(rows
        .into_iter()
        .filter(|(id, ..)| id != leader_persona_id)
        .map(|(_, name, role, config, dc, desc)| RosterMember {
            name,
            role: crate::engine::team_preset_adopter::member_semantic_role(
                config.as_deref(),
                &role,
            ),
            capability: crate::engine::runner::team_context::top_capability(
                dc.as_deref(),
                desc.as_deref(),
            ),
        })
        .collect())
}

/// Leader-only routing rules the operator stored on the team. Read from
/// `persona_teams.team_config` JSON under `leader_instructions`; distinct from
/// `shared_instructions`, which every member already receives through the
/// alignment block. Empty string when absent.
pub(crate) fn leader_instructions(pool: &DbPool, team_id: &str) -> String {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let raw: Option<String> = conn
        .query_row(
            "SELECT team_config FROM persona_teams WHERE id = ?1",
            params![team_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten();
    raw.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| {
            v.get("leader_instructions")
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_default()
}

/// Render the briefing appended to a leader's summon: the operating protocol
/// (constant), the roster (data, with the exact `@Name` tokens the summon
/// matcher accepts), and the operator's leader-only instructions (omitted
/// when empty so no dangling heading).
///
/// The protocol is prose the model reads on every leader turn, so it says
/// what to do and nothing addressed to maintainers.
pub(crate) fn render_leader_briefing(
    leader: &ChannelLeader,
    roster: &[RosterMember],
    instructions: &str,
    delegation_depth: u8,
    max_depth: u8,
) -> String {
    let mut out = String::with_capacity(2048);
    out.push_str("## Channel Leader Protocol\n\n");
    out.push_str(&format!(
        "You are **{}**, the LEADER of this team's channel. This message reached you because \
         nobody was addressed by name, so routing it is your job. Your job is to **coordinate**, \
         not to do the work yourself — even when the request reads like a direct task.\n\n",
        leader.name
    ));
    out.push_str(
        "1. **Read the directive** and the recent channel history, then decide which member is \
         best suited. Match the work to each member's role and capability in the roster below.\n\
         2. **Delegate by mention.** Reply with ONE short message that names the chosen member(s) \
         using the exact `@Name` token from the roster (a plain name without `@` triggers nobody) \
         and says only what they cannot infer: who, why them in one clause, and any extra \
         constraint or sequencing. Do not restate the directive — they read it themselves.\n\
         3. **Stop after dispatching.** Do not start the work, open files, or run tools beyond \
         what deciding needs. You are woken again when a delegated member replies without \
         addressing anyone, or when someone mentions you.\n\
         4. **Re-evaluate on each wake.** Decide whether to delegate the next step, escalate to \
         the user, or do nothing. Doing nothing is a legitimate outcome — record it and say \
         nothing else.\n\
         5. **Only if the roster has nobody suitable**, say so plainly (and do the work yourself \
         only when it is small and clearly yours).\n\
         6. **End every reply with exactly one verdict line**, as the LAST line:\n\
         `VERDICT: action — <one short reason>` when you delegated or acted,\n\
         `VERDICT: no_action — <one short reason>` when nothing is needed,\n\
         `VERDICT: failed — <one short reason>` when you could not evaluate.\n\n",
    );
    out.push_str(&format!(
        "Delegation depth: {delegation_depth} of {max_depth}. A chain of replies stops at the cap \
         — if you are near it, resolve rather than re-delegate.\n\n"
    ));

    out.push_str("## Team Roster\n\n");
    if roster.is_empty() {
        out.push_str("(no other members — you are the only member of this team)\n");
    } else {
        for m in roster {
            out.push_str(&format!("- `@{}` — {}", m.name, m.role));
            if !m.capability.trim().is_empty() {
                out.push_str(&format!(" — {}", m.capability));
            }
            out.push('\n');
        }
    }

    let instructions = instructions.trim();
    if !instructions.is_empty() {
        out.push_str("\n## Leader Instructions\n\n");
        out.push_str(instructions);
        out.push('\n');
    }
    out
}

/// Read the verdict line back out of a leader's reply: the LAST line that
/// starts with [`VERDICT_MARKER`] wins (a leader that quotes the protocol
/// earlier in its reply is not misread). Returns the typed verdict and the
/// reason text after the separator, trimmed. A reply with no marker is
/// `Unstated` with an empty reason.
pub(crate) fn parse_leader_verdict(reply: &str) -> (LeaderVerdict, String) {
    let line = reply
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| l.to_ascii_uppercase().starts_with(VERDICT_MARKER));
    let Some(line) = line else {
        return (LeaderVerdict::Unstated, String::new());
    };
    let rest = line[VERDICT_MARKER.len()..].trim();
    // Token is the first word; the reason is what follows an em dash, a
    // hyphen, a colon, or just whitespace.
    let mut parts = rest.splitn(2, |c: char| c.is_whitespace());
    let token = parts
        .next()
        .unwrap_or("")
        .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .to_ascii_lowercase();
    let reason = parts
        .next()
        .unwrap_or("")
        .trim_start_matches(|c: char| c == '—' || c == '-' || c == ':' || c.is_whitespace())
        .trim()
        .to_string();
    let verdict = match token.as_str() {
        "action" => LeaderVerdict::Action,
        "no_action" | "noaction" | "no-action" => LeaderVerdict::NoAction,
        "failed" | "fail" | "error" => LeaderVerdict::Failed,
        _ => LeaderVerdict::Unstated,
    };
    (verdict, reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use rusqlite::Connection;

    const TEAM: &str = "team-L";

    fn seed_team(conn: &Connection, team_config: Option<&str>) {
        conn.execute(
            "INSERT INTO persona_teams (id, name, team_config, created_at, updated_at)
             VALUES (?1, 'T', ?2, datetime('now'), datetime('now'))",
            params![TEAM, team_config],
        )
        .unwrap();
    }

    fn seed_member(
        conn: &Connection,
        persona_id: &str,
        name: &str,
        role: &str,
        enabled: bool,
        created: &str,
        config: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO personas (id, project_id, name, system_prompt, description, enabled, created_at, updated_at)
             VALUES (?1, 'default', ?2, 'sp', ?3, ?4, datetime('now'), datetime('now'))",
            params![persona_id, name, format!("{name} does things"), enabled as i32],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO persona_team_members (id, team_id, persona_id, role, config, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                format!("m-{persona_id}"),
                TEAM,
                persona_id,
                role,
                config,
                created
            ],
        )
        .unwrap();
    }

    #[test]
    fn leader_is_the_oldest_enabled_dispatch_role_member() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        {
            let conn = pool.get()?;
            seed_team(&conn, None);
            // A disabled orchestrator is skipped; a later router is picked over
            // a worker; the oldest membership wins between two candidates.
            seed_member(
                &conn,
                "p-off",
                "Old Lead",
                "orchestrator",
                false,
                "2026-01-01 00:00:00",
                None,
            );
            seed_member(
                &conn,
                "p-w",
                "Worker",
                "worker",
                true,
                "2026-01-02 00:00:00",
                None,
            );
            seed_member(
                &conn,
                "p-r",
                "Router",
                "router",
                true,
                "2026-01-03 00:00:00",
                None,
            );
            seed_member(
                &conn,
                "p-o",
                "Orch",
                "orchestrator",
                true,
                "2026-01-04 00:00:00",
                None,
            );
        }
        let leader = channel_leader(&pool, TEAM).unwrap().expect("a leader");
        assert_eq!(leader.persona_id, "p-r");
        assert_eq!(leader.name, "Router");
        Ok(())
    }

    #[test]
    fn a_team_of_workers_has_no_leader() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        {
            let conn = pool.get()?;
            seed_team(&conn, None);
            seed_member(
                &conn,
                "p-a",
                "A",
                "worker",
                true,
                "2026-01-01 00:00:00",
                None,
            );
            seed_member(
                &conn,
                "p-b",
                "B",
                "reviewer",
                true,
                "2026-01-02 00:00:00",
                None,
            );
        }
        assert_eq!(channel_leader(&pool, TEAM).unwrap(), None);
        Ok(())
    }

    #[test]
    fn roster_excludes_the_leader_and_disabled_members_and_uses_semantic_roles(
    ) -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        {
            let conn = pool.get()?;
            seed_team(
                &conn,
                Some(r#"{"leader_instructions":"  DB work goes to QA Guardian first.  "}"#),
            );
            seed_member(
                &conn,
                "p-o",
                "Orch",
                "orchestrator",
                true,
                "2026-01-01 00:00:00",
                None,
            );
            seed_member(
                &conn,
                "p-qa",
                "QA Guardian",
                "worker",
                true,
                "2026-01-02 00:00:00",
                Some(r#"{"preset_role":"qa"}"#),
            );
            seed_member(
                &conn,
                "p-gone",
                "Ghost",
                "worker",
                false,
                "2026-01-03 00:00:00",
                None,
            );
        }
        let leader = channel_leader(&pool, TEAM).unwrap().unwrap();
        let roster = leader_roster(&pool, TEAM, &leader.persona_id).unwrap();
        assert_eq!(roster.len(), 1, "leader and disabled member excluded");
        assert_eq!(roster[0].name, "QA Guardian");
        assert_eq!(
            roster[0].role, "qa",
            "semantic preset role, not the pipeline enum"
        );
        assert!(roster[0].capability.contains("does things"));

        let briefing =
            render_leader_briefing(&leader, &roster, &leader_instructions(&pool, TEAM), 0, 3);
        assert!(
            briefing.contains("`@QA Guardian`"),
            "exact mention token rendered"
        );
        assert!(briefing.contains("## Leader Instructions"));
        assert!(briefing.contains("DB work goes to QA Guardian first."));
        assert!(briefing.contains("VERDICT: no_action"));
        Ok(())
    }

    #[test]
    fn briefing_omits_the_instructions_heading_when_empty() {
        let leader = ChannelLeader {
            persona_id: "x".into(),
            name: "Lead".into(),
        };
        let briefing = render_leader_briefing(&leader, &[], "", 1, 3);
        assert!(!briefing.contains("## Leader Instructions"));
        assert!(briefing.contains("only member of this team"));
        assert!(briefing.contains("Delegation depth: 1 of 3"));
    }

    #[test]
    fn verdict_parses_the_last_marker_line_and_tolerates_separators() {
        assert_eq!(
            parse_leader_verdict("Routing to @QA.\n\nVERDICT: action — QA owns tests"),
            (LeaderVerdict::Action, "QA owns tests".into())
        );
        assert_eq!(
            parse_leader_verdict("verdict: no_action - nothing changed"),
            (LeaderVerdict::NoAction, "nothing changed".into())
        );
        assert_eq!(
            parse_leader_verdict("VERDICT: failed: roster empty"),
            (LeaderVerdict::Failed, "roster empty".into())
        );
        // The protocol text quoted earlier must not win over the real last line.
        assert_eq!(
            parse_leader_verdict("`VERDICT: action — …` is the format.\nVERDICT: no_action — idle"),
            (LeaderVerdict::NoAction, "idle".into())
        );
        assert_eq!(
            parse_leader_verdict("I delegated to @Dev."),
            (LeaderVerdict::Unstated, String::new())
        );
        assert_eq!(
            parse_leader_verdict("VERDICT: maybe"),
            (LeaderVerdict::Unstated, String::new())
        );
    }
}
