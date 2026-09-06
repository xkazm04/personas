use super::super::cli_args::DEFAULT_EFFORT;
use super::super::*;
use super::test_persona;
use personas_core::model_ids;
use personas_core::types::ModelProfile;

#[test]
fn test_cli_args_base_flags() {
    let persona = test_persona();
    let args = build_cli_args(Some(&persona), None);

    // Check base flags are present
    assert!(args.args.contains(&"-p".to_string()));
    assert!(args.args.contains(&"-".to_string()));
    assert!(args.args.contains(&"--output-format".to_string()));
    assert!(args.args.contains(&"stream-json".to_string()));
    assert!(args.args.contains(&"--verbose".to_string()));
    assert!(args
        .args
        .contains(&"--dangerously-skip-permissions".to_string()));
    assert!(args
        .args
        .contains(&"--exclude-dynamic-system-prompt-sections".to_string()));

    // Effort is locked to medium by default to avoid the CLI 2.1.94
    // tier-dependent default drift.
    assert!(args.args.contains(&"--effort".to_string()));
    assert!(args.args.contains(&DEFAULT_EFFORT.to_string()));

    // Platform-specific command. On Windows, `claude_cli_invocation`
    // prefers a directly-resolved `claude.exe` (immune to a missing/
    // broken `claude.cmd` shim) and only falls back to the legacy
    // `cmd /C claude.cmd` when no real exe is found on this machine —
    // so the expectation has to branch on that same resolution rather
    // than assume the legacy path is always taken.
    #[cfg(windows)]
    {
        if let Some(exe) = crate::cli_process::resolve_claude_exe_windows() {
            assert_eq!(args.command, exe);
        } else {
            assert_eq!(args.command, "cmd");
            assert!(args.args.contains(&"/C".to_string()));
            assert!(args.args.contains(&"claude.cmd".to_string()));
        }
    }
    #[cfg(not(windows))]
    {
        assert_eq!(args.command, "claude");
    }
}

#[test]
fn test_cli_args_with_model() {
    let profile = ModelProfile {
        model: Some("claude-sonnet-4-20250514".into()),
        ..Default::default()
    };
    let args = build_cli_args(None, Some(&profile));

    assert!(args.args.contains(&"--model".to_string()));
    assert!(args.args.contains(&"claude-sonnet-4-20250514".to_string()));
}

#[test]
fn test_cli_args_effort_override() {
    let profile = ModelProfile {
        effort: Some("high".into()),
        ..Default::default()
    };
    let args = build_cli_args(None, Some(&profile));

    // The override should be present, not the default.
    assert!(args.args.contains(&"--effort".to_string()));
    assert!(args.args.contains(&"high".to_string()));
    // Sanity: only one --effort flag was pushed
    let effort_count = args.args.iter().filter(|a| *a == "--effort").count();
    assert_eq!(effort_count, 1, "exactly one --effort flag expected");
}

#[test]
fn test_cli_args_effort_blank_falls_back_to_default() {
    let profile = ModelProfile {
        effort: Some("   ".into()),
        ..Default::default()
    };
    let args = build_cli_args(None, Some(&profile));

    assert!(args.args.contains(&"--effort".to_string()));
    assert!(args.args.contains(&DEFAULT_EFFORT.to_string()));
}

#[test]
fn test_resume_cli_args_pins_effort() {
    let args = build_resume_cli_args("sess-resume-1", None);
    assert!(args.args.contains(&"--effort".to_string()));
    assert!(args.args.contains(&DEFAULT_EFFORT.to_string()));
    assert!(args.args.contains(&"--resume".to_string()));
    assert!(args.args.contains(&"sess-resume-1".to_string()));
    // No profile means no decision to carry, so no --model either.
    assert!(
        !args.args.contains(&"--model".to_string()),
        "a profileless resume must not invent a model"
    );
}

/// The regression this file used to certify. `test_resume_cli_args_pins_effort`
/// passes a `None` profile, so `DEFAULT_EFFORT` is the right answer and the test
/// was green while the resume path pushed the constant UNCONDITIONALLY — the
/// pin the comment above it promised did not exist. Assert against a profile
/// that asks for something other than the default, which is the only input that
/// can tell a pin from a constant.
#[test]
fn resume_cli_args_carry_the_profile_effort_not_the_constant() {
    let profile = ModelProfile {
        effort: Some("high".into()),
        ..Default::default()
    };
    let args = build_resume_cli_args("sess-resume-effort", Some(&profile));

    let effort = flag_value(&args.args, "--effort");
    assert_eq!(
        effort.as_deref(),
        Some("high"),
        "resume must use resolve_effort(profile), not DEFAULT_EFFORT"
    );
    assert_ne!(effort.as_deref(), Some(DEFAULT_EFFORT));
    assert_eq!(
        args.args.iter().filter(|a| *a == "--effort").count(),
        1,
        "exactly one --effort flag expected"
    );
}

