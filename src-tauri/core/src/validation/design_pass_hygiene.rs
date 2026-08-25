//! Design-pass hygiene — a build-session's *suggested* trigger never fails the
//! build it was suggested for.
//!
//! # Why this exists
//!
//! The 2026-08-25 bench sweep (#17) lost two one-shot kp hire sessions —
//! 20–40 minutes of Claude session each — to two strings. Both times the design
//! pass proposed a schedule, and both times the proposal was refused by
//! `validate_triggers` (step 3 of `promote_build_draft_inner`), which failed the
//! **whole build**:
//!
//! ```text
//! session b18ae540…  Validation error: Invalid cron expression: Invalid value: {{param.daily_audit_hour}}
//! kp-tight-budget    Validation error: Invalid cron expression: Expected 5 fields, got 1
//! ```
//!
//! The first is an unresolved template: the design pass emitted the placeholder
//! it had been *shown* instead of a value. The second is a malformed literal —
//! a bare word or number where a 5-field cron belongs. Neither validator was
//! wrong. What was wrong is the blast radius: every tool test, every fix pass
//! and every row that would have been promoted went with one advisory field on
//! one trigger.
//!
//! So this module is the one place a build's design output is made safe *before*
//! validation sees it. A cadence suggestion that cannot be honoured costs the
//! **trigger**; it never costs the **build**.
//!
//! # Scope — build output only, never a human's input
//!
//! This leniency exists because the alternative is losing a long Claude session
//! over a suggestion. That reasoning does not transfer to a person: a human who
//! types `daily` into the Add-trigger form is told so, immediately and for free.
//!
//! So this pass is called from exactly one place —
//! `promote_build_draft_inner`, on the IR the design pass produced, before
//! `validate_triggers`. `trigger_repo::create` / `update` (the IPC commands
//! behind the trigger UI) are untouched and stay strict.
//!
//! # The rules
//!
//! **Unresolved `{{…}}` placeholders**, in any string in a trigger config
//! (recursively, objects and arrays) and in `AgentIrEvent`, keyed on the
//! field's own name:
//!
//! | Field | Rule | Why |
//! | --- | --- | --- |
//! | `cron`, `cron_expression` | replace with [`DEFAULT_NIGHTLY_CRON`] | a schedule with no cadence is dead; 02:00 daily is the same default `app_master_hire::install_triggers` already applies to a kp `schedule` trigger that arrives without a cron |
//! | `timezone`, `time_zone`, `tz` | replace with [`DEFAULT_TIMEZONE`] | `scheduler::resolve_schedule_tz` refuses an unparseable zone, and `create_triggers_in_tx` turns that refusal into a hard "born dead" error. UTC always resolves |
//! | `url`, `endpoint`, `webhook_url`, `callback_url`, `event_type`, `listen_event_type` | demote the whole trigger | no default exists that is not an invention — a polling trigger aimed at a guessed URL, or a listener bound to a guessed event, is worse than no trigger |
//! | `trigger_type` itself | demote the whole trigger | the kind is unknowable |
//! | everything else (`interval_seconds`, `window_seconds`, `webhook_secret`, any numeric param…) | drop the field | the field goes, the trigger keeps whatever it can still do; `ensure_webhook_secrets` mints a real secret for the one case that needs it |
//!
//! **A `schedule` trigger's cron**, after the placeholder pass, in order:
//!
//! 1. it parses ([`crate::cron::parse_cron`]) → untouched, including every
//!    Jenkins-`H` form the runtime accepts;
//! 2. it is a **recognised shorthand** ([`coerce_cron_shorthand`]) — `daily`,
//!    `@hourly`, `weekly`, a bare hour `9` — → coerced to the 5-field
//!    equivalent, because a design pass writing `daily` communicated a real
//!    cadence and only got the notation wrong;
//! 3. anything else → the trigger is demoted, with a note naming the raw value
//!    verbatim so a reviewer can see what the model actually proposed.
//!
//! **A `schedule` trigger's timezone** that `resolve_schedule_tz` cannot parse
//! (`"local"`, `"CET+1"`, a city name) becomes [`DEFAULT_TIMEZONE`]. Left alone
//! it is not a validation error at all — it is worse: `compute_next_from_config`
//! returns `None` and `create_triggers_in_tx` raises the "born dead" refusal,
//! failing the build one step further along than the cron did.
//!
//! # Demote, not delete
//!
//! `ir.triggers[i]` is **positionally aligned** with `ir.use_cases[i]`
//! (`build_structured_use_cases` reads `ir.triggers.get(idx)`, and the
//! capability-exclusion pass filters both arrays in lock-step). Removing an
//! element from the middle would hand every later capability the wrong trigger.
//! So a doomed trigger is rewritten in place to [`MANUAL_TRIGGER_TYPE`] with an
//! empty config: the capability keeps its slot and becomes on-demand, which is
//! exactly what the vocabulary already means by "no trigger"
//! (`TriggerKind::Manual`) — and the same state a use case lands in when the
//! design pass emits no `suggested_trigger` at all.
//!
//! # What this deliberately does NOT do
//!
//! * It does **not** touch prompts, descriptions, `structured_prompt` or the
//!   `persona` block. `{{param.*}}` there is the feature, not the bug —
//!   `engine::prompt::variables` resolves it against `persona.parameters` at run
//!   time, and `recipe_parameters::inject_capability_parameters_section`
//!   deliberately bakes it into the system prompt.
//! * It does **not** relax any validator. `validate_config` still rejects a bad
//!   cron; this pass simply makes sure a *build's* IR no longer contains one.
//! * It never **adds** a trigger, and it only adds a *field* to a trigger it
//!   already changed (the cadence restore below), never to one it left alone. A
//!   schedule that arrives with neither cron nor interval and nothing wrong with
//!   it is still the pre-existing validation failure.

