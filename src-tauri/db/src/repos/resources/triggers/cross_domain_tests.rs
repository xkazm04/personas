#[cfg(test)]
mod tests {
    // The pre-split module reached these through `use super::*` when every name
    // lived in one file. `super` is now this test module's own parent, so the
    // same names are pulled in explicitly through the tree's re-export root.
    use crate::init_test_db;
    use crate::models::{CreateTriggerInput, UpdateTriggerInput};
    use crate::repos::resources::triggers::*;
    use crate::repos::test_fixtures;
    use crate::DbPool;
    use personas_core::crypto;
    use personas_core::error::AppError;
    use rusqlite::params;

    fn create_test_persona(pool: &DbPool) -> crate::models::Persona {
        test_fixtures::create_test_persona(pool, "Trigger Test Agent", "You handle triggers.")
    }

    // -- "not born dead": creation either arms the trigger or refuses by name --

    /// The four kinds the `CHECK` used to reject — every one of which the
    /// Add-trigger menu offered, all six quick templates targeted, and the
    /// engine has always had a dispatch loop for.
    #[test]
    fn every_trigger_kind_in_the_menu_can_actually_be_stored() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // One minimally-valid config per kind. `schedule`/`polling` must arm,
        // so they carry timing; the rest are woken by something else.
        let cases: &[(personas_core::models::TriggerKind, Option<&str>)] = &[
            (personas_core::models::TriggerKind::Manual, None),
            (
                personas_core::models::TriggerKind::Schedule,
                Some(r#"{"cron":"0 9 * * *"}"#),
            ),
            (
                personas_core::models::TriggerKind::Polling,
                // A public IP LITERAL, deliberately: `validate_polling_url`
                // resolves hostnames, and a unit test must not depend on DNS.
                // (TEST-NET ranges are rejected as documentation addresses.)
                Some(r#"{"url":"https://93.184.216.34/feed","interval_seconds":300}"#),
            ),
            (
                personas_core::models::TriggerKind::Webhook,
                Some(r#"{"webhook_secret":"abc123"}"#),
            ),
            (personas_core::models::TriggerKind::Chain, Some("{}")),
            (
                personas_core::models::TriggerKind::EventListener,
                Some(r#"{"listen_event_type":"demo.event"}"#),
            ),
            (
                personas_core::models::TriggerKind::FileWatcher,
                Some(r#"{"watch_paths":["/tmp"],"events":["create"]}"#),
            ),
            (
                personas_core::models::TriggerKind::Clipboard,
                Some(r#"{"content_type":"text","interval_seconds":5}"#),
            ),
            (
                personas_core::models::TriggerKind::AppFocus,
                Some(r#"{"interval_seconds":3}"#),
            ),
            (
                personas_core::models::TriggerKind::Composite,
                Some(
                    r#"{"conditions":[{"event_type":"a"},{"event_type":"b"}],"operator":"AND","window_seconds":300}"#,
                ),
            ),
        ];
        assert_eq!(
            cases.len(),
            personas_core::models::TriggerKind::ALL.len(),
            "a TriggerKind was added without a storability case here"
        );

        for (kind, config) in cases {
            let created = create(
                &pool,
                CreateTriggerInput {
                    persona_id: persona.id.clone(),
                    trigger_type: kind.as_str().to_string(),
                    config: config.map(String::from),
                    enabled: Some(true),
                    use_case_id: None,
                },
            )
            .unwrap_or_else(|e| panic!("{} could not be stored: {e}", kind.as_str()));
            assert_eq!(created.trigger_type, kind.as_str());
            assert_eq!(created.status, "active");
            assert!(created.enabled);
            if kind.is_time_based() {
                assert!(
                    created.next_trigger_at.is_some(),
                    "{} was created without a next fire time",
                    kind.as_str()
                );
            }
        }
    }

    /// The whole point: a creation that would produce a row `get_due` can never
    /// return is refused, and the refusal names the reason.
    #[test]
    fn creating_an_unschedulable_time_based_trigger_is_refused_by_name() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let attempt = |trigger_type: &str, config: Option<&str>| {
            create(
                &pool,
                CreateTriggerInput {
                    persona_id: persona.id.clone(),
                    trigger_type: trigger_type.to_string(),
                    config: config.map(String::from),
                    enabled: Some(true),
                    use_case_id: None,
                },
            )
        };

        // A schedule with an unresolvable timezone — the `"local"` sentinel
        // that put 16 rows on the operator's install into a permanent NULL.
        let err = attempt(
            "schedule",
            Some(r#"{"cron":"0 9 * * *","timezone":"local"}"#),
        )
        .expect_err("a schedule that cannot be armed must be refused");
        let msg = err.to_string();
        assert!(
            msg.contains(personas_core::validation::trigger::UNSCHEDULABLE_PREFIX),
            "refusal did not use the registry-matchable prefix: {msg}"
        );
        assert!(
            msg.contains("local"),
            "refusal did not name the value: {msg}"
        );

        // A schedule with no timing at all.
        assert!(attempt("schedule", Some("{}")).is_err());
        assert!(attempt("schedule", None).is_err());

        // Polling with a URL but no interval — nothing would ever fetch it.
        assert!(attempt("polling", Some(r#"{"url":"https://93.184.216.34/feed"}"#)).is_err());

        // Nothing was written by any of the refusals.
        assert!(get_by_persona_id(&pool, &persona.id).unwrap().is_empty());

        // …and the kinds that legitimately have no next fire time are NOT
        // refused: a NULL there is correct, not a defect.
        assert!(attempt("manual", None).is_ok());
        assert!(attempt("chain", Some("{}")).is_ok());
    }

    /// `enabled` and `status` are two encodings of one fact; the badge reads
    /// one and both dispatch predicates read the other. Duplication used to
    /// write them contradicting each other on every copied row.
    #[test]
    fn duplication_does_not_produce_enabled_status_drift() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);
        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 9 * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let (copy, _summary) = crate::repos::core::personas::duplicate(&pool, &persona.id).unwrap();
        for t in get_by_persona_id(&pool, &copy.id).unwrap() {
            assert_eq!(
                t.enabled,
                t.status == "active",
                "copied trigger {} reads {:?} to the UI and {:?} to the dispatcher",
                t.id,
                t.enabled,
                t.status
            );
        }
    }

    /// Exhaustive classification gate for `AUTO_LISTENER_SOURCE_TYPES`.
    ///
    /// The const itself is a `&[&str]`, so Rust can't exhaustiveness-check
    /// it at compile time. This test does it at *test* time: every entry in
    /// `VALID_TRIGGER_TYPES` is forced through a `match` with no wildcard
    /// arm. Adding a new trigger type without a corresponding arm trips the
    /// `panic!()` and the test fails with a directive pointing at the
    /// policy doc on `AUTO_LISTENER_SOURCE_TYPES`. The next contributor
    /// can't ship a trigger that publishes events nothing listens for —
    /// the bug Fix 4a was created to prevent.
    #[test]
    fn auto_listener_policy_covers_every_trigger_type() {
        use personas_core::validation::trigger::VALID_TRIGGER_TYPES;

        enum Decision {
            Auto,
            NoListener(&'static str),
        }

        let classify = |t: &str| -> Decision {
            match t {
                // Auto-listener: publishes events into the bus, doesn't
                // self-listen, no other code registers a paired listener.
                "schedule" => Decision::Auto,
                "polling" => Decision::Auto,
                "webhook" => Decision::Auto,

                // No listener — each carries an explicit reason:
                "manual" => {
                    Decision::NoListener("user-initiated; firing is direct, no event published")
                }
                "chain" => Decision::NoListener(
                    "downstream of another execution; the upstream's listener \
                     owns the wakeup",
                ),
                "event_listener" => Decision::NoListener(
                    "IS the listener side; pairing it with another listener would loop",
                ),
                "file_watcher" => Decision::NoListener(
                    "OS-level filesystem watcher publishes into its own native \
                     callback, not the event bus",
                ),
                "clipboard" => Decision::NoListener(
                    "OS-level clipboard event source; no event-bus publication",
                ),
                "app_focus" => {
                    Decision::NoListener("OS-level focus event source; no event-bus publication")
                }
                "composite" => Decision::NoListener(
                    "aggregates other triggers; pairings are owned by the inner triggers",
                ),

                other => panic!(
                    "unclassified trigger type {other:?} — adding a new entry to \
                     VALID_TRIGGER_TYPES requires deciding whether it needs a paired \
                     auto-listener. See the membership policy on \
                     AUTO_LISTENER_SOURCE_TYPES."
                ),
            }
        };

        for &t in VALID_TRIGGER_TYPES {
            let in_set = AUTO_LISTENER_SOURCE_TYPES.contains(&t);
            match classify(t) {
                Decision::Auto => assert!(
                    in_set,
                    "policy classifies {t:?} as auto-listener but it is missing \
                     from AUTO_LISTENER_SOURCE_TYPES — add it to the const"
                ),
                Decision::NoListener(reason) => assert!(
                    !in_set,
                    "policy classifies {t:?} as no-listener (reason: {reason}) but \
                     it is *present* in AUTO_LISTENER_SOURCE_TYPES — remove it from \
                     the const or update the policy"
                ),
            }
        }

        // Belt-and-suspenders: every entry in AUTO_LISTENER_SOURCE_TYPES must
        // also exist in VALID_TRIGGER_TYPES (catches drift if a string in the
        // const is renamed/removed without updating the registry).
        for &t in AUTO_LISTENER_SOURCE_TYPES {
            assert!(
                VALID_TRIGGER_TYPES.contains(&t),
                "AUTO_LISTENER_SOURCE_TYPES contains {t:?} which is not a valid \
                 trigger type — registry drift"
            );
        }
    }

    #[test]
    fn test_crud_triggers() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(trigger.trigger_type, "schedule");
        assert!(trigger.enabled);
        assert_eq!(trigger.persona_id, persona.id);

        // Get by ID
        let fetched = get_by_id(&pool, &trigger.id).unwrap();
        assert_eq!(fetched.config, Some(r#"{"cron":"0 * * * *"}"#.into()));

        // List by persona — since Fix 4a, creating a `schedule` trigger also
        // creates a paired `event_listener` auto-listener. Assert on the
        // source trigger type count, not the raw total.
        let list = get_by_persona_id(&pool, &persona.id).unwrap();
        let schedule_count = list.iter().filter(|t| t.trigger_type == "schedule").count();
        assert_eq!(schedule_count, 1);

        // Update
        let updated = update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: None,
                config: Some(r#"{"cron":"*/5 * * * *"}"#.into()),
                enabled: Some(false),
                next_trigger_at: None,
            },
        )
        .unwrap();
        assert!(!updated.enabled);
        assert_eq!(updated.config, Some(r#"{"cron":"*/5 * * * *"}"#.into()));

        // Delete
        let deleted = delete(&pool, &trigger.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &trigger.id).is_err());
    }

    #[test]
    fn test_get_due_and_mark_triggered() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create a trigger with a past next_trigger_at. The config carries a
        // cron because `create` now REFUSES a schedule it cannot arm — this
        // fixture used to pass `None`, i.e. it constructed exactly the
        // born-dead row the door now rejects.
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Set next_trigger_at to a past time
        let past = "2020-01-01T00:00:00+00:00";
        update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: None,
                config: None,
                enabled: None,
                next_trigger_at: Some(Some(past.into())),
            },
        )
        .unwrap();

        // Should appear in due list
        let now = chrono::Utc::now().to_rfc3339();
        let due = get_due(&pool, &now).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, trigger.id);

        // Mark triggered with a future next_trigger_at (CAS: version = 0 for fresh trigger)
        let future = "2099-12-31T23:59:59+00:00";
        mark_triggered(&pool, &trigger.id, Some(future.into()), 0).unwrap();

        // Should no longer be due (next_trigger_at is in the future)
        let due_after = get_due(&pool, &now).unwrap();
        assert_eq!(due_after.len(), 0);

        // Verify last_triggered_at was set
        let refreshed = get_by_id(&pool, &trigger.id).unwrap();
        assert!(refreshed.last_triggered_at.is_some());
        assert_eq!(refreshed.next_trigger_at, Some(future.into()));
    }

    #[test]
    fn test_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent-id");
        assert!(result.is_err());
    }

    #[test]
    fn test_mark_triggered_deleted_trigger() {
        let pool = init_test_db().unwrap();

        // mark_triggered on a nonexistent ID should return Ok(false)
        let result = mark_triggered(&pool, "nonexistent-id", None, 0).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_invalid_trigger_type_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "invalid_type".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_interval_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":0}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_valid_interval_accepted() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":3600}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_schedule_trigger_initializes_next_trigger_at() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // next_trigger_at must be set so the scheduler loop picks it up
        assert!(
            trigger.next_trigger_at.is_some(),
            "schedule trigger must have next_trigger_at initialized on create"
        );
    }

    #[test]
    fn test_create_polling_trigger_initializes_next_trigger_at() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "polling".into(),
                config: Some(r#"{"interval_seconds":300}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert!(
            trigger.next_trigger_at.is_some(),
            "polling trigger must have next_trigger_at initialized on create"
        );
    }

    #[test]
    fn test_create_manual_trigger_next_trigger_at_is_null() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert!(
            trigger.next_trigger_at.is_none(),
            "manual trigger should have no next_trigger_at"
        );
    }

    #[test]
    fn test_null_interval_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":null}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_create_chain_rejects_malformed_json_config() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "chain".into(),
                config: Some("{not-json".into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("Chain trigger config is not valid JSON"),
                    "expected JSON-parse validation error, got: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {other:?}"),
        }
    }

    #[test]
    fn test_update_chain_rejects_malformed_json_config() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Seed a valid chain trigger we can target with a bad-config update.
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "chain".into(),
                config: Some(r#"{"source_persona_id":"some-other-persona"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let result = update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: None,
                config: Some("not-json".into()),
                enabled: None,
                next_trigger_at: None,
            },
        );
        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("Chain trigger config is not valid JSON")
                        || msg.contains("Invalid config JSON"),
                    "expected JSON-parse validation error, got: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {other:?}"),
        }
    }

    #[test]
    fn test_update_rejects_invalid_trigger_type() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let result = update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: Some("bogus".into()),
                config: None,
                enabled: None,
                next_trigger_at: None,
            },
        );
        assert!(result.is_err());
    }

    // ========================================================================
    // S3: Builder link/unlink integration tests
    // ========================================================================

    fn read_structured_prompt(pool: &DbPool, persona_id: &str) -> serde_json::Value {
        let conn = pool.get().unwrap();
        let sp: Option<String> = conn
            .query_row(
                "SELECT structured_prompt FROM personas WHERE id = ?1",
                params![persona_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        sp.as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null)
    }

    #[test]
    fn test_s3_link_creates_trigger_and_handler() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = link_persona_to_event(
            &pool,
            &persona.id,
            "stock.signal.strong_buy",
            None, // use default handler
            None, // persona-wide
        )
        .unwrap();

        // Trigger created with correct type + advisory metadata
        assert_eq!(trigger.trigger_type, "event_listener");
        assert_eq!(trigger.persona_id, persona.id);
        assert!(trigger.enabled);

        let decrypted = crypto::decrypt_trigger_config(trigger.config.as_deref().unwrap()).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(
            cfg.get("listen_event_type").unwrap().as_str().unwrap(),
            "stock.signal.strong_buy"
        );
        assert_eq!(cfg.get("_managed_by").unwrap().as_str().unwrap(), "builder");
        assert_eq!(
            cfg.get("_handler_key").unwrap().as_str().unwrap(),
            "stock.signal.strong_buy"
        );

        // Persona structured_prompt patched with eventHandlers entry
        let sp = read_structured_prompt(&pool, &persona.id);
        let handler = sp
            .get("eventHandlers")
            .and_then(|h| h.get("stock.signal.strong_buy"))
            .and_then(|v| v.as_str())
            .expect("handler entry should exist");
        assert!(handler.contains("stock.signal.strong_buy"));
        // identity should be carried over from system_prompt since original had no structured_prompt
        let identity = sp
            .get("identity")
            .and_then(|v| v.as_str())
            .expect("identity should be seeded from system_prompt");
        assert!(identity.contains("triggers"));
    }

    #[test]
    fn test_s3_link_with_custom_handler_text() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);
        let custom = "Compose a Slack DM with ticker and signal strength.";

        link_persona_to_event(
            &pool,
            &persona.id,
            "stock.signal.strong_buy",
            Some(custom),
            None,
        )
        .unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        let handler = sp
            .get("eventHandlers")
            .and_then(|h| h.get("stock.signal.strong_buy"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(handler, custom);
    }

    #[test]
    fn test_s3_unlink_removes_both_trigger_and_handler() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger =
            link_persona_to_event(&pool, &persona.id, "stock.signal.strong_buy", None, None)
                .unwrap();

        // Verify both exist
        assert!(get_by_id(&pool, &trigger.id).is_ok());
        let sp = read_structured_prompt(&pool, &persona.id);
        assert!(sp
            .get("eventHandlers")
            .and_then(|h| h.get("stock.signal.strong_buy"))
            .is_some());

        // Unlink
        unlink_persona_from_event(&pool, &trigger.id).unwrap();

        // Both gone
        assert!(get_by_id(&pool, &trigger.id).is_err());
        let sp_after = read_structured_prompt(&pool, &persona.id);
        assert!(
            sp_after
                .get("eventHandlers")
                .and_then(|h| h.get("stock.signal.strong_buy"))
                .is_none(),
            "handler should be removed after unlink"
        );
    }

    #[test]
    fn test_s3_unlink_preserves_other_handlers() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let t1 = link_persona_to_event(&pool, &persona.id, "event.one", None, None).unwrap();
        let _t2 = link_persona_to_event(&pool, &persona.id, "event.two", None, None).unwrap();

        unlink_persona_from_event(&pool, &t1.id).unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        let handlers = sp.get("eventHandlers").unwrap().as_object().unwrap();
        assert!(!handlers.contains_key("event.one"));
        assert!(handlers.contains_key("event.two"));
    }

    #[test]
    fn test_s3_link_rejects_empty_event_type() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = link_persona_to_event(&pool, &persona.id, "", None, None);
        assert!(result.is_err());

        let result2 = link_persona_to_event(&pool, &persona.id, "   ", None, None);
        assert!(result2.is_err());
    }

    #[test]
    fn test_s5_initialize_event_handlers_is_idempotent() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Pre-existing event_listener trigger WITHOUT a Builder-managed flag
        // (simulates template-created or manual trigger)
        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "event_listener".into(),
                config: Some(r#"{"listen_event_type":"legacy.event"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // First call seeds the handler
        let created = initialize_event_handlers_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(created, 1);

        let sp = read_structured_prompt(&pool, &persona.id);
        assert!(sp
            .get("eventHandlers")
            .and_then(|h| h.get("legacy.event"))
            .is_some());

        // Second call is a no-op
        let created2 = initialize_event_handlers_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(created2, 0);
    }

    #[test]
    fn test_s6_update_persona_event_handler() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create with default handler
        link_persona_to_event(&pool, &persona.id, "my.event", None, None).unwrap();

        // Refine it
        let refined = "Refined handler: pull ticker from payload and alert.";
        update_persona_event_handler(&pool, &persona.id, "my.event", refined).unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        let text = sp
            .get("eventHandlers")
            .and_then(|h| h.get("my.event"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(text, refined);
    }

    #[test]
    fn test_s3_link_preserves_existing_structured_prompt_fields() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Seed persona with an existing structured_prompt
        {
            let conn = pool.get().unwrap();
            let sp = serde_json::json!({
                "identity": "I am a test persona.",
                "instructions": "Do test things.",
                "toolGuidance": "Use test tools."
            });
            conn.execute(
                "UPDATE personas SET structured_prompt = ?1 WHERE id = ?2",
                params![sp.to_string(), persona.id],
            )
            .unwrap();
        }

        link_persona_to_event(&pool, &persona.id, "test.event", None, None).unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        // Original fields preserved
        assert_eq!(
            sp.get("identity").and_then(|v| v.as_str()).unwrap(),
            "I am a test persona."
        );
        assert_eq!(
            sp.get("instructions").and_then(|v| v.as_str()).unwrap(),
            "Do test things."
        );
        assert_eq!(
            sp.get("toolGuidance").and_then(|v| v.as_str()).unwrap(),
            "Use test tools."
        );
        // New handler added
        assert!(sp
            .get("eventHandlers")
            .and_then(|h| h.get("test.event"))
            .is_some());
    }

    // ========================================================================
    // Fix 1 + Fix 2: orphan cleanup
    // ========================================================================

    #[test]
    fn test_fix1_delete_orphaned_triggers_skips_live_personas() {
        let pool = init_test_db().unwrap();
        let live_persona = create_test_persona(&pool);

        // Live persona's trigger should survive
        let live_trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: live_persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Insert an orphan referencing a non-existent persona. FK is enforced
        // per-connection, so temporarily disable it on this connection to
        // simulate a pre-FK-enforcement install where orphans accumulated
        // (which is what the user's production DB looked like).
        {
            let conn = pool.get().unwrap();
            let _guard = crate::FkDisabledGuard::new(&conn).unwrap();
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('orphan-1', 'ghost-persona', 'schedule', '{}', 1, 'active', NULL, '2026-01-01', '2026-01-01')",
                [],
            )
            .unwrap();
        }

        let deleted = delete_orphaned_triggers(&pool).unwrap();
        assert_eq!(deleted, 1, "should delete exactly the one orphan");

        // Live trigger still there
        assert!(get_by_id(&pool, &live_trigger.id).is_ok());
        assert!(get_by_id(&pool, "orphan-1").is_err());
    }

    #[test]
    fn test_fix1_delete_orphaned_triggers_cascades_auto_listeners() {
        let pool = init_test_db().unwrap();

        // Create an orphaned source trigger + matching auto-listener directly
        // (simulates a trigger whose persona got deleted while the trigger +
        // its Fix 4a auto-listener lingered). Needs FK disabled because the
        // persona doesn't exist.
        {
            let conn = pool.get().unwrap();
            let _guard = crate::FkDisabledGuard::new(&conn).unwrap();
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('orphan-src', 'ghost', 'schedule', '{\"cron\":\"0 * * * *\"}', 1, 'active', NULL, '2026-01-01', '2026-01-01')",
                [],
            )
            .unwrap();
            // Auto-listener with the advisory pointer — unencrypted so json_extract works
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('orphan-listener', 'ghost', 'event_listener',
                   '{\"listen_event_type\":\"trigger_fired\",\"source_filter\":\"orphan-src\",\"_auto_for_trigger\":\"orphan-src\"}',
                   1, 'active', NULL, '2026-01-01', '2026-01-01')",
                [],
            )
            .unwrap();
        }

        let deleted = delete_orphaned_triggers(&pool).unwrap();
        // Both the source AND the listener should be gone: source via the
        // orphan loop, listener via the cascade pass inside the loop.
        assert_eq!(deleted, 2);
        assert!(get_by_id(&pool, "orphan-src").is_err());
        assert!(get_by_id(&pool, "orphan-listener").is_err());
    }

    // ========================================================================
    // Fix 4a: auto-listener wiring
    // ========================================================================

    #[test]
    fn test_fix4a_create_schedule_also_creates_auto_listener() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let src = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"*/15 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Find the auto-listener by querying triggers for this persona
        let listeners = get_by_persona_id(&pool, &persona.id).unwrap();
        let auto_listener = listeners
            .iter()
            .find(|t| t.trigger_type == "event_listener")
            .expect("should have created an auto-listener");

        // Decrypt and inspect its config
        let decrypted =
            crypto::decrypt_trigger_config(auto_listener.config.as_deref().unwrap()).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(
            cfg.get("listen_event_type")
                .and_then(|v| v.as_str())
                .unwrap(),
            "trigger_fired",
            "default event_type should be trigger_fired",
        );
        assert_eq!(
            cfg.get("source_filter").and_then(|v| v.as_str()).unwrap(),
            src.id.as_str(),
            "source_filter should be the source trigger id"
        );
        assert_eq!(
            cfg.get("_auto_for_trigger")
                .and_then(|v| v.as_str())
                .unwrap(),
            src.id.as_str(),
            "_auto_for_trigger advisory must match source id"
        );
    }

    #[test]
    fn test_fix4a_create_schedule_uses_custom_event_type() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *","event_type":"morning_digest"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let listeners = get_by_persona_id(&pool, &persona.id).unwrap();
        let auto_listener = listeners
            .iter()
            .find(|t| t.trigger_type == "event_listener")
            .unwrap();
        let decrypted =
            crypto::decrypt_trigger_config(auto_listener.config.as_deref().unwrap()).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(
            cfg.get("listen_event_type")
                .and_then(|v| v.as_str())
                .unwrap(),
            "morning_digest",
        );
    }

    #[test]
    fn test_fix4a_manual_trigger_skips_auto_listener() {
        // Manual / event_listener / chain triggers should NOT get auto-listeners
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let listeners = get_by_persona_id(&pool, &persona.id).unwrap();
        let event_listeners = listeners
            .iter()
            .filter(|t| t.trigger_type == "event_listener")
            .count();
        assert_eq!(
            event_listeners, 0,
            "manual triggers should not auto-create listeners"
        );
    }

    #[test]
    fn test_fix4a_delete_auto_listeners_for() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let src = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 0 * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Confirm listener exists
        let listeners_before: Vec<_> = get_by_persona_id(&pool, &persona.id)
            .unwrap()
            .into_iter()
            .filter(|t| t.trigger_type == "event_listener")
            .collect();
        assert_eq!(listeners_before.len(), 1);

        // Cascade delete
        let removed = delete_auto_listeners_for(&pool, &src.id).unwrap();
        assert_eq!(removed, 1);

        let listeners_after: Vec<_> = get_by_persona_id(&pool, &persona.id)
            .unwrap()
            .into_iter()
            .filter(|t| t.trigger_type == "event_listener")
            .collect();
        assert_eq!(listeners_after.len(), 0);
    }

    #[test]
    fn test_fix4a_backfill_creates_missing_only() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create a source trigger via a raw INSERT to simulate a pre-Fix-4a
        // trigger that never got its auto-listener.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('pre-fix-src', ?1, 'schedule', '{\"cron\":\"0 * * * *\"}', 1, 'active', NULL, '2026-01-01', '2026-01-01')",
                params![persona.id],
            ).unwrap();
        }

        let (scanned, created) = backfill_auto_listeners(&pool).unwrap();
        assert_eq!(scanned, 1);
        assert_eq!(created, 1);

        // Second call should be a no-op
        let (scanned2, created2) = backfill_auto_listeners(&pool).unwrap();
        assert_eq!(scanned2, 1);
        assert_eq!(created2, 0, "backfill must be idempotent");
    }

    #[test]
    fn test_fix4a_backfill_respects_existing_auto_listener() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Creating via create() produces both rows
        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Backfill finds the source but skips listener creation
        let (scanned, created) = backfill_auto_listeners(&pool).unwrap();
        assert_eq!(scanned, 1);
        assert_eq!(created, 0);
    }

    // ========================================================================
    // rename_event_type
    // ========================================================================

    use crate::models::CreatePersonaEventInput;
    use crate::repos::communication::events as event_repo;

    /// Helper: insert a persona_event_subscriptions row directly via SQL so we
    /// can verify the rename rewrites it, without going through the full
    /// create_subscription_with_trigger dual-write.
    fn insert_subscription(pool: &DbPool, persona_id: &str, event_type: &str) -> String {
        let conn = pool.get().unwrap();
        let sub_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO persona_event_subscriptions
             (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, NULL, 1, NULL, ?4, ?4)",
            params![sub_id, persona_id, event_type, now],
        )
        .unwrap();
        sub_id
    }

    /// Helper: seed the persona with an eventHandlers entry via direct SQL.
    fn seed_handler(pool: &DbPool, persona_id: &str, event_type: &str, text: &str) {
        let sp = serde_json::json!({
            "identity": "Test identity.",
            "instructions": "Do things.",
            "eventHandlers": { event_type: text }
        })
        .to_string();
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE personas SET structured_prompt = ?1 WHERE id = ?2",
            params![sp, persona_id],
        )
        .unwrap();
    }

    /// Helper: read structured_prompt + return eventHandlers object.
    fn read_handlers(pool: &DbPool, persona_id: &str) -> serde_json::Value {
        let conn = pool.get().unwrap();
        let sp: Option<String> = conn
            .query_row(
                "SELECT structured_prompt FROM personas WHERE id = ?1",
                params![persona_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        sp.as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| v.get("eventHandlers").cloned())
            .unwrap_or(serde_json::Value::Null)
    }

    #[test]
    fn test_rename_happy_path_updates_every_store() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // 1. Historical persona_event (source_type: 'trigger' + source_id required
        //    to satisfy validators). The exact values don't matter; only the
        //    event_type column is what we're renaming.
        event_repo::publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "stock.alert.old_name".into(),
                source_type: "trigger".into(),
                source_id: Some("fake-trigger-id".into()),
                target_persona_id: None,
                project_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // 2. Legacy subscription row
        insert_subscription(&pool, &persona.id, "stock.alert.old_name");

        // 3. Trigger publisher: create a schedule trigger with custom event_type.
        //    This ALSO creates a Fix 4a auto-listener with the matching
        //    listen_event_type, which is a second trigger row we expect the
        //    rename to rewrite.
        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(
                    r#"{"cron":"*/15 * * * *","event_type":"stock.alert.old_name"}"#.into(),
                ),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // 4. S3 link_persona_to_event creates another event_listener with the
        //    _handler_key advisory set to the event_type.
        link_persona_to_event(
            &pool,
            &persona.id,
            "stock.alert.old_name",
            Some("Handle old name."),
            None,
        )
        .unwrap();

        // 5. Persona handler entry — already seeded by the S3 link above.
        //    Confirm it's there before rename.
        let before = read_handlers(&pool, &persona.id);
        assert!(before.get("stock.alert.old_name").is_some());

        // ── Rename ──
        let result =
            rename_event_type(&pool, "stock.alert.old_name", "stock.alert.new_name").unwrap();

        assert_eq!(
            result.events_updated, 1,
            "historical events should be rewritten"
        );
        assert_eq!(
            result.subscriptions_updated, 1,
            "legacy subs should be rewritten"
        );
        assert_eq!(
            result.trigger_publishers_updated, 1,
            "the schedule trigger's config.event_type should be rewritten",
        );
        assert!(
            result.trigger_listeners_updated >= 2,
            "both the Fix 4a auto-listener AND the S3 link_persona event_listener should be rewritten",
        );
        assert_eq!(
            result.handler_keys_updated, 1,
            "the S3 _handler_key advisory should be rewritten",
        );
        assert_eq!(result.persona_handlers_updated, 1);

        // ── Verify: nothing references the old name anymore ──
        assert!(!event_type_in_use(&pool, "stock.alert.old_name").unwrap());
        assert!(event_type_in_use(&pool, "stock.alert.new_name").unwrap());

        // structured_prompt eventHandlers key was moved
        let after = read_handlers(&pool, &persona.id);
        assert!(after.get("stock.alert.old_name").is_none());
        assert_eq!(
            after
                .get("stock.alert.new_name")
                .and_then(|v| v.as_str())
                .unwrap(),
            "Handle old name.",
            "handler text is preserved verbatim, only the key name changes",
        );
    }

    #[test]
    fn test_rename_rejects_empty_names() {
        let pool = init_test_db().unwrap();
        assert!(rename_event_type(&pool, "", "new").is_err());
        assert!(rename_event_type(&pool, "old", "").is_err());
        assert!(rename_event_type(&pool, "   ", "new").is_err());
    }

    #[test]
    fn test_rename_rejects_same_name() {
        let pool = init_test_db().unwrap();
        let err = rename_event_type(&pool, "same", "same").unwrap_err();
        assert!(format!("{err:?}").contains("identical"));
    }

    #[test]
    fn test_rename_rejects_reserved_source() {
        let pool = init_test_db().unwrap();
        for reserved in RESERVED_EVENT_TYPES {
            let err = rename_event_type(&pool, reserved, "my_custom_name").unwrap_err();
            assert!(
                format!("{err:?}").contains("reserved"),
                "expected reserved-name error for {reserved}, got {err:?}",
            );
        }
    }

    #[test]
    fn test_rename_rejects_reserved_target() {
        let pool = init_test_db().unwrap();
        let err = rename_event_type(&pool, "some_custom_event", "trigger_fired").unwrap_err();
        assert!(format!("{err:?}").contains("reserved"));
    }

    #[test]
    fn test_rename_rejects_invalid_format() {
        let pool = init_test_db().unwrap();
        // Starts with a digit? That's actually fine per the validator (alnum).
        // Starts with a dot? Not allowed.
        let err = rename_event_type(&pool, "old_name", ".leading.dot").unwrap_err();
        assert!(format!("{err:?}").contains("invalid characters"));
        // Contains a space? Not allowed.
        let err2 = rename_event_type(&pool, "old_name", "has space").unwrap_err();
        assert!(format!("{err2:?}").contains("invalid characters"));
    }

    #[test]
    fn test_rename_rejects_collision() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Seed an existing stream under the target name.
        insert_subscription(&pool, &persona.id, "already.exists");

        let err = rename_event_type(&pool, "old_name", "already.exists").unwrap_err();
        assert!(format!("{err:?}").contains("already in use"));
    }

    #[test]
    fn test_rename_no_op_when_old_has_no_references() {
        // Renaming an event type that isn't referenced anywhere should succeed
        // with zero counts across the board (it's idempotent — nothing breaks).
        let pool = init_test_db().unwrap();
        let result = rename_event_type(&pool, "nonexistent.event", "also_nonexistent").unwrap();
        assert_eq!(result.events_updated, 0);
        assert_eq!(result.subscriptions_updated, 0);
        assert_eq!(result.trigger_publishers_updated, 0);
        assert_eq!(result.trigger_listeners_updated, 0);
        assert_eq!(result.handler_keys_updated, 0);
        assert_eq!(result.persona_handlers_updated, 0);
    }

    #[test]
    fn test_rename_preserves_other_handlers_and_other_events() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Seed a persona with TWO handler keys; only one should be renamed.
        let sp = serde_json::json!({
            "identity": "Multi-handler persona.",
            "eventHandlers": {
                "event.one": "handler one",
                "event.two": "handler two"
            }
        })
        .to_string();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE personas SET structured_prompt = ?1 WHERE id = ?2",
                params![sp, persona.id],
            )
            .unwrap();
        }

        // Add subscriptions for both names
        insert_subscription(&pool, &persona.id, "event.one");
        insert_subscription(&pool, &persona.id, "event.two");

        rename_event_type(&pool, "event.one", "event.renamed").unwrap();

        let handlers = read_handlers(&pool, &persona.id);
        assert!(handlers.get("event.one").is_none());
        assert_eq!(
            handlers
                .get("event.renamed")
                .and_then(|v| v.as_str())
                .unwrap(),
            "handler one",
        );
        // Untouched sibling
        assert_eq!(
            handlers.get("event.two").and_then(|v| v.as_str()).unwrap(),
            "handler two",
        );

        // event.two subscription untouched
        assert!(event_type_in_use(&pool, "event.two").unwrap());
    }

    #[test]
    fn test_rename_event_type_in_use_returns_false_for_unknown() {
        let pool = init_test_db().unwrap();
        assert!(!event_type_in_use(&pool, "totally.unseen.event").unwrap());
    }

    // Placate the "unused import" lint for helpers used only by specific tests.
    #[allow(dead_code)]
    fn _seed_handler_keeper(pool: &DbPool, persona_id: &str) {
        seed_handler(pool, persona_id, "x", "y");
    }

    /// Regression pin: an approval-gated pending trigger fire must transition
    /// exactly once even when resolved twice for the same id (UI double-click,
    /// IPC timeout retry). Before the fix, `resolve_pending_fire` returned the
    /// row unconditionally and the caller decided whether to publish purely
    /// from its own `approved` bool — both racing calls would see `approved`
    /// and both would publish, firing the gated automation twice from one
    /// human click. The CAS predicate (`AND status = 'pending'`) means only
    /// one UPDATE actually flips the row; this test asserts only one call
    /// reports `won_cas == true`, i.e. only one caller is authorised to publish.
    #[test]
    fn test_resolve_pending_fire_is_single_winner_cas() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();
        let fire = insert_pending_fire(&pool, &trigger.id, &persona.id, "manual.fire", None, None)
            .unwrap();

        // Simulate two overlapping resolutions of the SAME pending fire, both
        // approving — e.g. a double-click or an IPC retry after a timeout.
        let (first_row, first_won) = resolve_pending_fire(&pool, &fire.id, true).unwrap();
        let (second_row, second_won) = resolve_pending_fire(&pool, &fire.id, true).unwrap();

        // Exactly one call wins the CAS — that's the only one allowed to publish.
        assert_ne!(
            first_won, second_won,
            "exactly one of the two racing resolutions must win the compare-and-swap"
        );
        assert!(first_won || second_won, "one resolution must win");

        // Both calls observe the same final, single, resolved state.
        assert_eq!(first_row.status, "approved");
        assert_eq!(second_row.status, "approved");
        assert_eq!(first_row.resolved_at, second_row.resolved_at);

        // The row is not left dangling as `pending` and cannot be won a third time.
        let (_, third_won) = resolve_pending_fire(&pool, &fire.id, true).unwrap();
        assert!(
            !third_won,
            "an already-resolved fire must never win the CAS again"
        );
    }

    /// Regression pin for the manual-backfill double-publish race
    /// (`commands/execution/scheduler.rs::backfill_schedule`, Finding #2 of the
    /// 2026-07-28 claim-then-work audit). That command now claims the trigger
    /// through this CAS BEFORE computing or publishing any slot. Two callers
    /// racing at the same `expected_version` -- a double-clicked Backfill, or
    /// the command racing the auto-backfill tick -- must not both win, or both
    /// publish the same slots and the persona is dispatched twice for one
    /// schedule slot (duplicate LLM spend, plus whatever side effect the
    /// persona itself performs).
    ///
    /// Lives here rather than beside the command because `test_fixtures` is
    /// `#[cfg(test)]`-private to this crate and is not reachable from the
    /// app_lib test build at all.
    #[test]
    fn advance_schedule_pointer_cas_rejects_a_second_same_version_claim() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .expect("create schedule trigger");

        let first = advance_schedule_pointer(
            &pool,
            &trigger.id,
            trigger.next_trigger_at.clone(),
            trigger.trigger_version,
        );
        let second = advance_schedule_pointer(
            &pool,
            &trigger.id,
            trigger.next_trigger_at.clone(),
            trigger.trigger_version,
        );

        assert!(matches!(first, Ok(true)), "first claim must win: {first:?}");
        assert!(
            matches!(second, Ok(false)),
            "a second claim at the now-stale version must lose the CAS: {second:?}"
        );
    }
}
