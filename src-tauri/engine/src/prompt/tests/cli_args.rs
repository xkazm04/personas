use super::super::cli_args::DEFAULT_EFFORT;
use super::super::*;
use super::test_persona;
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
    let args = build_resume_cli_args("sess-resume-1");
    assert!(args.args.contains(&"--effort".to_string()));
    assert!(args.args.contains(&DEFAULT_EFFORT.to_string()));
    assert!(args.args.contains(&"--resume".to_string()));
    assert!(args.args.contains(&"sess-resume-1".to_string()));
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
    let args = build_resume_cli_args("sess-non-essential-1");
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
    let args = build_resume_cli_args("sess-1");
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

    let resumed = build_resume_cli_args("sess-1");
    for key in expected {
        assert!(
            resumed.env_removals.iter().any(|k| k == key),
            "build_resume_cli_args must strip {key} from child env"
        );
    }
}