use crate::cron::parse_cron;
use crate::models::agent_ir::{AgentIr, AgentIrTrigger};
use crate::scheduler::resolve_schedule_tz;
use crate::validation::trigger::normalize_trigger_type;
use serde_json::Value;

// ============================================================================
// The documented defaults
// ============================================================================

/// The cadence a schedule falls back to when its cron was a placeholder or the
/// design pass said "daily".
///
/// 02:00 daily — deliberately the same value (and the same reasoning) as
/// `commands::companion::approvals::app_master_hire::install_triggers`, which
/// already defaults a kp `schedule` trigger arriving without a `cron` to
/// `"0 2 * * *"`. Two paths, one nightly default.
pub const DEFAULT_NIGHTLY_CRON: &str = "0 2 * * *";

/// `hourly` / `@hourly` — the top of every hour.
pub const DEFAULT_HOURLY_CRON: &str = "0 * * * *";

/// `weekly` / `@weekly` — Monday at the nightly hour.
pub const DEFAULT_WEEKLY_CRON: &str = "0 2 * * 1";

/// `monthly` / `@monthly` — the 1st, at the nightly hour.
pub const DEFAULT_MONTHLY_CRON: &str = "0 2 1 * *";

/// `yearly` / `@annually` — 1 January, at the nightly hour.
pub const DEFAULT_YEARLY_CRON: &str = "0 2 1 1 *";

/// `midnight` / `@midnight` — the one shorthand that is NOT the nightly
/// default, because it names its own hour.
pub const MIDNIGHT_CRON: &str = "0 0 * * *";

/// The zone a schedule falls back to when its timezone field was a placeholder
/// or an unresolvable name. UTC is the only zone guaranteed to parse, and
/// `TriggerConfig`'s own absent-timezone behaviour is already clock-stable.
pub const DEFAULT_TIMEZONE: &str = "UTC";

/// The wire spelling of "no trigger" — `TriggerKind::Manual`. A trigger that
/// cannot be repaired is rewritten to this in place rather than removed.
pub const MANUAL_TRIGGER_TYPE: &str = "manual";

/// The config keys a cron expression can arrive under, in lookup order — the
/// same pair `validate_config` and `validate_schedule_has_cron_or_interval`
/// check.
pub const CRON_KEYS: &[&str] = &["cron", "cron_expression"];

// ============================================================================
// Detection + coercion
// ============================================================================

/// True when `s` carries an unresolved handlebars placeholder — an opening
/// `{{` with a closing `}}` somewhere after it.
///
/// Substring, not whole-string: the failure mode includes partially-templated
/// values like `"0 {{param.daily_audit_hour}} * * *"`, which parse no better
/// than a bare placeholder.
pub fn is_unresolved_template(s: &str) -> bool {
    match s.find("{{") {
        Some(open) => s[open + 2..].contains("}}"),
        None => false,
    }
}

/// Expand a cadence the design pass wrote in shorthand into the 5-field cron
/// the parser accepts. Returns `None` when nothing recognisable is there.
///
/// Accepts the `@daily`-style preset names (which `crate::cron` does **not**
/// implement — it is a strict 5-field parser), their bare and `every_x`
/// spellings, and a bare hour-of-day `0`–`23`. Every value this returns is
/// asserted to parse by `every_shorthand_expands_to_a_parseable_cron`.
///
/// Only ever consulted for a value that already **failed** `parse_cron`, so a
/// real expression can never be rewritten by a coincidental match.
pub fn coerce_cron_shorthand(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('@').trim();
    let key = trimmed.to_ascii_lowercase().replace([' ', '-'], "_");

    let preset = match key.as_str() {
        "daily" | "nightly" | "every_day" | "everyday" | "each_day" | "day" | "night" => {
            DEFAULT_NIGHTLY_CRON
        }
        "midnight" => MIDNIGHT_CRON,
        "hourly" | "every_hour" | "each_hour" | "hour" => DEFAULT_HOURLY_CRON,
        "weekly" | "every_week" | "each_week" | "week" => DEFAULT_WEEKLY_CRON,
        "monthly" | "every_month" | "each_month" | "month" => DEFAULT_MONTHLY_CRON,
        "yearly" | "annually" | "annual" | "every_year" | "year" => DEFAULT_YEARLY_CRON,
        _ => {
            // A bare hour-of-day — "9", "02". The design pass named the hour and
            // dropped the rest of the expression.
            let hour: u32 = key.parse().ok()?;
            if hour > 23 {
                return None;
            }
            return Some(format!("0 {hour} * * *"));
        }
    };
    Some(preset.to_string())
}

/// What to do with one templated field, decided by the field's name alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldRule {
    /// A documented deterministic default exists for this field.
    ReplaceWith(&'static str),
    /// No default exists, but the owner survives without the field.
    DropField,
    /// No default exists and the owner is meaningless without the field —
    /// demote the whole trigger to manual.
    DemoteOwner,
}

/// The rule for a templated field, by name. See the module table.
pub fn rule_for_field(key: &str) -> FieldRule {
    match key.trim().to_ascii_lowercase().as_str() {
        "cron" | "cron_expression" => FieldRule::ReplaceWith(DEFAULT_NIGHTLY_CRON),
        "timezone" | "time_zone" | "tz" => FieldRule::ReplaceWith(DEFAULT_TIMEZONE),
        "url" | "endpoint" | "webhook_url" | "callback_url" | "event_type"
        | "listen_event_type" => FieldRule::DemoteOwner,
        _ => FieldRule::DropField,
    }
}

