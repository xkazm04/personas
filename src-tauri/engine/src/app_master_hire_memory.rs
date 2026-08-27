//! **Hire-time memory seeding** — the pure half of M3a (kp
//! `docs/concepts/app-master.md` §8, integration point 3).
//!
//! §8's other two integration points (recall into the night, episodic
//! write-back) both assume there is something to recall. This one covers the
//! moment before either can do anything: an App master approved five minutes
//! ago has two empty stores, so its first night recalls nothing and it
//! re-derives what the repository is from scratch — while the one artefact that
//! already says all of it, the spec a human composed in kp, sits unread on the
//! approval row. This is the write of that artefact into recall.
//!
//! This module is the input-building half and nothing else. It takes the
//! `appMaster` JSON block that crossed the kp bridge and returns the exact rows
//! two stores should receive; the writing (and its best-effort failure
//! handling) lives in `commands/companion/approvals/app_master_hire.rs`. Pure
//! in, pure out — so the shape of what a hire remembers is testable without a
//! database, which is what the `app_lib` test binary cannot give us on every
//! box.
//!
//! # The two stores, unchanged
//!
//! - **persona lane** — `personas_db::repos::core::memories` (tiers
//!   core/active/working/archive, decay, dedup, operator UI).
//! - **project lane** — `personas_db::repos::dev_memories` (idempotent on
//!   `(project, source_kind, source_id)`, importance 1–10, no tiers).
//!
//! Neither is new and neither is modified. The App master reuses both.
//!
//! # Three rules the shapes here encode
//!
//! **Recall is a budget, not an archive.** `get_for_injection_v2` packs core +
//! active into a couple of thousand characters; a dossier's long tail spent
//! against that budget crowds out what the holder learned last night. So the
//! persona lane gets **at most five rows** — one identity, one gate list, one
//! hot-spot summary, one risk summary, one objective list — and the long tail
//! goes to the project lane, which is rendered under its own separate budget
//! and is read by every worker on the project rather than by one persona.
//!
//! **`core` is written here and nowhere else.** Exactly one row per hire is
//! promoted to the `core` tier: the identity the kp operator composed. Core is
//! always-included in recall, so every additional core row is a permanent tax
//! on every future prompt — and an agent that can write its own always-included
//! memory can rewrite its own mandate. Episodic write-back (night outcomes,
//! probation decisions, reconcile events) lands in `learned`/`constraint`;
//! agent-inferred claims about the OWNER go through the existing memory
//! *proposal* lane. That is the registry's memory-governance line, and this
//! hire path is the only sanctioned crossing of it.
//!
//! **Repo knowledge outlives tenure.** The dossier facts are written to the
//! PROJECT lane as well, keyed by field name, so a re-hire on the same project
//! inherits what the repository is — while inheriting none of the previous
//! holder's ledger (`app_master::tenure_window` keeps those separate). The
//! project rows are idempotent, so re-hiring writes nothing new there; the
//! persona's identity row carries the hire DATE and therefore differs per hire,
//! which means a re-hire adds its own and the predecessor's stays. Accepted,
//! and stated rather than deduped away: two identity rows on one persona is a
//! re-hire, and that is a true thing to remember.

use personas_db::models::{CreatePersonaMemoryInput, Json};
use serde_json::Value;

use crate::app_master::rung_label;

/// The project-lane counterpart of a persona memory row. Deliberately not a
/// `DevMemory`: that is a stored row with an id and timestamps, and this is an
/// intent to write one. `source_id` is the dossier FIELD NAME, which is what
/// makes the write idempotent across re-hires.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectMemorySeed {
    /// `dev_memories.source_id` — the dossier field this row carries.
    pub source_id: &'static str,
    /// `dev_memories.category`, mirroring the persona vocabulary.
    pub category: &'static str,
    pub title: String,
    pub content: String,
    /// `dev_memories` importance is 1–10 (not 1–5 like persona memories).
    pub importance: i32,
}

