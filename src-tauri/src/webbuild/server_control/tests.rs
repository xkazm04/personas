use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::db::repos::dev::projects::create_project;

#[test]
fn a_plain_dev_command_is_accepted_trimmed() {
    assert_eq!(validate_command("  npm run dev  ").unwrap(), "npm run dev");
    assert_eq!(
        validate_command("npm run dev -- --port {port} --host \"localhost\"").unwrap(),
        "npm run dev -- --port {port} --host \"localhost\""
    );
    assert_eq!(validate_command("bun run dev").unwrap(), "bun run dev");
}

#[test]
fn an_empty_command_is_refused() {
    for raw in ["", "   "] {
        assert!(matches!(
            validate_command(raw),
            Err(AppError::Validation(_))
        ));
    }
}

#[test]
fn a_command_over_the_limit_is_refused() {
    let at_limit = "x".repeat(COMMAND_MAX_CHARS);
    assert!(validate_command(&at_limit).is_ok());
    let over = "x".repeat(COMMAND_MAX_CHARS + 1);
    let err = validate_command(&over).unwrap_err().to_string();
    assert!(err.contains("201"), "{err}");
}

#[test]
fn every_shell_metacharacter_is_refused() {
    for bad in [
        "npm run dev & calc",
        "npm run dev | tee log",
        "npm run dev; rm -rf x",
        "npm run dev < in",
        "npm run dev > out",
        "npm run dev `whoami`",
        "npm run dev $HOME",
        "npm run dev $(whoami)",
        "(npm run dev)",
        "npm run dev %PERSONAS_API_KEY%",
        "npm run dev\ncalc",
        "npm run dev\rcalc",
    ] {
        match validate_command(bad) {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("one command"), "{bad:?}: {msg}")
            }
            other => panic!("{bad:?} was not refused: {other:?}"),
        }
    }
}

#[test]
fn port_is_the_only_placeholder() {
    assert!(validate_command("vite --port {port}").is_ok());
    assert!(validate_command("vite --port {port} --strictPort {port}").is_ok());
    for bad in [
        "vite --host {host}",
        "vite --port {PORT}",
        "vite {",
        "vite }",
    ] {
        match validate_command(bad) {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("only placeholder"), "{bad}: {msg}")
            }
            other => panic!("{bad} was not refused: {other:?}"),
        }
    }
}

#[test]
fn the_port_is_substituted_everywhere() {
    assert_eq!(
        render_command("vite --port {port} --strictPort --hmr-port {port}", 5173),
        "vite --port 5173 --strictPort --hmr-port 5173"
    );
    assert_eq!(render_command("npm run dev", 3000), "npm run dev");
}

#[test]
fn a_root_path_loses_its_trailing_separator_but_not_its_root() {
    assert_eq!(normalize_root(" C:\\repos\\shop\\ "), "C:\\repos\\shop");
    assert_eq!(normalize_root("/home/k/shop/"), "/home/k/shop");
    assert_eq!(normalize_root("C:\\"), "C:\\");
    assert_eq!(normalize_root("/"), "/");
    assert_eq!(folder_name("C:\\repos\\shop"), "shop");
    assert_eq!(folder_name("/home/k/my-app"), "my-app");
}

#[test]
fn the_supervisor_emits_only_on_change() {
    let state = ControlState::default();
    let row = DevServerView {
        project_id: "p".into(),
        project_name: "P".into(),
        root_path: "/p".into(),
        workspace_id: None,
        tech_stack: None,
        dev_command: None,
        dev_port: 3000,
        state: DevServerState::Unconfigured,
        pid: None,
        external_pid: None,
        started_at: None,
        url: "http://localhost:3000".into(),
        error: None,
    };
    // The first list is always news, even an empty one.
    assert!(state.record_if_changed(&[]));
    assert!(!state.record_if_changed(&[]));
    assert!(state.record_if_changed(std::slice::from_ref(&row)));
    assert!(!state.record_if_changed(std::slice::from_ref(&row)));
    let running = DevServerView {
        state: DevServerState::Running,
        pid: Some(1),
        started_at: Some(10),
        ..row.clone()
    };
    assert!(state.record_if_changed(std::slice::from_ref(&running)));
    // A command's unconditional emission also counts as the last one.
    state.record_emitted(std::slice::from_ref(&row));
    assert!(!state.record_if_changed(std::slice::from_ref(&row)));
}