// ============================================================================
// The report
// ============================================================================

/// What the pass changed. Every entry is a finished sentence naming the field
/// and the reason, so the caller can log it and hand it to a reviewer verbatim.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DesignHygieneReport {
    /// Fields resolved to a documented default or coerced from shorthand.
    pub replaced: Vec<String>,
    /// Fields removed because no honest default exists for them.
    pub dropped_fields: Vec<String>,
    /// Triggers demoted to `manual` because a value they cannot work without
    /// was unusable.
    pub demoted_triggers: Vec<String>,
    /// `agent_ir.events[]` entries removed because their `event_type` was a
    /// placeholder.
    pub dropped_events: Vec<String>,
}

impl DesignHygieneReport {
    /// The design pass produced nothing this pass had to touch.
    pub fn is_empty(&self) -> bool {
        self.replaced.is_empty()
            && self.dropped_fields.is_empty()
            && self.demoted_triggers.is_empty()
            && self.dropped_events.is_empty()
    }

    /// Fields given a documented default or a coerced value.
    pub fn normalized_count(&self) -> usize {
        self.replaced.len()
    }

    /// Fields, triggers and events removed or demoted.
    pub fn dropped_count(&self) -> usize {
        self.dropped_fields.len() + self.demoted_triggers.len() + self.dropped_events.len()
    }

    /// Every entry, in one flat list — the shape `setup_detail.notes` takes.
    pub fn notes(&self) -> Vec<String> {
        self.replaced
            .iter()
            .chain(self.dropped_fields.iter())
            .chain(self.demoted_triggers.iter())
            .chain(self.dropped_events.iter())
            .cloned()
            .collect()
    }

    /// One line for a reviewer: how much was normalized and how much was lost.
    pub fn summary(&self) -> String {
        format!(
            "design-pass hygiene: {} field(s) normalized, {} field(s) dropped, {} trigger(s) demoted to manual, {} event(s) dropped",
            self.replaced.len(),
            self.dropped_fields.len(),
            self.demoted_triggers.len(),
            self.dropped_events.len(),
        )
    }
}

// ============================================================================
// The pass
// ============================================================================

/// Make a build session's design output safe for the validators that run next.
///
/// Idempotent: a second run over the same IR reports nothing, because the first
/// left nothing behind that this pass objects to.
pub fn normalize_design_output(ir: &mut AgentIr) -> DesignHygieneReport {
    let mut report = DesignHygieneReport::default();

    for (idx, trigger) in ir.triggers.iter_mut().enumerate() {
        normalize_trigger(idx, trigger, &mut report);
    }

    // Events are a flat list with no positional contract against use_cases
    // (`create_event_subscriptions_in_tx` reads them by value), so a doomed
    // event is genuinely removed rather than demoted.
    let mut dropped_events: Vec<usize> = Vec::new();
    for (idx, event) in ir.events.iter_mut().enumerate() {
        if event
            .event_type
            .as_deref()
            .is_some_and(is_unresolved_template)
        {
            report.dropped_events.push(format!(
                "event #{idx}: DROPPED — its `event_type` was the unresolved placeholder `{}`, and no default event name exists that would not be an invention",
                event.event_type.as_deref().unwrap_or("")
            ));
            dropped_events.push(idx);
            continue;
        }
        if event
            .source_filter
            .as_deref()
            .is_some_and(is_unresolved_template)
        {
            report.dropped_fields.push(format!(
                "event #{idx}: dropped `source_filter` — it was the unresolved placeholder `{}`; the subscription keeps its event type and simply stops filtering by source",
                event.source_filter.as_deref().unwrap_or("")
            ));
            event.source_filter = None;
        }
    }
    if !dropped_events.is_empty() {
        let mut idx = 0usize;
        ir.events.retain(|_| {
            let keep = !dropped_events.contains(&idx);
            idx += 1;
            keep
        });
    }

    report
}