/// The model half of the same defect: the decision was computed and discarded,
/// so a resumed run reverted to the CLI's account default. Fresh and resume
/// must agree on the model for the same profile.
#[test]
fn resume_cli_args_carry_the_decided_model() {
    let profile = ModelProfile {
        model: Some(model_ids::DEFAULT_STRONG.into()),
        effort: Some("low".into()),
        ..Default::default()
    };
    let resumed = build_resume_cli_args("sess-resume-model", Some(&profile));
    let fresh = build_cli_args(None, Some(&profile));

    assert_eq!(
        flag_value(&resumed.args, "--model").as_deref(),
        Some(model_ids::DEFAULT_STRONG)
    );
    assert_eq!(
        flag_value(&resumed.args, "--model"),
        flag_value(&fresh.args, "--model"),
        "fresh and resumed runs must be spawned on the same model"
    );
    assert_eq!(
        flag_value(&resumed.args, "--effort"),
        flag_value(&fresh.args, "--effort"),
        "fresh and resumed runs must be spawned on the same effort"
    );
    assert_eq!(
        args_after_resume_flag(&resumed.args),
        Some("sess-resume-model".to_string())
    );
}

/// An empty model string is not a model. The fresh path already treats it that
/// way; the resume path must not emit a bare `--model` with nothing after it,
/// which the CLI rejects.
#[test]
fn resume_cli_args_emit_no_model_for_an_empty_string() {
    let profile = ModelProfile {
        model: Some("".into()),
        ..Default::default()
    };
    let args = build_resume_cli_args("sess-resume-empty", Some(&profile));
    assert!(!args.args.contains(&"--model".to_string()));
}

/// The three call sites that reach the resume path all funnel through the
/// provider trait's `build_resume_args`, which the runner calls with the SAME
/// `candidate_profile` the fresh branch passes to `build_execution_args` — so
/// the fix is at one seam and covers healing, the scheduled `api_error_resume`
/// drain, and the warm pool alike. Assert the seam itself: the trait method
/// forwards the profile, for both prompt-delivery shapes.
#[test]
fn provider_resume_seam_forwards_the_profile_to_the_argv() {
    use crate::provider::{resolve_provider, CliProvider};
    use personas_core::engine_kind::EngineKind;

    let profile = ModelProfile {
        model: Some(model_ids::DEFAULT_FAST.into()),
        effort: Some("high".into()),
        ..Default::default()
    };
    let provider: Box<dyn CliProvider> = resolve_provider(EngineKind::ClaudeCode);

    for args in [
        provider.build_resume_args("sess-seam", Some(&profile)),
        provider.build_resume_args_with_prompt("sess-seam", Some(&profile), "go on"),
    ] {
        assert_eq!(
            flag_value(&args.args, "--model").as_deref(),
            Some(model_ids::DEFAULT_FAST)
        );
        assert_eq!(flag_value(&args.args, "--effort").as_deref(), Some("high"));
    }
}

/// Read the value that follows `flag`, so a test cannot pass on a value that
/// happens to appear somewhere else in the argv (which `contains` allows).
fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn args_after_resume_flag(args: &[String]) -> Option<String> {
    flag_value(args, "--resume")
}

#[test]
fn test_cli_args_with_budget() {
    let mut persona = test_persona();
    persona.max_budget_usd = Some(1.5);

    let args = build_cli_args(Some(&persona), None);

    assert!(args.args.contains(&"--max-budget-usd".to_string()));
    assert!(args.args.contains(&"1.5".to_string()));
}

#[test]
fn test_cli_args_with_max_turns() {
    let mut persona = test_persona();
    persona.max_turns = Some(10);

    let args = build_cli_args(Some(&persona), None);

    assert!(args.args.contains(&"--max-turns".to_string()));
    assert!(args.args.contains(&"10".to_string()));
}

#[test]
fn test_cli_args_default_no_persona() {
    let args = build_cli_args(None, None);

    // Should produce same base flags as with persona
    assert!(args.args.contains(&"-p".to_string()));
    assert!(args.args.contains(&"--verbose".to_string()));
    // No persona-specific flags
    assert!(!args.args.contains(&"--max-budget-usd".to_string()));
    assert!(!args.args.contains(&"--max-turns".to_string()));
    // No API_TIMEOUT_MS without a persona
    assert!(
        !args
            .env_overrides
            .iter()
            .any(|(k, _)| k == "API_TIMEOUT_MS"),
        "API_TIMEOUT_MS should not be set without a persona"
    );
}

#[test]
fn test_cli_args_api_timeout_from_persona() {
    let mut persona = test_persona();
    persona.timeout_ms = 60_000; // 60 seconds

    let args = build_cli_args(Some(&persona), None);

    let timeout_env = args
        .env_overrides
        .iter()
        .find(|(k, _)| k == "API_TIMEOUT_MS");
    assert!(timeout_env.is_some(), "API_TIMEOUT_MS should be set");
    // 60000 - 5000 = 55000
    assert_eq!(timeout_env.unwrap().1, "55000");
}