#[test]
fn flags_track_scans_stops_and_sticky_failures() {
    let state = ControlState::default();
    assert!(state.begin_scan("a"));
    assert!(
        !state.begin_scan("a"),
        "a second scan of one project is refused"
    );
    assert!(state.is_scanning("a"));
    state.set_stopping("b", true);
    state.fail("c", "boom".into());
    let f = state.flags();
    assert!(f.scanning.contains("a") && f.stopping.contains("b"));
    assert_eq!(f.failures.get("c").map(String::as_str), Some("boom"));
    state.end_scan("a");
    state.set_stopping("b", false);
    state.clear_failure("c");
    let f = state.flags();
    assert!(f.scanning.is_empty() && f.stopping.is_empty() && f.failures.is_empty());
}

/// The view over a real database: unconfigured, then stopped, an exited
/// server's failure, and a scan in flight, all through `compute_views` with
/// the live socket table.
#[tokio::test]
async fn the_view_derives_from_the_database_and_the_registry() {
    let pool = crate::db::init_test_db().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();
    let p = create_project(&pool, "shop", &root, None, None, None, None, None).unwrap();
    // A port nothing is listening on.
    let port = crate::webbuild::devserver::alloc_port().unwrap();
    repo::set_port(&pool, &p.id, port).unwrap();
    let reg = Arc::new(DevServerRegistry::new(pool.clone()));

    let views = compute_views(&pool, &reg).await.unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].state, DevServerState::Unconfigured);
    assert_eq!(views[0].url, format!("http://localhost:{port}"));

    repo::set_config(&pool, &p.id, Some("npm run dev"), port).unwrap();
    let views = compute_views(&pool, &reg).await.unwrap();
    assert_eq!(views[0].state, DevServerState::Stopped);
    assert_eq!(views[0].dev_command.as_deref(), Some("npm run dev"));

    reg.control().fail(&p.id, "could not start: boom".into());
    let views = compute_views(&pool, &reg).await.unwrap();
    assert_eq!(views[0].state, DevServerState::Failed);
    assert_eq!(views[0].error.as_deref(), Some("could not start: boom"));

    assert!(reg.control().begin_scan(&p.id));
    let views = compute_views(&pool, &reg).await.unwrap();
    assert_eq!(views[0].state, DevServerState::Scanning);
    reg.control().end_scan(&p.id);

    // Out of the view: no row at all.
    repo::clear_port(&pool, &p.id).unwrap();
    assert!(compute_views(&pool, &reg).await.unwrap().is_empty());
}