/// Everything a hire should remember, and everything it could not.
#[derive(Debug, Default)]
pub struct HireMemorySeeds {
    /// The single row the caller promotes to the `core` tier. `None` only if
    /// the block was so empty there was nothing to say — which never happens
    /// for a real spec, but is not worth a panic.
    pub core_identity: Option<CreatePersonaMemoryInput>,
    /// The dossier + objective rows, written at the store's default tier.
    pub persona_rows: Vec<CreatePersonaMemoryInput>,
    /// The project lane. Survives the persona.
    pub project_rows: Vec<ProjectMemorySeed>,
    /// What could not be seeded and why — carried onto the hire's setup notes
    /// rather than dropped, same contract as every other binding step.
    pub notes: Vec<String>,
}

/// `dev_memories.source_kind` for a row derived from the kp repo dossier.
pub const KP_DOSSIER_SOURCE: &str = "kp_dossier";

fn tags(list: &[&str]) -> Option<Json<Vec<String>>> {
    Some(Json(list.iter().map(|s| (*s).to_string()).collect()))
}

fn str_at(am: &Value, ptr: &str) -> String {
    am.pointer(ptr)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn str_array(am: &Value, ptr: &str) -> Vec<String> {
    am.pointer(ptr)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// `[{ref, note}, …]` → `"ref (note)"`, the shape both `hotSpots` and
/// `riskAreas` carry in kp's `RepoDossier`.
fn ref_notes(am: &Value, ptr: &str, limit: usize) -> Vec<String> {
    am.pointer(ptr)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let r = v.get("ref").and_then(Value::as_str)?.trim();
                    if r.is_empty() {
                        return None;
                    }
                    let n = v.get("note").and_then(Value::as_str).unwrap_or("").trim();
                    Some(if n.is_empty() {
                        r.to_string()
                    } else {
                        format!("{r} ({n})")
                    })
                })
                .take(limit)
                .collect()
        })
        .unwrap_or_default()
}

/// The app's display name, falling back the same way the build intent does.
fn app_name(am: &Value, fallback: &str) -> String {
    for ptr in ["/app/name", "/app/repo/url", "/app/repo/rootPath"] {
        let v = str_at(am, ptr);
        if !v.is_empty() {
            return v;
        }
    }
    fallback.to_string()
}