#[test]
fn test_cli_args_api_timeout_floor() {
    let mut persona = test_persona();
    persona.timeout_ms = 8_000; // below 10s + 5s buffer

    let args = build_cli_args(Some(&persona), None);

    let timeout_env = args
        .env_overrides
        .iter()
        .find(|(k, _)| k == "API_TIMEOUT_MS");
    assert!(timeout_env.is_some());
    // 8000 - 5000 = 3000, but floored to 10000
    assert_eq!(timeout_env.unwrap().1, "10000");
}

#[test]
fn test_cli_args_api_timeout_zero_skipped() {
    let mut persona = test_persona();
    persona.timeout_ms = 0;

    let args = build_cli_args(Some(&persona), None);

    assert!(
        !args
            .env_overrides
            .iter()
            .any(|(k, _)| k == "API_TIMEOUT_MS"),
        "API_TIMEOUT_MS should not be set when timeout_ms is 0"
    );
}

#[test]
fn test_cli_args_nonessential_traffic_suppression() {
    let args = build_cli_args(None, None);
    for key in [
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
        "CLAUDE_CODE_DISABLE_TERMINAL_TITLE",
        "DISABLE_UPDATES",
        "CLAUDE_CODE_HIDE_CWD",
    ] {
        let entry = args.env_overrides.iter().find(|(k, _)| k == key);
        assert!(
            entry.is_some(),
            "{key} must be set in env_overrides to suppress nonessential CLI traffic"
        );
        assert_eq!(entry.unwrap().1, "1");
    }
}

#[test]
fn test_resume_cli_args_nonessential_traffic_suppression() {
    let args = build_resume_cli_args("sess-non-essential-1", None);
    for key in [
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
        "CLAUDE_CODE_DISABLE_TERMINAL_TITLE",
        "DISABLE_UPDATES",
        "CLAUDE_CODE_HIDE_CWD",
    ] {
        let entry = args.env_overrides.iter().find(|(k, _)| k == key);
        assert!(
            entry.is_some(),
            "{key} must be set on resume too so continued sessions stay privacy-positive"
        );
        assert_eq!(entry.unwrap().1, "1");
    }
}

#[test]
fn test_resume_cli_args_has_exclude_dynamic() {
    let args = build_resume_cli_args("sess-1", None);
    assert!(args
        .args
        .contains(&"--exclude-dynamic-system-prompt-sections".to_string()));
}

#[test]
fn test_cli_args_strips_disable_prompt_caching_env() {
    // Both build_cli_args and build_resume_cli_args must strip the
    // DISABLE_PROMPT_CACHING* variants that CLI 2.1.108 warns about so
    // personas executions always get caching regardless of parent-shell
    // env state.
    let expected = [
        "DISABLE_PROMPT_CACHING",
        "DISABLE_PROMPT_CACHING_1H",
        "DISABLE_PROMPT_CACHING_5M",
    ];

    let fresh = build_cli_args(None, None);
    for key in expected {
        assert!(
            fresh.env_removals.iter().any(|k| k == key),
            "build_cli_args must strip {key} from child env"
        );
    }

    let resumed = build_resume_cli_args("sess-1", None);
    for key in expected {
        assert!(
            resumed.env_removals.iter().any(|k| k == key),
            "build_resume_cli_args must strip {key} from child env"
        );
    }
}

// -- Per-persona tool roster -------------------------------------------------
//
// The measurable behind these: before this landed, EVERY persona spawn carried
// Claude Code's full default roster because no persona had ever been given
// `--allowedTools`. The two assertions that matter are (a) an undeclared
// persona is byte-for-byte unchanged, and (b) a declared one narrows.

#[test]
fn undeclared_persona_still_gets_no_allowed_tools_flag() {
    let persona = test_persona();
    let args = build_cli_args(Some(&persona), None);
    assert!(
        !args.args.contains(&"--allowedTools".to_string()),
        "an undeclared persona must spawn exactly as it did before the roster existed"
    );
}

#[test]
fn declared_roster_becomes_one_comma_joined_allowed_tools_flag() {
    let mut persona = test_persona();
    persona.parameters =
        Some(r#"[{"key":"allowed_tools","value":["Read","Grep","Bash"]}]"#.to_string());
    let args = build_cli_args(Some(&persona), None);

    let idx = args
        .args
        .iter()
        .position(|a| a == "--allowedTools")
        .expect("declared roster should emit --allowedTools");
    // ONE argv element, not three — the value must not be able to split into
    // extra flags.
    assert_eq!(args.args[idx + 1], "Read,Grep,Bash");
}

#[test]
fn an_invalid_roster_entry_falls_back_to_the_unbounded_default() {
    let mut persona = test_persona();
    persona.parameters = Some(
        r#"[{"key":"allowed_tools","value":["Read","--dangerously-skip-permissions"]}]"#
            .to_string(),
    );
    let args = build_cli_args(Some(&persona), None);
    assert!(
        !args.args.contains(&"--allowedTools".to_string()),
        "a roster that cannot be trusted must not be applied as if it were narrower than it is"
    );
    // And it must not have leaked the entry onto the command line either.
    assert_eq!(
        args.args
            .iter()
            .filter(|a| *a == "--dangerously-skip-permissions")
            .count(),
        1,
        "only the base flag, never a roster-smuggled copy"
    );
}