#[test]
fn a_scan_finding_is_validated_and_takes_only_a_free_port() {
    let pool = crate::db::init_test_db().unwrap();
    let a = create_project(&pool, "a", "C:/r/a", None, None, None, None, None).unwrap();
    let b = create_project(&pool, "b", "C:/r/b", None, None, None, None, None).unwrap();
    repo::set_port(&pool, &a.id, 3000).unwrap();
    repo::set_port(&pool, &b.id, 3001).unwrap();
    let listening: ports::ListenTable = [(4000, 9)].into_iter().collect();
    let finding = |command: &str, port: Option<u16>| scan::ScanFinding {
        dev_command: command.into(),
        port,
        tech_stack: vec!["Vite".into(), "React".into()],
    };

    // A port another project holds is not taken.
    apply_finding(&pool, &b.id, finding("npm run dev", Some(3000)), &listening).unwrap();
    let cfg = repo::get_config(&pool, &b.id).unwrap().unwrap();
    assert_eq!(cfg.dev_port, Some(3001));
    assert_eq!(cfg.dev_command.as_deref(), Some("npm run dev"));
    assert_eq!(cfg.tech_stack.as_deref(), Some("Vite,React"));

    // Nor one something is listening on.
    apply_finding(&pool, &b.id, finding("npm run dev", Some(4000)), &listening).unwrap();
    assert_eq!(
        repo::get_config(&pool, &b.id).unwrap().unwrap().dev_port,
        Some(3001)
    );

    // A free one is, and it is whitelisted.
    apply_finding(
        &pool,
        &b.id,
        finding("npm run dev -- --port {port}", Some(5173)),
        &listening,
    )
    .unwrap();
    assert_eq!(
        repo::get_config(&pool, &b.id).unwrap().unwrap().dev_port,
        Some(5173)
    );
    let site = crate::db::repos::browser::sites::get(&pool, "http://localhost:5173")
        .unwrap()
        .expect("whitelisted");
    assert!(site.enabled);
    assert_eq!(site.created_by, "server-control");
    assert_eq!(site.label, "b");

    // A command that would chain is refused, and nothing is written.
    let err = apply_finding(
        &pool,
        &b.id,
        finding("npm i && npm run dev", None),
        &listening,
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));
    assert_eq!(
        repo::get_config(&pool, &b.id)
            .unwrap()
            .unwrap()
            .dev_command
            .as_deref(),
        Some("npm run dev -- --port {port}")
    );
}

#[test]
fn whitelisting_never_touches_an_existing_row() {
    let pool = crate::db::init_test_db().unwrap();
    crate::db::repos::browser::sites::upsert(
        &pool,
        personas_core::models::UpsertBrowserSiteInput {
            origin: "http://localhost:3000".into(),
            label: Some("mine".into()),
            enabled: Some(false),
            budget: None,
            created_by: None,
        },
    )
    .unwrap();
    ensure_whitelisted(&pool, "shop", 3000).unwrap();
    let site = crate::db::repos::browser::sites::get(&pool, "http://localhost:3000")
        .unwrap()
        .unwrap();
    assert!(!site.enabled, "a paused origin stays paused");
    assert_eq!(site.label, "mine");
}

// ----------------------------------------------------------------------------
// Real processes (ignored: they spawn `node` and the test binary itself)
// ----------------------------------------------------------------------------