/// Build every memory row a completed App-master hire should write.
///
/// `hired_on` is the date the operator approved, formatted by the caller — the
/// identity row states its own provenance ("Hired via kp on …"), so the reader
/// of a two-year-old core memory can tell whether it describes the current
/// tenure without joining it against the mandate record.
///
/// # What is NOT here, and why it is a note instead
///
/// kp's `AppMasterSpec` carries `app.dossierId` but **not the dossier itself**
/// (`appMasterSpecSchema`, kp `app/_lib/schemas.generated.ts`): hot spots and
/// risk areas exist only in kp's own store. This reads them from an optional
/// `appMaster.dossier` block so the day kp starts sending one they are seeded
/// with no further change here — and, when it is absent, records that they were
/// not seeded rather than substituting something plausible from the fields that
/// did arrive. `declaredGates` is the exception: kp already carries it across
/// as `mandate.approvalGates` (the same carrier `app_master_gates` reads), so
/// the gate list is real on every hire.
pub fn hire_memory_seeds(
    persona_id: &str,
    persona_name: &str,
    am: &Value,
    hired_on: &str,
) -> HireMemorySeeds {
    let mut out = HireMemorySeeds::default();
    let app = app_name(am, persona_name);

    let mission = str_at(am, "/agent/mission");
    let owner = str_at(am, "/mandate/owner");
    let rung = am
        .pointer("/mandate/scopeRung")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u8;
    let forbidden = str_array(am, "/mandate/forbiddenClasses");
    let budget = am
        .pointer("/budget/monthlyUsd")
        .and_then(Value::as_f64)
        .filter(|b| *b > 0.0);
    let probation_days = am
        .pointer("/tenure/probationDays")
        .and_then(Value::as_i64)
        .unwrap_or(30);

    // -- 1. the ONE core row -------------------------------------------------
    // Mission + the mandate in one line. Everything in it is operator-stated:
    // it is the spec a human composed in kp and clicked approve on, which is
    // exactly the provenance that earns the always-included tier.
    let mut identity = format!(
        "Hired via kp on {hired_on}: I am the APP MASTER for {app} — the single accountable \
         owner of that application's continuing value."
    );
    if !mission.is_empty() {
        identity.push_str(&format!(" Mission: {mission}"));
        if !identity.ends_with('.') {
            identity.push('.');
        }
    }
    identity.push_str(&format!(
        " Mandate: rung {rung} ({}), {} forbidden change class(es)",
        rung_label(rung),
        forbidden.len()
    ));
    if !owner.is_empty() {
        identity.push_str(&format!(", owner {owner}"));
    }
    match budget {
        Some(b) => identity.push_str(&format!(", ${b:.2}/month")),
        None => identity.push_str(", no monthly ceiling stated"),
    }
    identity.push_str(&format!(
        ", probation {probation_days} days. This is the spec the kp operator composed; only a \
         new hire replaces it."
    ));
    out.core_identity = Some(CreatePersonaMemoryInput {
        persona_id: persona_id.to_string(),
        title: format!("App master identity — {app}"),
        content: identity,
        category: Some("instruction".into()),
        source_execution_id: None,
        importance: Some(5),
        tags: tags(&["identity", "kp_hire"]),
        use_case_id: None,
    });

    // -- 2. the dossier rows (persona lane, ≤3 here + 1 objectives below) ----
    // `declaredGates` prefers the dossier's own list when one travelled, and
    // falls back to the mandate's approval gates — kp's carrier for the same
    // commands.
    let mut gates = str_array(am, "/dossier/declaredGates");
    if gates.is_empty() {
        gates = str_array(am, "/mandate/approvalGates");
    }
    if gates.is_empty() {
        out.notes
            .push("no declared gates arrived with the hire, so none were seeded to memory".into());
    } else {
        let content = format!(
            "{app}'s own declared gates, in the order to run them: {}. Run these BEFORE \
             authoring so the starting state is known, and report a red one as red.",
            gates.join(" · ")
        );
        out.persona_rows.push(CreatePersonaMemoryInput {
            persona_id: persona_id.to_string(),
            title: format!("{app} — declared gates"),
            content: content.clone(),
            category: Some("fact".into()),
            source_execution_id: None,
            importance: Some(3),
            tags: tags(&["dossier", "kp_hire"]),
            use_case_id: None,
        });
        out.project_rows.push(ProjectMemorySeed {
            source_id: "declared_gates",
            category: "fact",
            title: "Declared gates".into(),
            content,
            importance: 6,
        });
    }

    // Hot spots and risk areas: only from a dossier that actually travelled.
    let hot = ref_notes(am, "/dossier/hotSpots", 5);
    let risk = ref_notes(am, "/dossier/riskAreas", 5);
    if hot.is_empty() && risk.is_empty() {
        out.notes.push(
            "the hire carried no `dossier` block (kp's AppMasterSpec sends `app.dossierId`, not \
             the dossier), so hot spots and risk areas were NOT seeded — the App master starts \
             without them rather than with a guess"
                .into(),
        );
    }
    if !hot.is_empty() {
        let content = format!(
            "Highest-churn areas of {app} — where a change is most likely to matter and most \
             likely to break something: {}.",
            hot.join("; ")
        );
        out.persona_rows.push(CreatePersonaMemoryInput {
            persona_id: persona_id.to_string(),
            title: format!("{app} — hot spots"),
            content: content.clone(),
            category: Some("fact".into()),
            source_execution_id: None,
            importance: Some(3),
            tags: tags(&["dossier", "kp_hire"]),
            use_case_id: None,
        });
        out.project_rows.push(ProjectMemorySeed {
            source_id: "hot_spots",
            category: "fact",
            title: "Hot spots".into(),
            content,
            importance: 6,
        });
    }
    if !risk.is_empty() {
        let content = format!(
            "Risk areas of {app} — name the invariant before touching one: {}.",
            risk.join("; ")
        );
        out.persona_rows.push(CreatePersonaMemoryInput {
            persona_id: persona_id.to_string(),
            title: format!("{app} — risk areas"),
            content: content.clone(),
            category: Some("fact".into()),
            source_execution_id: None,
            importance: Some(3),
            tags: tags(&["dossier", "kp_hire"]),
            use_case_id: None,
        });
        out.project_rows.push(ProjectMemorySeed {
            source_id: "risk_areas",
            category: "fact",
            title: "Risk areas".into(),
            content,
            importance: 6,
        });
    }

    // -- 3. the objectives row (persona lane only) --------------------------
    // The value ledger lives in the project's KPI rows and is re-read every
    // cycle; this is the recall copy, so it is ONE row and it is an
    // `instruction` — the standing question, not a fact about the repo.
    let objectives = am
        .pointer("/objectives")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let lines: Vec<String> = objectives
        .iter()
        .filter_map(|o| {
            let key = o.get("kpiKey").and_then(Value::as_str)?.trim();
            if key.is_empty() {
                return None;
            }
            let unit = o.get("unit").and_then(Value::as_str).unwrap_or("");
            let dir = match o.get("direction").and_then(Value::as_str) {
                Some("lte") => "<=",
                _ => ">=",
            };
            let window = o.get("windowDays").and_then(Value::as_i64).unwrap_or(30);
            // A missing target is stated as missing, exactly as the build
            // intent states a missing baseline — an invented number here would
            // be recalled forever as if someone had set it.
            let target = match o.get("target").and_then(Value::as_f64) {
                Some(t) => format!("{dir} {t}{unit}"),
                None => "no target set".to_string(),
            };
            Some(format!("{key}: {target} over {window}d"))
        })
        .collect();
    if lines.is_empty() {
        out.notes.push(
            "no objectives arrived with the hire, so the value ledger was not seeded to memory"
                .into(),
        );
    } else {
        out.persona_rows.push(CreatePersonaMemoryInput {
            persona_id: persona_id.to_string(),
            title: format!("{app} — objectives"),
            content: format!(
                "My value ledger, set at hire. At the start of every cycle: which of these can I \
                 move, and is it true that it moved? — {}",
                lines.join(" | ")
            ),
            category: Some("instruction".into()),
            source_execution_id: None,
            importance: Some(4),
            tags: tags(&["dossier", "kp_hire"]),
            use_case_id: None,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> Value {
        serde_json::json!({
            "app": {"name": "kp", "repo": {"url": "https://github.com/xkazm04/kp",
                                           "rootPath": null, "mainBranch": "main"}},
            "objectives": [
                {"kpiKey": "gate_pass_rate", "label": "Gate pass rate", "baseline": 0.82,
                 "target": 0.95, "unit": "", "direction": "gte", "windowDays": 30},
                {"kpiKey": "p95_build_s", "label": "p95 build seconds", "baseline": null,
                 "target": 120.0, "unit": "s", "direction": "lte", "windowDays": 14}
            ],
            "mandate": {"scopeRung": 2,
                        "forbiddenClasses": ["test_deletion_or_skip", "suppression_directive"],
                        "approvalGates": ["npm run test:unit", "npm run lint"],
                        "owner": "ana@example.com"},
            "budget": {"monthlyUsd": 40.0, "reservationPolicy": "estimate", "onCap": "drain"},
            "tenure": {"probationDays": 30, "reviewCadenceDays": 30, "retireCriteria": []},
            "agent": {"name": "kp App master", "mission": "Own kp's continuing value",
                      "systemPromptDraft": "", "connectors": []}
        })
    }

    #[test]
    fn the_hire_seeds_exactly_one_core_row_and_it_is_the_operator_stated_identity() {
        let s = hire_memory_seeds("p1", "fallback", &spec(), "2026-08-27");
        let core = s.core_identity.expect("an identity row");
        assert_eq!(core.category.as_deref(), Some("instruction"));
        assert_eq!(core.importance, Some(5));
        assert_eq!(
            core.tags.as_ref().map(|t| t.0.clone()),
            Some(vec!["identity".to_string(), "kp_hire".to_string()])
        );
        // Provenance is IN the content, not only in the tags — a core row is
        // read as text by every future prompt.
        assert!(
            core.content.contains("Hired via kp on 2026-08-27"),
            "{core:?}"
        );
        assert!(core.content.contains("APP MASTER for kp"), "{core:?}");
        assert!(
            core.content.contains("Own kp's continuing value"),
            "{core:?}"
        );
        assert!(core.content.contains("rung 2"), "{core:?}");
        assert!(
            core.content.contains("2 forbidden change class(es)"),
            "{core:?}"
        );
        assert!(core.content.contains("ana@example.com"), "{core:?}");
        assert!(core.content.contains("$40.00/month"), "{core:?}");
        assert!(core.content.contains("probation 30 days"), "{core:?}");
        // The other rows exist and none of them is an identity row — the caller
        // promotes exactly one, and this is the pin on which.
        assert!(!s.persona_rows.is_empty());
        assert!(!s.persona_rows.iter().any(|r| r
            .tags
            .as_ref()
            .is_some_and(|t| t.0.iter().any(|x| x == "identity"))));
    }

    #[test]
    fn the_persona_lane_stays_inside_the_recall_budget() {
        let mut v = spec();
        v["dossier"] = serde_json::json!({
            "declaredGates": ["npm run typecheck", "npm run test:unit"],
            "hotSpots": [{"ref": "app/_lib/db/core.ts", "note": "churn"},
                         {"ref": "app/api/agents", "note": "churn"}],
            "riskAreas": [{"ref": "app/_lib/auth", "note": "custom HMAC"}]
        });
        let s = hire_memory_seeds("p1", "fallback", &v, "2026-08-27");
        // 1 core + at most 4 others. The dossier's long tail belongs to the
        // project lane; recall is a budget.
        assert!(s.core_identity.is_some());
        assert!(
            s.persona_rows.len() <= 4,
            "{} persona rows — the recall budget allows 4 beside the core row",
            s.persona_rows.len()
        );
        // One row per dossier field, never one row per hot spot.
        let titles: Vec<&str> = s.persona_rows.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(
            titles,
            vec![
                "kp — declared gates",
                "kp — hot spots",
                "kp — risk areas",
                "kp — objectives"
            ]
        );
        for r in &s.persona_rows {
            assert!(matches!(
                r.category.as_deref(),
                Some("fact") | Some("instruction")
            ));
            assert_eq!(
                r.tags.as_ref().map(|t| t.0.clone()),
                Some(vec!["dossier".to_string(), "kp_hire".to_string()])
            );
        }
        // The dossier's own gate list wins over the mandate's carrier when both
        // arrive.
        assert!(
            s.persona_rows[0].content.contains("npm run typecheck"),
            "{:?}",
            s.persona_rows[0]
        );
    }

    #[test]
    fn the_project_lane_carries_the_repo_facts_keyed_by_field_name() {
        let mut v = spec();
        v["dossier"] = serde_json::json!({
            "hotSpots": [{"ref": "app/_lib/db/core.ts", "note": "churn"}],
            "riskAreas": [{"ref": "app/_lib/auth", "note": "custom HMAC"}]
        });
        let s = hire_memory_seeds("p1", "fallback", &v, "2026-08-27");
        let ids: Vec<&str> = s.project_rows.iter().map(|r| r.source_id).collect();
        assert_eq!(ids, vec!["declared_gates", "hot_spots", "risk_areas"]);
        for r in &s.project_rows {
            // `dev_memories.importance` is 1–10, not 1–5.
            assert_eq!(r.importance, 6);
            assert_eq!(r.category, "fact");
            assert!(!r.title.trim().is_empty() && !r.content.trim().is_empty());
        }
        // Objectives are NOT written to the project lane: they belong to a
        // hire, and the project outlives the hire.
        assert!(!ids.contains(&"objectives"));
    }

    #[test]
    fn a_hire_without_a_dossier_says_so_instead_of_inventing_one() {
        let s = hire_memory_seeds("p1", "fallback", &spec(), "2026-08-27");
        // The gates still land — kp carries them as `mandate.approvalGates`.
        assert!(s.persona_rows[0].content.contains("npm run test:unit"));
        assert!(s
            .project_rows
            .iter()
            .any(|r| r.source_id == "declared_gates"));
        // Hot spots and risk areas do not, and the gap is a note.
        assert!(!s.project_rows.iter().any(|r| r.source_id == "hot_spots"));
        assert!(
            s.notes
                .iter()
                .any(|n| n.contains("hot spots and risk areas were NOT seeded")),
            "{:?}",
            s.notes
        );
    }

    #[test]
    fn an_objective_with_no_target_is_recalled_as_having_none() {
        let mut v = spec();
        v["objectives"] = serde_json::json!([
            {"kpiKey": "time_to_first_review", "target": null, "unit": "h",
             "direction": "lte", "windowDays": 7}
        ]);
        let s = hire_memory_seeds("p1", "fallback", &v, "2026-08-27");
        let obj = s
            .persona_rows
            .iter()
            .find(|r| r.title.ends_with("objectives"))
            .expect("an objectives row");
        assert!(
            obj.content
                .contains("time_to_first_review: no target set over 7d"),
            "{obj:?}"
        );
        assert!(!obj.content.contains("<= 0"), "{obj:?}");
        assert_eq!(obj.importance, Some(4));
    }

    #[test]
    fn an_empty_ledger_and_no_gates_are_notes_not_empty_rows() {
        let v = serde_json::json!({"app": {"name": "kp"}, "mandate": {"scopeRung": 0}});
        let s = hire_memory_seeds("p1", "fallback", &v, "2026-08-27");
        assert!(s.core_identity.is_some(), "a hire always has an identity");
        assert!(s.persona_rows.is_empty(), "{:?}", s.persona_rows);
        assert!(s.project_rows.is_empty());
        assert!(
            s.notes.iter().any(|n| n.contains("no declared gates")),
            "{:?}",
            s.notes
        );
        assert!(
            s.notes.iter().any(|n| n.contains("no objectives")),
            "{:?}",
            s.notes
        );
        // A missing budget is stated as missing, never as $0.00.
        let core = s.core_identity.unwrap();
        assert!(
            core.content.contains("no monthly ceiling stated"),
            "{core:?}"
        );
        assert!(!core.content.contains("$0.00"), "{core:?}");
    }

    #[test]
    fn every_seeded_category_is_inside_the_validated_vocabulary() {
        // `validate_category` rejects anything outside this set at write time,
        // and `batch_create` turns a rejection into a SKIPPED row — a memory
        // silently missing from recall. Pinned here rather than discovered by
        // an App master that could not remember its own gates.
        const ALLOWED: [&str; 6] = [
            "fact",
            "preference",
            "instruction",
            "context",
            "learned",
            "constraint",
        ];
        let mut v = spec();
        v["dossier"] = serde_json::json!({
            "hotSpots": [{"ref": "a", "note": "n"}],
            "riskAreas": [{"ref": "b", "note": "n"}]
        });
        let s = hire_memory_seeds("p1", "fallback", &v, "2026-08-27");
        let core = s.core_identity.unwrap();
        assert!(ALLOWED.contains(&core.category.as_deref().unwrap()));
        for r in &s.persona_rows {
            let c = r.category.as_deref().unwrap();
            assert!(
                ALLOWED.contains(&c),
                "category `{c}` would be rejected at write time"
            );
            // persona_memories importance is 1–5; 0 or 6 is a validation error.
            let i = r.importance.unwrap();
            assert!((1..=5).contains(&i), "importance {i} is outside 1–5");
        }
        for r in &s.project_rows {
            assert!(ALLOWED.contains(&r.category));
        }
    }
}
