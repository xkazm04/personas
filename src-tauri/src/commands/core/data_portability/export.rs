//! Assembly of the portability bundle from the database.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ============================================================================
// Internal helpers
// ============================================================================

/// Reduce a team memory's `tags` column to a portable value. The team-memory
/// editor stores tags as a `{ "source": ..., "revisions": [...] }` object where
/// `revisions` is the local edit history (up to 20 prior full versions). That
/// blob is large, unbounded-ish, and meaningless in another workspace — so we
/// keep only the durable `source` marker and drop the revision history. Plain
/// (non-object) tags pass through unchanged.
pub(crate) fn portable_team_memory_tags(tags: &Option<String>) -> Option<String> {
    let raw = tags.as_deref()?;
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
        if val.get("revisions").is_some() {
            return match val.get("source").and_then(|v| v.as_str()) {
                Some(s) if !s.is_empty() => Some(s.to_string()),
                _ => None,
            };
        }
    }
    Some(raw.to_string())
}

/// Whether this export is in a position to carry the two always-encrypted
/// sections. They are COLLECTED only when a passphrase exists to seal them —
/// reading a whole brain off disk and then discarding it would be pure waste,
/// and worse, would leave the plaintext sitting in memory for no reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SensitiveSections {
    Include,
    Omit,
}

impl SensitiveSections {
    pub(crate) fn from_passphrase(passphrase: Option<&str>) -> Self {
        if passphrase.is_some() {
            Self::Include
        } else {
            Self::Omit
        }
    }
}