/// Poll the view until `project_id` reaches `want`, or give up after `within`.
async fn wait_for_state(
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
    want: DevServerState,
    within: Duration,
) -> DevServerView {
    let deadline = std::time::Instant::now() + within;
    loop {
        let row = row_of(compute_views(pool, reg).await.unwrap(), project_id).unwrap();
        if row.state == want || std::time::Instant::now() >= deadline {
            return row;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// A real dev server through the one spawn door: starting, then running
/// (HTTP answers), then stop, then stopped with its run row gone.
#[tokio::test]
#[ignore = "spawns a real node server"]
async fn a_real_server_starts_runs_and_stops() {
    let pool = crate::db::init_test_db().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let p = create_project(
        &pool,
        "node-ok",
        &dir.path().to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let port = crate::webbuild::devserver::alloc_port().unwrap();
    // The validator refuses parentheses, so this goes straight to the spawn
    // door: what is under test is the spawn, PORT and the lifecycle.
    let command =
        r#"node -e "require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT)""#;
    repo::set_config(&pool, &p.id, Some(command), port).unwrap();
    let reg = Arc::new(DevServerRegistry::new(pool.clone()));

    let (r, id, root) = (reg.clone(), p.id.clone(), dir.path().to_path_buf());
    let owned = tokio::task::spawn_blocking(move || {
        r.spawn(&id, &root, port, &DevServerSpec::Shell(command.to_string()))
    })
    .await
    .unwrap()
    .unwrap();
    assert!(owned.persistent);
    assert_eq!(repo::list_runs(&pool).unwrap().len(), 1);

    let first = row_of(compute_views(&pool, &reg).await.unwrap(), &p.id).unwrap();
    assert!(
        matches!(
            first.state,
            DevServerState::Starting | DevServerState::Running
        ),
        "{first:?}"
    );
    assert_eq!(first.pid, Some(owned.pid));

    let running = wait_for_state(
        &pool,
        &reg,
        &p.id,
        DevServerState::Running,
        Duration::from_secs(30),
    )
    .await;
    assert_eq!(running.state, DevServerState::Running, "{running:?}");
    assert_eq!(running.external_pid, None);

    let r = reg.clone();
    let id = p.id.clone();
    let stop = tokio::task::spawn_blocking(move || r.stop(&id));
    stop.await.unwrap().unwrap();
    let stopped = wait_for_state(
        &pool,
        &reg,
        &p.id,
        DevServerState::Stopped,
        Duration::from_secs(10),
    )
    .await;
    assert_eq!(stopped.state, DevServerState::Stopped, "{stopped:?}");
    assert_eq!(stopped.pid, None);
    assert!(repo::list_runs(&pool).unwrap().is_empty());
    assert!(!http_responds(port));
}

/// How long the experiment waits for the probe process to finish.
const PROBE_PROCESS_WAIT: Duration = Duration::from_secs(120);

/// The env var that turns [`detach_probe_child`] from a no-op into the probe.
const DETACH_PROBE_ENV: &str = "PERSONAS_DETACH_PROBE_OUT";

/// Half of the experiment below, run as its own short-lived process: spawn a
/// long-lived command through the detached door, write its pid, and exit.
#[tokio::test]
#[ignore = "helper process for a_detached_server_outlives_the_process_that_spawned_it"]
async fn detach_probe_child() {
    let Ok(out) = std::env::var(DETACH_PROBE_ENV) else {
        return;
    };
    let long_lived = if cfg!(windows) {
        "ping -n 60 127.0.0.1"
    } else {
        "sleep 60"
    };
    let child = personas_engine::verification_command::spawn_detached(
        &std::env::temp_dir(),
        long_lived,
        &[("PORT", "0".to_string())],
    )
    .unwrap();
    std::fs::write(out, child.id().unwrap().to_string()).unwrap();
    // Returning ends this process; `child` is dropped without being killed.
}

/// The claim the whole design rests on: a server started through
/// `spawn_detached` outlives the process that started it. A short-lived
/// process (this test binary, running only [`detach_probe_child`]) spawns a
/// long-lived command and exits; the command must still be alive afterwards.
#[tokio::test]
#[ignore = "spawns the test binary itself"]
async fn a_detached_server_outlives_the_process_that_spawned_it() {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    let scratch = tempfile::tempdir().unwrap();
    let out = scratch.path().join("pid.txt");
    let exe = std::env::current_exe().unwrap();
    let probe = format!(
        "\"{}\" webbuild::server_control::tests::detach_probe_child --exact --ignored --nocapture --test-threads=1",
        exe.display()
    );
    let mut parent = personas_engine::verification_command::spawn_detached(
        scratch.path(),
        &probe,
        &[(DETACH_PROBE_ENV, out.display().to_string())],
    )
    .unwrap();
    let status = tokio::time::timeout(PROBE_PROCESS_WAIT, parent.wait())
        .await
        .expect("the probe process finished")
        .unwrap();
    assert!(status.success(), "probe process exited with {status:?}");
    let pid: u32 = std::fs::read_to_string(&out)
        .unwrap()
        .trim()
        .parse()
        .unwrap();

    // The process that spawned it is gone (we just reaped its parent shell).
    tokio::time::sleep(Duration::from_millis(500)).await;
    let mut sys = System::new();
    let wanted = [Pid::from_u32(pid)];
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&wanted),
        true,
        ProcessRefreshKind::nothing(),
    );
    let alive = sys.process(Pid::from_u32(pid)).is_some();
    let cleanup = kill_tree(pid);
    assert!(
        alive,
        "the detached command (pid {pid}) died with the process that spawned it"
    );
    cleanup.unwrap();
}