/// Scrub one trigger. `idx` is only used to name it in the notes.
fn normalize_trigger(idx: usize, trigger: &mut AgentIrTrigger, report: &mut DesignHygieneReport) {
    let raw_type = trigger
        .trigger_type
        .clone()
        .unwrap_or_else(|| MANUAL_TRIGGER_TYPE.to_string());

    // The kind itself is a placeholder — nothing downstream can be inferred.
    if is_unresolved_template(&raw_type) {
        report.demoted_triggers.push(format!(
            "trigger #{idx}: DEMOTED to `{MANUAL_TRIGGER_TYPE}` — its `trigger_type` was the unresolved placeholder `{raw_type}`, so the kind is unknowable; the capability stays, on demand"
        ));
        demote(trigger);
        return;
    }

    let kind = normalize_trigger_type(&raw_type).to_string();

    // Field-level notes land in a per-trigger buffer first. If the trigger is
    // demoted, the config they describe is discarded whole and a note about one
    // of its fields would only mislead a reviewer — so the buffer is merged
    // into the real report only when the trigger survives.
    let mut local = DesignHygieneReport::default();
    let mut demote_reason: Option<String> = None;

    // -- 1. unresolved placeholders, anywhere in the config ------------------
    if let Some(config) = trigger.config.as_mut() {
        scrub(
            config,
            &format!("trigger #{idx} ({kind}) config"),
            &mut local,
            &mut demote_reason,
        );
    }

    // -- 2. a schedule's cron: parse, else coerce, else demote ---------------
    if demote_reason.is_none() && kind == "schedule" {
        if let Some((key, raw)) = cron_entry(trigger) {
            if !raw.trim().is_empty() && parse_cron(raw.trim()).is_err() {
                match coerce_cron_shorthand(&raw) {
                    Some(coerced) => {
                        local.replaced.push(format!(
                            "trigger #{idx} (schedule) config.{key}: coerced the cadence shorthand `{raw}` to `{coerced}` — the design pass named a real cadence in a notation the 5-field cron parser does not accept"
                        ));
                        set_config_field(trigger, &key, Value::String(coerced));
                    }
                    None => {
                        demote_reason = Some(format!(
                            "`config.{key}` was `{raw}`, which is not a cron expression and matches no cadence shorthand"
                        ));
                    }
                }
            }
        }
    }

    if let Some(reason) = demote_reason {
        report.demoted_triggers.push(format!(
            "trigger #{idx}: DEMOTED to `{MANUAL_TRIGGER_TYPE}` — {reason}; the capability stays, on demand"
        ));
        demote(trigger);
        return;
    }

    // -- 3. a schedule's timezone must resolve to an IANA zone ---------------
    if kind == "schedule" {
        if let Some(raw) = config_str(trigger, "timezone") {
            if !raw.trim().is_empty() && resolve_schedule_tz(Some(raw.trim())).is_err() {
                local.replaced.push(format!(
                    "trigger #{idx} (schedule) config.timezone: replaced `{raw}` with `{DEFAULT_TIMEZONE}` — it is not an IANA zone name, and an unresolvable zone makes the trigger born dead rather than merely mistimed"
                ));
                set_config_field(
                    trigger,
                    "timezone",
                    Value::String(DEFAULT_TIMEZONE.to_string()),
                );
            }
        }
    }

    let touched = !local.is_empty();
    report.replaced.append(&mut local.replaced);
    report.dropped_fields.append(&mut local.dropped_fields);

    if !touched {
        // Untouched trigger: leave every pre-existing validation outcome exactly
        // as it was. A schedule with no cadence and nothing wrong with it is
        // still the refusal it has always been.
        return;
    }

    // -- 4. a scheduled kind we DID touch may have lost its only cadence -----
    match kind.as_str() {
        "schedule" if !has_cron(trigger) && !has_positive_interval(trigger) => {
            set_config_field(
                trigger,
                "cron",
                Value::String(DEFAULT_NIGHTLY_CRON.to_string()),
            );
            report.replaced.push(format!(
                "trigger #{idx} (schedule): set `cron` to the default nightly `{DEFAULT_NIGHTLY_CRON}` — the hygiene pass left it with no cadence at all, and a schedule with no cadence never fires"
            ));
        }
        "polling" if !has_positive_interval(trigger) => {
            report.demoted_triggers.push(format!(
                "trigger #{idx}: DEMOTED to `{MANUAL_TRIGGER_TYPE}` — the hygiene pass left the polling trigger with no interval, and inventing a poll cadence would spend network calls the design never asked for; the capability stays, on demand"
            ));
            demote(trigger);
        }
        _ => {}
    }
}

/// Rewrite a trigger in place as manual/on-demand, keeping its array position,
/// its description and its capability link.
fn demote(trigger: &mut AgentIrTrigger) {
    trigger.trigger_type = Some(MANUAL_TRIGGER_TYPE.to_string());
    trigger.config = None;
}

fn config_object(trigger: &AgentIrTrigger) -> Option<&serde_json::Map<String, Value>> {
    trigger.config.as_ref().and_then(|c| c.as_object())
}

fn config_str(trigger: &AgentIrTrigger, key: &str) -> Option<String> {
    config_object(trigger)?
        .get(key)?
        .as_str()
        .map(str::to_string)
}

/// The cron key this trigger actually used, and its raw value.
fn cron_entry(trigger: &AgentIrTrigger) -> Option<(String, String)> {
    let obj = config_object(trigger)?;
    CRON_KEYS.iter().find_map(|k| {
        obj.get(*k)
            .and_then(|v| v.as_str())
            .map(|s| ((*k).to_string(), s.to_string()))
    })
}

fn has_cron(trigger: &AgentIrTrigger) -> bool {
    cron_entry(trigger).is_some_and(|(_, v)| !v.trim().is_empty())
}

fn has_positive_interval(trigger: &AgentIrTrigger) -> bool {
    config_object(trigger).is_some_and(|o| {
        o.get("interval_seconds")
            .and_then(|v| v.as_i64())
            .is_some_and(|n| n > 0)
    })
}

fn set_config_field(trigger: &mut AgentIrTrigger, key: &str, value: Value) {
    let config = trigger
        .config
        .get_or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !config.is_object() {
        *config = Value::Object(serde_json::Map::new());
    }
    if let Some(obj) = config.as_object_mut() {
        obj.insert(key.to_string(), value);
    }
}

