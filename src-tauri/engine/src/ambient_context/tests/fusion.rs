use super::super::*;

#[test]
fn test_push_and_snapshot() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 42);
    fusion.push_file_change("modify", &["src/main.rs".to_string()]);
    fusion.push_app_focus("Code.exe", "main.rs — personas");

    let snap = fusion.snapshot_for_persona("test-persona");
    assert!(snap.enabled);
    assert_eq!(snap.signals.len(), 3);
    assert_eq!(snap.active_app.as_deref(), Some("Code.exe"));
}

#[test]
fn test_policy_filtering() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            clipboard: false,
            file_changes: true,
            app_focus: false,
            ..Default::default()
        },
    );
    fusion.push_clipboard("text", 10);
    fusion.push_file_change("create", &["test.ts".to_string()]);

    let snap = fusion.snapshot_for_persona("p1");
    assert_eq!(snap.signals.len(), 1);
    assert_eq!(snap.signals[0].source, "file_watcher");
}

#[test]
fn test_focus_app_filter() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            focus_app_filter: vec!["Code.exe".to_string()],
            ..Default::default()
        },
    );

    fusion.push_app_focus("chrome.exe", "Google");
    fusion.push_clipboard("text", 5);

    let snap = fusion.snapshot_for_persona("p1");
    // Chrome doesn't match the filter, so signals should be empty
    assert!(snap.signals.is_empty());
    assert!(snap.active_app.is_none());

    // Now focus VS Code
    fusion.push_app_focus("Code.exe", "main.rs");
    fusion.push_file_change("modify", &["app.tsx".to_string()]);

    let snap = fusion.snapshot_for_persona("p1");
    assert!(snap.signals.len() >= 2);
    assert_eq!(snap.active_app.as_deref(), Some("Code.exe"));
}

#[test]
fn test_disabled() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.set_enabled(false);
    fusion.push_clipboard("text", 10);
    let snap = fusion.snapshot_for_persona("any");
    assert!(!snap.enabled);
    assert!(snap.signals.is_empty());
}

#[test]
fn test_window_eviction() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.default_policy.max_window_size = 5;
    for i in 0..10 {
        fusion.push_clipboard("text", i * 10);
    }
    // Should have at most 5 signals
    assert!(fusion.signals.len() <= 5);
}

#[test]
fn test_connector_evidence_ranks_newest_first() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    // Oldest first: a slack-named file, then a github-named file.
    // raw_paths survive verbatim (no redaction), so matching is stable.
    fusion.push_file_change("create", &["C:/work/slack-notes.md".to_string()]);
    fusion.push_file_change("modify", &["C:/work/github-issues.json".to_string()]);

    let keywords = vec![
        "github".to_string(),
        "slack".to_string(),
        "notion".to_string(),
    ];
    let ev = fusion.connector_evidence(&keywords);
    // github is the most recent signal → ranked first; slack present;
    // notion never appears, so it's absent.
    assert_eq!(ev, vec!["github".to_string(), "slack".to_string()]);
}

#[test]
fn test_connector_evidence_empty_when_disabled_or_no_match() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_file_change("modify", &["C:/work/github-issues.json".to_string()]);
    // No matching keyword → empty.
    assert!(fusion
        .connector_evidence(&["dropbox".to_string()])
        .is_empty());
    // Master switch off → empty regardless of signals.
    fusion.set_enabled(false);
    assert!(fusion
        .connector_evidence(&["github".to_string()])
        .is_empty());
}

#[test]
fn test_file_glob_filter() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            file_changes: true,
            file_glob_filter: vec!["*.rs".to_string(), "src/**/*.tsx".to_string()],
            ..Default::default()
        },
    );

    // Should match *.rs
    fusion.push_file_change("modify", &["main.rs".to_string()]);
    // Should match src/**/*.tsx
    fusion.push_file_change("modify", &["src/components/App.tsx".to_string()]);
    // Should NOT match — .rst is not .rs
    fusion.push_file_change("modify", &["report.rst".to_string()]);
    // Should NOT match — .json doesn't match either glob
    fusion.push_file_change("modify", &["version.json".to_string()]);

    let snap = fusion.snapshot_for_persona("p1");
    let summaries: Vec<&str> = snap.signals.iter().map(|s| s.summary.as_str()).collect();

    assert!(
        summaries.iter().any(|s| s.contains("main.rs")),
        "main.rs should match *.rs"
    );
    assert!(
        summaries.iter().any(|s| s.contains("App.tsx")),
        "src/components/App.tsx should match src/**/*.tsx"
    );
    assert!(
        !summaries.iter().any(|s| s.contains("report.rst")),
        "report.rst should NOT match *.rs"
    );
    assert!(
        !summaries.iter().any(|s| s.contains("version.json")),
        "version.json should NOT match any glob"
    );
}

