//! Census self-test fixture — stand-in for `src-tauri/engine/src/cli_process.rs`,
//! the spawn chokepoint that owns env scrubbing, timeouts, PID registration and
//! cancellation. It must call Command::new; the exclude entry is what this file
//! exists to exercise.

pub async fn spawn_scrubbed(bin: &str) -> Child {
    let mut cmd = Command::new(bin);
    cmd.env_clear();
    cmd.spawn().unwrap()
}

pub async fn spawn_shell() -> Child {
    Command::new("sh").arg("-c").spawn().unwrap()
}