/// Walk a config value, applying [`rule_for_field`] to every templated string.
///
/// Recurses through nested objects and arrays — composite trigger configs nest
/// their member conditions, and a placeholder buried two levels down parses no
/// better than one at the top.
fn scrub(
    value: &mut Value,
    path: &str,
    report: &mut DesignHygieneReport,
    demote_reason: &mut Option<String>,
) {
    match value {
        Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            let mut remove: Vec<String> = Vec::new();
            for key in keys {
                let child_path = format!("{path}.{key}");
                let Some(entry) = map.get_mut(&key) else {
                    continue;
                };
                if let Value::String(s) = entry {
                    if !is_unresolved_template(s) {
                        continue;
                    }
                    let raw = s.clone();
                    match rule_for_field(&key) {
                        FieldRule::ReplaceWith(default) => {
                            *entry = Value::String(default.to_string());
                            report.replaced.push(format!(
                                "{child_path}: replaced the unresolved placeholder `{raw}` with the documented default `{default}`"
                            ));
                        }
                        FieldRule::DropField => {
                            remove.push(key.clone());
                            report.dropped_fields.push(format!(
                                "{child_path}: DROPPED — it was the unresolved placeholder `{raw}` and no deterministic default exists for this field"
                            ));
                        }
                        FieldRule::DemoteOwner => {
                            if demote_reason.is_none() {
                                *demote_reason = Some(format!(
                                    "`{child_path}` was the unresolved placeholder `{raw}`, and a trigger cannot be pointed at a guessed target"
                                ));
                            }
                        }
                    }
                } else {
                    scrub(entry, &child_path, report, demote_reason);
                }
            }
            for key in remove {
                map.remove(&key);
            }
        }
        Value::Array(items) => {
            let mut keep: Vec<bool> = Vec::with_capacity(items.len());
            for (i, item) in items.iter_mut().enumerate() {
                let child_path = format!("{path}[{i}]");
                if let Value::String(s) = item {
                    if is_unresolved_template(s) {
                        report.dropped_fields.push(format!(
                            "{child_path}: DROPPED — the list entry was the unresolved placeholder `{s}`"
                        ));
                        keep.push(false);
                        continue;
                    }
                    keep.push(true);
                } else {
                    scrub(item, &child_path, report, demote_reason);
                    keep.push(true);
                }
            }
            let mut i = 0usize;
            items.retain(|_| {
                let k = keep.get(i).copied().unwrap_or(true);
                i += 1;
                k
            });
        }
        _ => {}
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validation::trigger as tv;
    use serde_json::json;

    fn trigger(kind: &str, config: Value) -> AgentIrTrigger {
        AgentIrTrigger {
            trigger_type: Some(kind.to_string()),
            config: Some(config),
            description: Some("a description".to_string()),
            use_case_id: Some("uc_x".to_string()),
        }
    }

    fn ir_with(triggers: Vec<AgentIrTrigger>) -> AgentIr {
        AgentIr {
            triggers,
            ..Default::default()
        }
    }

    /// Assert the trigger's config now passes every validator the promote path
    /// runs — i.e. this build would no longer die on it.
    fn assert_promotable(ir: &AgentIr, idx: usize) {
        let t = &ir.triggers[idx];
        let kind = normalize_trigger_type(t.trigger_type.as_deref().unwrap_or(MANUAL_TRIGGER_TYPE))
            .to_string();
        let config = t
            .config
            .as_ref()
            .map(|c| serde_json::to_string(c).unwrap())
            .unwrap_or_default();
        let config = if config.is_empty() {
            None
        } else {
            Some(config)
        };
        assert!(
            tv::validate_config(&kind, config.as_deref()).is_empty(),
            "validate_config refused {config:?}"
        );
        assert!(
            tv::validate_schedule_has_cron_or_interval(&kind, config.as_deref()).is_empty(),
            "schedule preflight refused {config:?}"
        );
    }

    /// The two strings from bench sweep #17 that each failed a whole build.
    const LIVE_TEMPLATE_FAILURE: &str = "{{param.daily_audit_hour}}";
    const LIVE_SHORTHAND_FAILURE: &str = "daily";

    // -- detection ----------------------------------------------------------

    #[test]
    fn detects_bare_partial_and_spaced_placeholders() {
        assert!(is_unresolved_template(LIVE_TEMPLATE_FAILURE));
        assert!(is_unresolved_template("0 {{param.daily_audit_hour}} * * *"));
        assert!(is_unresolved_template("{{ param.x }}"));
        assert!(is_unresolved_template("{{answers.timezone}}"));
    }

    #[test]
    fn a_real_value_is_not_a_placeholder() {
        assert!(!is_unresolved_template("0 2 * * *"));
        assert!(!is_unresolved_template("Europe/Prague"));
        assert!(!is_unresolved_template(""));
        // Half a delimiter is not a placeholder — no closing pair.
        assert!(!is_unresolved_template("{{ unclosed"));
        assert!(!is_unresolved_template("closed }}"));
        // Ordering matters: the close must follow the open.
        assert!(!is_unresolved_template("}} {{"));
    }

    // -- rule (1): placeholders --------------------------------------------

    #[test]
    fn the_live_template_failure_becomes_the_default_nightly_cron() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": LIVE_TEMPLATE_FAILURE }),
        )]);
        let report = normalize_design_output(&mut ir);

        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron"],
            json!(DEFAULT_NIGHTLY_CRON)
        );
        assert_eq!(report.normalized_count(), 1);
        assert_eq!(report.dropped_count(), 0);
        assert!(report.replaced[0].contains(LIVE_TEMPLATE_FAILURE));
        assert_promotable(&ir, 0);
    }

    #[test]
    fn cron_expression_alias_is_covered_too() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron_expression": "0 {{param.hour}} * * *" }),
        )]);
        normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron_expression"],
            json!(DEFAULT_NIGHTLY_CRON)
        );
        assert_promotable(&ir, 0);
    }

    #[test]
    fn a_templated_timezone_becomes_utc() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": "0 9 * * *", "timezone": "{{param.tz}}" }),
        )]);
        let report = normalize_design_output(&mut ir);
        let config = ir.triggers[0].config.as_ref().unwrap();
        // The real cron was left alone; only the placeholder moved.
        assert_eq!(config["cron"], json!("0 9 * * *"));
        assert_eq!(config["timezone"], json!(DEFAULT_TIMEZONE));
        assert_eq!(report.normalized_count(), 1);
    }

    #[test]
    fn a_templated_numeric_param_is_dropped_not_defaulted() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": "0 9 * * *", "interval_seconds": "{{param.every}}" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert!(ir.triggers[0]
            .config
            .as_ref()
            .unwrap()
            .get("interval_seconds")
            .is_none());
        assert_eq!(report.dropped_fields.len(), 1);
        assert!(report.dropped_fields[0].contains("interval_seconds"));
        assert_promotable(&ir, 0);
    }

    #[test]
    fn a_schedule_stripped_of_its_only_cadence_gets_the_nightly_default() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "interval_seconds": "{{param.every}}" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron"],
            json!(DEFAULT_NIGHTLY_CRON)
        );
        assert_eq!(report.dropped_fields.len(), 1);
        assert_eq!(report.normalized_count(), 1);
        assert_promotable(&ir, 0);
    }

    #[test]
    fn a_templated_webhook_secret_is_dropped_for_ensure_webhook_secrets_to_mint() {
        let mut ir = ir_with(vec![trigger(
            "webhook",
            json!({ "webhook_secret": "{{param.secret}}" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert!(ir.triggers[0]
            .config
            .as_ref()
            .unwrap()
            .get("webhook_secret")
            .is_none());
        assert_eq!(report.dropped_fields.len(), 1);
        // Still a webhook — the kind survives, only the placeholder went.
        assert_eq!(ir.triggers[0].trigger_type.as_deref(), Some("webhook"));
    }

    // -- rule (2): shorthand coercion ---------------------------------------

    #[test]
    fn the_live_shorthand_failure_is_coerced_not_fatal() {
        // `Invalid cron expression: Expected 5 fields, got 1` — the second
        // build sweep #17 lost.
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": LIVE_SHORTHAND_FAILURE }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron"],
            json!(DEFAULT_NIGHTLY_CRON)
        );
        assert_eq!(report.normalized_count(), 1);
        assert_eq!(report.demoted_triggers.len(), 0);
        assert!(report.replaced[0].contains("daily"));
        assert_promotable(&ir, 0);
    }

    #[test]
    fn every_shorthand_expands_to_a_parseable_cron() {
        let cases = [
            ("daily", DEFAULT_NIGHTLY_CRON),
            ("@daily", DEFAULT_NIGHTLY_CRON),
            ("Nightly", DEFAULT_NIGHTLY_CRON),
            ("every day", DEFAULT_NIGHTLY_CRON),
            ("every-day", DEFAULT_NIGHTLY_CRON),
            ("  DAILY  ", DEFAULT_NIGHTLY_CRON),
            ("midnight", MIDNIGHT_CRON),
            ("@midnight", MIDNIGHT_CRON),
            ("hourly", DEFAULT_HOURLY_CRON),
            ("@hourly", DEFAULT_HOURLY_CRON),
            ("every_hour", DEFAULT_HOURLY_CRON),
            ("weekly", DEFAULT_WEEKLY_CRON),
            ("@weekly", DEFAULT_WEEKLY_CRON),
            ("monthly", DEFAULT_MONTHLY_CRON),
            ("@monthly", DEFAULT_MONTHLY_CRON),
            ("yearly", DEFAULT_YEARLY_CRON),
            ("@annually", DEFAULT_YEARLY_CRON),
            ("0", "0 0 * * *"),
            ("9", "0 9 * * *"),
            ("02", "0 2 * * *"),
            ("23", "0 23 * * *"),
        ];
        for (raw, expected) in cases {
            let got = coerce_cron_shorthand(raw)
                .unwrap_or_else(|| panic!("`{raw}` should have been recognised"));
            assert_eq!(got, expected, "`{raw}`");
            assert!(
                parse_cron(&got).is_ok(),
                "`{raw}` expanded to `{got}`, which does not parse"
            );
        }
    }

    #[test]
    fn a_bare_hour_out_of_range_is_not_a_shorthand() {
        assert_eq!(coerce_cron_shorthand("24"), None);
        assert_eq!(coerce_cron_shorthand("99"), None);
        assert_eq!(coerce_cron_shorthand("-1"), None);
    }

    #[test]
    fn a_bare_hour_becomes_that_hour_daily() {
        let mut ir = ir_with(vec![trigger("schedule", json!({ "cron": "7" }))]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron"],
            json!("0 7 * * *")
        );
        assert_eq!(report.normalized_count(), 1);
        assert_promotable(&ir, 0);
    }

    #[test]
    fn shorthand_coercion_covers_the_cron_expression_alias() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron_expression": "@hourly" }),
        )]);
        normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron_expression"],
            json!(DEFAULT_HOURLY_CRON)
        );
        assert_promotable(&ir, 0);
    }

    // -- rule (3): unusable cron drops the trigger, never the build ---------

    #[test]
    fn an_unrecognisable_cron_demotes_the_trigger_and_names_the_raw_value() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": "whenever the report is ready" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].trigger_type.as_deref(),
            Some(MANUAL_TRIGGER_TYPE)
        );
        assert!(ir.triggers[0].config.is_none());
        assert_eq!(report.demoted_triggers.len(), 1);
        assert!(
            report.demoted_triggers[0].contains("whenever the report is ready"),
            "the note must quote what the model actually proposed: {}",
            report.demoted_triggers[0]
        );
        // The capability link and the description survive the demotion.
        assert_eq!(ir.triggers[0].use_case_id.as_deref(), Some("uc_x"));
        assert_promotable(&ir, 0);
    }

    #[test]
    fn a_structurally_broken_cron_demotes_rather_than_failing_the_build() {
        // Three fields, not five — a shape no shorthand rescues.
        let mut ir = ir_with(vec![trigger("schedule", json!({ "cron": "* * *" }))]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].trigger_type.as_deref(),
            Some(MANUAL_TRIGGER_TYPE)
        );
        assert_eq!(report.demoted_triggers.len(), 1);
        assert_promotable(&ir, 0);
    }

    #[test]
    fn a_human_authored_bad_cron_is_still_refused_by_the_validator() {
        // The leniency is scoped to the build path — this pass never runs on
        // the trigger commands, and the validator they call is unchanged.
        let errors = tv::validate_config("schedule", Some(r#"{"cron": "daily"}"#));
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].field, "config.cron");
        assert_eq!(errors[0].rule, "cron");

        let errors = tv::validate_config("schedule", Some(r#"{"cron": "* * *"}"#));
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].rule, "cron");
    }

    // -- timezone -----------------------------------------------------------

    #[test]
    fn an_unresolvable_timezone_becomes_utc() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": "0 9 * * *", "timezone": "local" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["timezone"],
            json!(DEFAULT_TIMEZONE)
        );
        assert_eq!(report.normalized_count(), 1);
        assert!(report.replaced[0].contains("local"));
    }

    #[test]
    fn a_real_iana_zone_is_left_alone() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": "0 9 * * *", "timezone": "Europe/Prague" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert!(report.is_empty(), "{report:?}");
    }

    // -- demotion of non-schedule kinds -------------------------------------

    #[test]
    fn a_templated_polling_url_demotes_the_trigger_to_manual() {
        let mut ir = ir_with(vec![trigger(
            "polling",
            json!({ "url": "https://{{param.host}}/audit", "interval_seconds": 300 }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].trigger_type.as_deref(),
            Some(MANUAL_TRIGGER_TYPE)
        );
        assert!(ir.triggers[0].config.is_none());
        assert_eq!(report.demoted_triggers.len(), 1);
        assert_eq!(report.normalized_count(), 0);
        assert_eq!(ir.triggers[0].use_case_id.as_deref(), Some("uc_x"));
        assert_eq!(ir.triggers[0].description.as_deref(), Some("a description"));
    }

    #[test]
    fn a_templated_event_type_demotes_the_listener() {
        let mut ir = ir_with(vec![trigger(
            "event_listener",
            json!({ "event_type": "{{param.event}}" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].trigger_type.as_deref(),
            Some(MANUAL_TRIGGER_TYPE)
        );
        assert_eq!(report.demoted_triggers.len(), 1);
    }

    #[test]
    fn a_templated_trigger_type_demotes_the_trigger() {
        let mut ir = ir_with(vec![trigger(
            "{{param.kind}}",
            json!({ "cron": "0 2 * * *" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].trigger_type.as_deref(),
            Some(MANUAL_TRIGGER_TYPE)
        );
        assert_eq!(report.demoted_triggers.len(), 1);
    }

    #[test]
    fn a_polling_trigger_stripped_of_its_interval_is_demoted() {
        let mut ir = ir_with(vec![trigger(
            "polling",
            json!({ "url": "https://audit.test/x", "interval_seconds": "{{param.every}}" }),
        )]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(
            ir.triggers[0].trigger_type.as_deref(),
            Some(MANUAL_TRIGGER_TYPE)
        );
        assert_eq!(report.demoted_triggers.len(), 1);
    }

    #[test]
    fn demotion_keeps_the_positional_alignment_with_use_cases() {
        let mut ir = ir_with(vec![
            trigger("schedule", json!({ "cron": "0 6 * * *" })),
            trigger("schedule", json!({ "cron": "sometimes" })),
            trigger("schedule", json!({ "cron": "0 7 * * *" })),
        ]);
        normalize_design_output(&mut ir);
        assert_eq!(ir.triggers.len(), 3, "no trigger may leave the array");
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron"],
            json!("0 6 * * *")
        );
        assert_eq!(
            ir.triggers[1].trigger_type.as_deref(),
            Some(MANUAL_TRIGGER_TYPE)
        );
        assert_eq!(
            ir.triggers[2].config.as_ref().unwrap()["cron"],
            json!("0 7 * * *")
        );
    }

    // -- the untouched paths ------------------------------------------------

    #[test]
    fn a_real_cron_passes_through_untouched() {
        let mut ir = ir_with(vec![trigger(
            "schedule",
            json!({ "cron": "*/15 * * * *", "timezone": "Europe/Prague" }),
        )]);
        let before = ir.triggers[0].config.clone();
        let report = normalize_design_output(&mut ir);
        assert!(report.is_empty(), "{report:?}");
        assert_eq!(ir.triggers[0].config, before);
    }

    #[test]
    fn a_jenkins_h_cron_the_runtime_accepts_is_untouched() {
        let mut ir = ir_with(vec![trigger("schedule", json!({ "cron": "H/15 * * * *" }))]);
        let report = normalize_design_output(&mut ir);
        assert!(report.is_empty(), "{report:?}");
        assert_eq!(
            ir.triggers[0].config.as_ref().unwrap()["cron"],
            json!("H/15 * * * *")
        );
    }

    #[test]
    fn an_untouched_schedule_with_no_cadence_keeps_its_pre_existing_refusal() {
        // No placeholder, no bad cron — the pass must not "helpfully" invent a
        // cadence and turn a long-standing validation failure into a silent
        // nightly job.
        let mut ir = ir_with(vec![trigger("schedule", json!({}))]);
        let report = normalize_design_output(&mut ir);
        assert!(report.is_empty());
        let config = serde_json::to_string(ir.triggers[0].config.as_ref().unwrap()).unwrap();
        assert_eq!(
            tv::validate_schedule_has_cron_or_interval("schedule", Some(&config)).len(),
            1
        );
    }

    #[test]
    fn a_use_case_with_no_trigger_suggestion_is_already_manual() {
        // The `missing_field=suggested_trigger` case: the design pass emitted no
        // trigger for the capability at all. There is nothing to scrub, and the
        // absent `trigger_type` already reads as `manual` everywhere downstream
        // (`create_triggers_in_tx`, `build_persona_setup`).
        let mut ir = ir_with(vec![AgentIrTrigger::default()]);
        let report = normalize_design_output(&mut ir);
        assert!(report.is_empty());
        assert!(ir.triggers[0].trigger_type.is_none());
        assert_eq!(
            normalize_trigger_type(
                ir.triggers[0]
                    .trigger_type
                    .as_deref()
                    .unwrap_or(MANUAL_TRIGGER_TYPE)
            ),
            MANUAL_TRIGGER_TYPE
        );
    }

    #[test]
    fn an_ir_with_no_triggers_is_a_no_op() {
        let mut ir = AgentIr::default();
        assert!(normalize_design_output(&mut ir).is_empty());
    }

    // -- nesting, events, idempotence --------------------------------------

    #[test]
    fn nested_objects_and_arrays_are_scrubbed() {
        let mut ir = ir_with(vec![trigger(
            "composite",
            json!({
                "window_seconds": 300,
                "members": [
                    { "cron": "{{param.a}}" },
                    "{{param.b}}",
                    "keep_me"
                ]
            }),
        )]);
        let report = normalize_design_output(&mut ir);
        let config = ir.triggers[0].config.as_ref().unwrap();
        assert_eq!(config["members"][0]["cron"], json!(DEFAULT_NIGHTLY_CRON));
        assert_eq!(config["members"].as_array().unwrap().len(), 2);
        assert_eq!(config["members"][1], json!("keep_me"));
        assert_eq!(report.normalized_count(), 1);
        assert_eq!(report.dropped_fields.len(), 1);
    }

    #[test]
    fn a_templated_event_type_drops_the_event_subscription() {
        let mut ir = AgentIr {
            events: vec![
                crate::models::agent_ir::AgentIrEvent {
                    event_type: Some("{{param.event}}".into()),
                    source_filter: None,
                    direction: Some("subscribe".into()),
                },
                crate::models::agent_ir::AgentIrEvent {
                    event_type: Some("audit.completed".into()),
                    source_filter: Some("{{param.source}}".into()),
                    direction: Some("subscribe".into()),
                },
            ],
            ..Default::default()
        };
        let report = normalize_design_output(&mut ir);
        assert_eq!(ir.events.len(), 1);
        assert_eq!(ir.events[0].event_type.as_deref(), Some("audit.completed"));
        assert!(ir.events[0].source_filter.is_none());
        assert_eq!(report.dropped_events.len(), 1);
        assert_eq!(report.dropped_fields.len(), 1);
    }

    #[test]
    fn the_pass_is_idempotent() {
        let mut ir = ir_with(vec![
            trigger("schedule", json!({ "cron": LIVE_TEMPLATE_FAILURE })),
            trigger("schedule", json!({ "cron": LIVE_SHORTHAND_FAILURE })),
            trigger("schedule", json!({ "cron": "no idea" })),
            trigger("polling", json!({ "url": "{{param.host}}" })),
        ]);
        let first = normalize_design_output(&mut ir);
        assert!(!first.is_empty());
        let second = normalize_design_output(&mut ir);
        assert!(second.is_empty(), "{second:?}");
    }

    // -- the report ---------------------------------------------------------

    #[test]
    fn the_report_counts_and_names_everything_it_did() {
        let mut ir = ir_with(vec![
            trigger("schedule", json!({ "cron": LIVE_TEMPLATE_FAILURE })),
            trigger("schedule", json!({ "cron": "@weekly" })),
            trigger("polling", json!({ "url": "{{param.host}}" })),
            trigger(
                "webhook",
                json!({ "webhook_secret": "{{param.s}}", "smee_channel_url": "{{param.u}}" }),
            ),
        ]);
        let report = normalize_design_output(&mut ir);
        assert_eq!(report.normalized_count(), 2);
        assert_eq!(report.dropped_fields.len(), 2);
        assert_eq!(report.demoted_triggers.len(), 1);
        assert_eq!(report.dropped_count(), 3);
        assert_eq!(report.notes().len(), 5);
        assert!(report.summary().contains("2 field(s) normalized"));
        assert!(report.summary().contains("1 trigger(s) demoted"));
    }

    #[test]
    fn every_rule_target_is_covered_by_rule_for_field() {
        assert_eq!(
            rule_for_field("CRON"),
            FieldRule::ReplaceWith(DEFAULT_NIGHTLY_CRON)
        );
        assert_eq!(
            rule_for_field(" timezone "),
            FieldRule::ReplaceWith(DEFAULT_TIMEZONE)
        );
        assert_eq!(rule_for_field("endpoint"), FieldRule::DemoteOwner);
        assert_eq!(rule_for_field("listen_event_type"), FieldRule::DemoteOwner);
        assert_eq!(rule_for_field("interval_seconds"), FieldRule::DropField);
        assert_eq!(rule_for_field("anything_else"), FieldRule::DropField);
    }
}