#[test]
fn test_buffer_adapts_to_registered_policies() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    // Register two personas with small windows
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            max_window_size: 5,
            ..Default::default()
        },
    );
    fusion.set_policy(
        "p2".to_string(),
        SensoryPolicy {
            max_window_size: 8,
            ..Default::default()
        },
    );
    // Push 20 signals — more than either persona needs
    for i in 0..20 {
        fusion.push_clipboard("text", i * 10);
    }
    // Global buffer should be clamped to max(5, 8) = 8, not default 30
    assert!(
        fusion.signals.len() <= 8,
        "buffer should adapt to registered policies, got {}",
        fusion.signals.len()
    );
}

#[test]
fn test_snapshot_clamps_to_persona_window_size() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    // p1 wants a small window, p2 a larger one
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            max_window_size: 3,
            ..Default::default()
        },
    );
    fusion.set_policy(
        "p2".to_string(),
        SensoryPolicy {
            max_window_size: 10,
            ..Default::default()
        },
    );
    for i in 0..15 {
        fusion.push_clipboard("text", i * 10);
    }
    // p1 should receive at most 3 signals
    let snap1 = fusion.snapshot_for_persona("p1");
    assert!(
        snap1.signals.len() <= 3,
        "p1 (max_window_size=3) received {} signals",
        snap1.signals.len()
    );
    // p2 should receive at most 10 signals
    let snap2 = fusion.snapshot_for_persona("p2");
    assert!(
        snap2.signals.len() <= 10,
        "p2 (max_window_size=10) received {} signals",
        snap2.signals.len()
    );
}

#[test]
fn test_buffer_uses_default_when_no_policies() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    // No persona policies registered — should fall back to default (30)
    for i in 0..35 {
        fusion.push_clipboard("text", i * 10);
    }
    assert!(
        fusion.signals.len() <= 30,
        "buffer should use default max when no policies registered, got {}",
        fusion.signals.len()
    );
}

#[test]
fn test_buffer_shrinks_after_policy_update() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    // Start with a large window
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            max_window_size: 20,
            ..Default::default()
        },
    );
    for i in 0..20 {
        fusion.push_clipboard("text", i * 10);
    }
    assert_eq!(fusion.signals.len(), 20);

    // Shrink p1's window — next push should evict down
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            max_window_size: 5,
            ..Default::default()
        },
    );
    fusion.push_clipboard("text", 999);
    assert!(
        fusion.signals.len() <= 5,
        "buffer should shrink after policy update, got {}",
        fusion.signals.len()
    );
}

// ── Per-source gate (Phase 2 v1) ──────────────────────────────────────

#[test]
fn new_starts_with_all_sources_off() {
    // Privacy contract: a fresh fusion has every per-source gate OFF
    // until the user opts in. This is the default-off promise.
    let fusion = AmbientContextFusion::new();
    assert!(!fusion.is_source_enabled("clipboard"));
    assert!(!fusion.is_source_enabled("file_watcher"));
    assert!(!fusion.is_source_enabled("app_focus"));
    // Master switch defaults on (the kill-switch shape — present but
    // rarely toggled). Per-source gates carry the privacy guarantee.
    assert!(fusion.is_enabled());
}

#[test]
fn push_skips_when_per_source_gate_off() {
    let mut fusion = AmbientContextFusion::new(); // all sources OFF
    fusion.push_clipboard("text", 100);
    fusion.push_file_change("modify", &["a.rs".to_string()]);
    fusion.push_app_focus("Code.exe", "main.rs");
    assert_eq!(fusion.signals.len(), 0);
    assert_eq!(fusion.total_captured, 0);
}