pub(crate) fn build_export_bundle(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    scope: ExportScope,
    include_memories: bool,
    include_kpis: bool,
    sensitive: SensitiveSections,
) -> Result<PortabilityBundle, AppError> {
    // Everything this export DROPS gets recorded here and travels with the
    // bundle, so the machine that receives it can tell what is missing.
    let mut export_warnings: Vec<String> = Vec::new();
    let all_personas = persona_repo::get_all(pool)?;
    let all_tools = tool_repo::get_all_definitions(pool)?;
    let all_teams = team_repo::get_all(pool)?;
    let all_credentials = cred_repo::get_all(pool)?;

    let (selected_persona_ids, selected_team_ids) = match &scope {
        ExportScope::Full => (
            all_personas
                .iter()
                .map(|p| p.id.clone())
                .collect::<Vec<_>>(),
            all_teams.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
        ),
        ExportScope::Selective {
            persona_ids,
            team_ids,
            ..
        } => (persona_ids.clone(), team_ids.clone()),
    };

    // Batch-fetch all per-persona data in 5 queries instead of 5*N
    let all_triggers = trigger_repo::get_by_persona_ids(pool, &selected_persona_ids)?;
    let all_subscriptions =
        event_repo::get_subscriptions_by_persona_ids(pool, &selected_persona_ids)?;
    let all_memories = memory_repo::get_all_by_persona_ids(pool, &selected_persona_ids)?;
    let all_persona_tools = tool_repo::get_tools_for_personas(pool, &selected_persona_ids)?;
    let all_test_suites = suite_repo::list_by_persona_ids(pool, &selected_persona_ids)?;

    // Group by persona_id into HashMaps
    let mut triggers_map: HashMap<String, Vec<_>> = HashMap::new();
    for t in all_triggers {
        triggers_map
            .entry(t.persona_id.clone())
            .or_default()
            .push(t);
    }
    let mut subscriptions_map: HashMap<String, Vec<_>> = HashMap::new();
    for s in all_subscriptions {
        subscriptions_map
            .entry(s.persona_id.clone())
            .or_default()
            .push(s);
    }
    let mut memories_map: HashMap<String, Vec<_>> = HashMap::new();
    for m in all_memories {
        memories_map
            .entry(m.persona_id.clone())
            .or_default()
            .push(m);
    }
    let mut tools_map: HashMap<String, Vec<_>> = HashMap::new();
    for (pid, def) in all_persona_tools {
        tools_map.entry(pid).or_default().push(def);
    }
    let mut suites_map: HashMap<String, Vec<_>> = HashMap::new();
    for s in all_test_suites {
        suites_map.entry(s.persona_id.clone()).or_default().push(s);
    }

    // Build persona exports
    let mut persona_exports = Vec::new();
    for p in &all_personas {
        if !selected_persona_ids.contains(&p.id) {
            continue;
        }

        let triggers = triggers_map.remove(&p.id).unwrap_or_default();
        let subscriptions = subscriptions_map.remove(&p.id).unwrap_or_default();
        // Honor the export-time memory opt-out: drop the persona's memories
        // when the user unchecked "Include memories".
        let memories = if include_memories {
            memories_map.remove(&p.id).unwrap_or_default()
        } else {
            Vec::new()
        };
        let tools = tools_map.remove(&p.id).unwrap_or_default();
        let test_suites = suites_map.remove(&p.id).unwrap_or_default();

        persona_exports.push(PersonaExport {
            id: p.id.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            system_prompt: p.system_prompt.clone(),
            structured_prompt: p.structured_prompt.clone(),
            // Custom icons are local-only files — downgrade to a built-in so
            // the exported persona doesn't carry a dead reference.
            icon: export_safe_icon(p.icon.as_deref(), p.template_category.as_deref()),
            color: p.color.clone(),
            max_concurrent: p.max_concurrent,
            timeout_ms: p.timeout_ms,
            notification_channels: p.notification_channels.clone(),
            model_profile: p.model_profile.clone(),
            max_budget_usd: p.max_budget_usd,
            max_turns: p.max_turns,
            design_context: p.design_context.clone(),
            triggers: triggers
                .iter()
                .map(|t| TriggerExport {
                    trigger_type: t.trigger_type.clone(),
                    config: t.config.clone(),
                    enabled: t.enabled,
                    use_case_id: t.use_case_id.clone(),
                })
                .collect(),
            subscriptions: subscriptions
                .iter()
                .map(|s| SubscriptionExport {
                    event_type: s.event_type.clone(),
                    source_filter: s.source_filter.clone(),
                    enabled: s.enabled,
                    use_case_id: s.use_case_id.clone(),
                })
                .collect(),
            memories: memories
                .iter()
                .map(|m| MemoryExport {
                    title: m.title.clone(),
                    content: m.content.clone(),
                    category: m.category.clone(),
                    importance: m.importance,
                    tags: m.tags.clone(),
                })
                .collect(),
            tool_ids: tools.iter().map(|t| t.id.clone()).collect(),
            test_suites: test_suites
                .iter()
                .map(|s| TestSuiteExport {
                    name: s.name.clone(),
                    description: s.description.clone(),
                    scenarios: s.scenarios.clone(),
                    scenario_count: s.scenario_count,
                })
                .collect(),
        });
    }

    // Collect only referenced tool IDs
    let referenced_tool_ids: std::collections::HashSet<String> = persona_exports
        .iter()
        .flat_map(|p| p.tool_ids.iter().cloned())
        .collect();

    let tool_exports: Vec<ToolDefinitionExport> = all_tools
        .iter()
        .filter(|t| matches!(&scope, ExportScope::Full) || referenced_tool_ids.contains(&t.id))
        .map(|t| ToolDefinitionExport {
            id: t.id.clone(),
            name: t.name.clone(),
            category: t.category.clone(),
            description: t.description.clone(),
            input_schema: t.input_schema.clone(),
            requires_credential_type: t.requires_credential_type.clone(),
            implementation_guide: t.implementation_guide.clone(),
            is_builtin: t.is_builtin,
        })
        .collect();

    // Build team exports
    let mut team_exports = Vec::new();
    for t in &all_teams {
        if !selected_team_ids.contains(&t.id) {
            continue;
        }

        let members = team_repo::get_members(pool, &t.id)?;
        let connections = team_repo::get_connections(pool, &t.id)?;

        // Team memories ride along with their team, gated by the same
        // include_memories opt-out as persona memories.
        let team_memories = if include_memories {
            team_memory_repo::get_all(
                pool,
                &t.id,
                None,
                None,
                None,
                Some(MAX_TEAM_MEMORIES_PER_TEAM as i64),
                Some(0),
            )?
        } else {
            Vec::new()
        };

        team_exports.push(TeamExport {
            id: t.id.clone(),
            name: t.name.clone(),
            description: t.description.clone(),
            canvas_data: t.canvas_data.clone(),
            team_config: t.team_config.clone(),
            icon: export_safe_icon(t.icon.as_deref(), None),
            memories: team_memories
                .iter()
                .map(|m| TeamMemoryExport {
                    title: m.title.clone(),
                    content: m.content.clone(),
                    category: m.category.clone(),
                    importance: m.importance,
                    tags: portable_team_memory_tags(&m.tags),
                })
                .collect(),
            members: members
                .iter()
                .map(|m| TeamMemberExport {
                    persona_id: m.persona_id.clone(),
                    role: Some(m.role.clone()),
                    position_x: Some(m.position_x),
                    position_y: Some(m.position_y),
                    config: m.config.clone(),
                })
                .collect(),
            connections: connections
                .iter()
                .map(|c| TeamConnectionExport {
                    source_persona_id: c.source_member_id.clone(),
                    target_persona_id: c.target_member_id.clone(),
                    connection_type: Some(c.connection_type.clone()),
                    condition: c.condition.clone(),
                    label: c.label.clone(),
                })
                .collect(),
        });
    }

    // Credential metadata exports (no secrets — filtered in selective mode)
    let selected_credential_ids: Option<&Vec<String>> = match &scope {
        ExportScope::Full => None,
        ExportScope::Selective { credential_ids, .. } if credential_ids.is_empty() => None,
        ExportScope::Selective { credential_ids, .. } => Some(credential_ids),
    };

    let credential_exports: Vec<CredentialMetaExport> = all_credentials
        .iter()
        .filter(|c| match &selected_credential_ids {
            None => true,
            Some(ids) => ids.contains(&c.id),
        })
        .map(|c| CredentialMetaExport {
            name: c.name.clone(),
            service_type: c.service_type.clone(),
            metadata: c.metadata.clone(),
        })
        .collect();

    // KPI setup. KPIs are project-scoped; the "team's KPI setup" is the KPIs of
    // the projects its selected teams belong to. Full export takes every project's
    // KPIs. Only active/paused KPIs travel; each carries a capped, newest-first
    // slice of its measurement history.
    let kpi_exports: Vec<KpiExport> = if include_kpis {
        let source_kpis = match &scope {
            ExportScope::Full => dev_tools_repo::list_all_kpis(pool)?,
            ExportScope::Selective { .. } => {
                let mut project_ids: std::collections::HashSet<String> =
                    std::collections::HashSet::new();
                for t in &all_teams {
                    if selected_team_ids.contains(&t.id) {
                        if let Some(pid) = &t.project_id {
                            project_ids.insert(pid.clone());
                        }
                    }
                }
                let mut out = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for pid in &project_ids {
                    for k in dev_tools_repo::list_kpis(pool, pid, None)? {
                        if seen.insert(k.id.clone()) {
                            out.push(k);
                        }
                    }
                }
                out
            }
        };

        let exportable: Vec<_> = source_kpis
            .into_iter()
            .filter(|k| is_exportable_kpi(&k.status))
            .collect();
        push_truncation_warning(
            &mut export_warnings,
            "KPIs",
            MAX_KPIS.min(exportable.len()),
            exportable.len(),
            "KPI setup",
        );
        exportable
            .into_iter()
            .take(MAX_KPIS)
            .map(|k| {
                let measurements = dev_tools_repo::list_kpi_measurements(
                    pool,
                    &k.id,
                    Some(MAX_KPI_MEASUREMENTS as i64),
                )
                .unwrap_or_default()
                .into_iter()
                .map(|m| KpiMeasurementExport {
                    value: m.value,
                    measured_at: m.measured_at,
                    source: m.source,
                    evidence: m.evidence,
                    note: m.note,
                })
                .collect();

                KpiExport {
                    name: k.name,
                    description: k.description,
                    category: k.category,
                    measure_kind: k.measure_kind,
                    measure_config: k.measure_config,
                    unit: k.unit,
                    direction: k.direction,
                    baseline_value: k.baseline_value,
                    target_value: k.target_value,
                    target_date: k.target_date,
                    cadence: k.cadence,
                    status: k.status,
                    tier: k.tier,
                    rationale: k.rationale,
                    needed_connector: k.needed_connector,
                    metric_type: k.metric_type,
                    warn_at: k.warn_at,
                    crit_at: k.crit_at,
                    measurements,
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    // Dev-tools projects + workspace knowledge. Full scope takes every
    // project and workspace; selective scope takes exactly the requested ids
    // (an empty list means none — same semantics as personas/teams above).
    /// `None` = every row of that kind (Full scope); `Some(ids)` = exactly
    /// those, where an EMPTY slice means none.
    type IdFilter<'a> = Option<&'a [String]>;
    let (project_filter, workspace_filter, twin_filter): (IdFilter, IdFilter, IdFilter) =
        match &scope {
            ExportScope::Full => (None, None, None),
            ExportScope::Selective {
                project_ids,
                workspace_ids,
                twin_ids,
                ..
            } => (
                Some(project_ids.as_slice()),
                Some(workspace_ids.as_slice()),
                Some(twin_ids.as_slice()),
            ),
        };
    let dev_project_exports =
        collect_dev_project_exports(pool, project_filter, &mut export_warnings)?;
    let bundled_project_ids: Vec<String> =
        dev_project_exports.iter().map(|p| p.id.clone()).collect();
    let workspace_exports = collect_workspace_knowledge_exports(
        pool,
        workspace_filter,
        &bundled_project_ids,
        &mut export_warnings,
    )?;
    // Twins and Athena are the two always-encrypted sections. Without a
    // passphrase they are not collected at all; the omission is recorded so the
    // person who opens the bundle learns why it is thinner than they expected.
    let athena_tiers = AthenaTiers::from_scope(&scope)?;
    let (twin_exports, athena_export) = match sensitive {
        SensitiveSections::Include => (
            collect_twin_exports(pool, user_db, twin_filter, &mut export_warnings)?,
            collect_athena_export(pool, user_db, athena_tiers, &mut export_warnings)?,
        ),
        SensitiveSections::Omit => {
            let wants_twins = !twin_filter.is_some_and(|ids| ids.is_empty());
            if wants_twins || athena_tiers.any() {
                export_warnings.push(
                    "Digital twins and Athena's memory were left out: they travel encrypted only, \
                     and this export was written without a passphrase."
                        .into(),
                );
            }
            (Vec::new(), None)
        }
    };

    Ok(PortabilityBundle {
        format_version: 2,
        exported_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        scope,
        personas: persona_exports,
        tool_definitions: tool_exports,
        teams: team_exports,
        credentials: credential_exports,
        kpis: kpi_exports,
        dev_projects: dev_project_exports,
        workspace_knowledge: workspace_exports,
        twins: twin_exports,
        athena: athena_export,
        export_warnings,
        encrypted_credentials: None,
        encrypted_twins: None,
        encrypted_athena: None,
    })
}