#[test]
fn push_captures_when_per_source_gate_on() {
    let mut fusion = AmbientContextFusion::new();
    fusion.set_source_enabled("clipboard", true);
    fusion.push_clipboard("text", 50);
    // file_watcher + app_focus still OFF
    fusion.push_file_change("modify", &["a.rs".to_string()]);
    fusion.push_app_focus("Code.exe", "main.rs");
    assert_eq!(fusion.signals.len(), 1, "only clipboard should land");
    assert_eq!(fusion.signals[0].source, "clipboard");
}

#[test]
fn disable_source_purges_prior_signals() {
    let mut fusion = AmbientContextFusion::new_for_tests(); // all on
    fusion.push_clipboard("text", 10);
    fusion.push_clipboard("text", 20);
    fusion.push_app_focus("Code.exe", "main.rs");
    assert_eq!(fusion.signals.len(), 3);
    // Disable clipboard — its signals must be purged.
    let purged = fusion.set_source_enabled("clipboard", false);
    assert_eq!(purged, 2, "should purge 2 clipboard signals");
    assert_eq!(fusion.signals.len(), 1);
    assert_eq!(fusion.signals[0].source, "app_focus");
}

#[test]
fn disable_app_focus_clears_current_state() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_app_focus("Code.exe", "main.rs");
    assert!(fusion.current_app.is_some());
    assert!(fusion.current_window_title.is_some());
    fusion.set_source_enabled("app_focus", false);
    assert!(
        fusion.current_app.is_none(),
        "current_app should clear on app_focus disable"
    );
    assert!(
        fusion.current_window_title.is_none(),
        "current_window_title should clear on app_focus disable"
    );
}

#[test]
fn enable_source_does_not_replay_signals() {
    let mut fusion = AmbientContextFusion::new(); // OFF
    fusion.push_clipboard("text", 10); // dropped
    fusion.set_source_enabled("clipboard", true); // late opt-in
                                                  // Enabling AFTER a push must NOT replay the dropped signal —
                                                  // the user said "start now," not "include the past."
    assert_eq!(fusion.signals.len(), 0);
}

#[test]
fn unknown_source_name_fails_closed() {
    let mut fusion = AmbientContextFusion::new();
    // Unknown sources read as false (don't capture) and the setter
    // is a no-op (doesn't add a new field).
    assert!(!fusion.is_source_enabled("nonsense"));
    let purged = fusion.set_source_enabled("nonsense", true);
    assert_eq!(purged, 0);
    assert!(!fusion.is_source_enabled("nonsense"));
}

#[test]
fn source_state_reports_per_source_counts() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 10);
    fusion.push_clipboard("text", 20);
    fusion.push_file_change("modify", &["a.rs".to_string()]);
    let state = fusion.source_state();
    assert!(state.global_enabled);
    assert!(state.clipboard_enabled);
    assert!(state.file_changes_enabled);
    assert!(state.app_focus_enabled);
    assert_eq!(state.clipboard_signals_in_window, 2);
    assert_eq!(state.file_changes_signals_in_window, 1);
    assert_eq!(state.app_focus_signals_in_window, 0);
    assert_eq!(state.total_signals_captured, 3);
}

// ── list_signals + delete_signal (Phase 2 v3) ─────────────────────────

#[test]
fn each_signal_gets_a_unique_stable_id() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 10);
    fusion.push_clipboard("text", 20);
    fusion.push_file_change("modify", &["a.rs".to_string()]);
    let ids: Vec<String> = fusion.signals.iter().map(|s| s.id.clone()).collect();
    assert_eq!(ids, vec!["sig_0", "sig_1", "sig_2"]);
    // Counter is monotonic across pushes; ids never reused.
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!(unique.len(), 3);
}

#[test]
fn list_signals_returns_newest_first() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 10);
    fusion.push_clipboard("text", 20);
    fusion.push_clipboard("text", 30);
    let listed = fusion.list_signals(None, 10);
    assert_eq!(listed.len(), 3);
    // Newest (sig_2) first.
    assert_eq!(listed[0].id, "sig_2");
    assert_eq!(listed[2].id, "sig_0");
}

#[test]
fn list_signals_filters_by_source() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 10);
    fusion.push_file_change("modify", &["a.rs".to_string()]);
    fusion.push_app_focus("Code.exe", "main.rs");
    let clipboard = fusion.list_signals(Some("clipboard"), 10);
    assert_eq!(clipboard.len(), 1);
    assert_eq!(clipboard[0].source, "clipboard");
    let app = fusion.list_signals(Some("app_focus"), 10);
    assert_eq!(app.len(), 1);
    assert_eq!(app[0].source, "app_focus");
}

#[test]
fn list_signals_respects_limit() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    for i in 0..5 {
        fusion.push_clipboard("text", i * 10);
    }
    let listed = fusion.list_signals(None, 3);
    assert_eq!(listed.len(), 3);
    // Newest 3.
    assert_eq!(listed[0].id, "sig_4");
    assert_eq!(listed[2].id, "sig_2");
}

#[test]
fn delete_signal_removes_target() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 10);
    fusion.push_clipboard("text", 20);
    fusion.push_clipboard("text", 30);
    let removed = fusion.delete_signal("sig_1");
    assert!(removed);
    assert_eq!(fusion.signals.len(), 2);
    let remaining_ids: Vec<&str> = fusion.signals.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(remaining_ids, vec!["sig_0", "sig_2"]);
}

#[test]
fn delete_signal_returns_false_for_unknown_id() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 10);
    // Idempotent: calling twice on a non-existent id is safe.
    assert!(!fusion.delete_signal("sig_999"));
    assert!(!fusion.delete_signal("sig_999"));
    assert_eq!(fusion.signals.len(), 1);
}

#[test]
fn delete_signal_after_eviction_returns_false() {
    // Simulate an already-evicted signal: capture, evict by setting a
    // tiny window cap via policy, then attempt to delete the original.
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard("text", 10); // sig_0
                                       // Force eviction by registering a 0-size policy and pushing more.
    fusion.set_policy(
        "p1".to_string(),
        SensoryPolicy {
            max_window_size: 1,
            ..Default::default()
        },
    );
    fusion.push_clipboard("text", 20); // sig_1 — pushes sig_0 out
                                       // sig_0 has been evicted; delete is a no-op.
    assert!(!fusion.delete_signal("sig_0"));
    assert!(fusion.delete_signal("sig_1"));
}

#[test]
fn push_clipboard_with_content_redacts_before_storing() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_clipboard_with_content(
        "text",
        "ghp_SuperSecretGitHubToken123456789012345 — please don't store this",
    );
    assert_eq!(fusion.signals.len(), 1);
    let stored = fusion.signals[0].redacted_content.as_deref();
    assert!(stored.is_some());
    let stored = stored.unwrap();
    assert!(stored.contains("[REDACTED:github-token]"));
    assert!(!stored.contains("ghp_SuperSecretGitHubToken123456789012345"));
}

#[test]
fn push_clipboard_with_content_skips_when_gate_off() {
    let mut fusion = AmbientContextFusion::new(); // clipboard gate OFF
    fusion.push_clipboard_with_content("text", "any content");
    assert_eq!(fusion.signals.len(), 0);
}

#[test]
fn push_clipboard_summary_uses_raw_length_not_redacted_length() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    let raw = "x".repeat(2000);
    fusion.push_clipboard_with_content("text", &raw);
    // Summary shows the original 2000-char length so the user sees
    // what was actually pasted, even though stored content is capped.
    assert!(fusion.signals[0].summary.contains("2000 chars"));
}

// ── push_app_focus redaction (Phase 2 v1) ──────────────────────────────

#[test]
fn push_app_focus_redacts_before_storing() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_app_focus(
        "Word.exe",
        "C:\\Users\\foo\\Documents\\Confidential proposal.docx — Word",
    );
    // The stored signal summary AND current_window_title must both be redacted.
    assert!(fusion
        .current_window_title
        .as_ref()
        .map(|t| !t.contains("C:\\Users"))
        .unwrap_or(false));
    assert_eq!(fusion.signals.len(), 1);
    assert!(!fusion.signals[0].summary.contains("C:\\Users"));
}
