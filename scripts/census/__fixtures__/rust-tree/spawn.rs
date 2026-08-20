//! Census self-test fixture — the `fx-process-spawn` twin of
//! `process-spawn-outside-chokepoint`. Comment-only mentions of Command::new(
//! and TokioCommand::new( must not count.

// --- POSITIVES (4) ---------------------------------------------------------

pub fn plain() -> std::process::Output {
    Command::new("git").arg("status").output().unwrap()
}

pub fn fully_qualified() -> std::process::Output {
    std::process::Command::new("icacls").output().unwrap()
}

pub async fn tokio_qualified() {
    tokio::process::Command::new("npx").spawn().unwrap();
}

pub async fn tokio_aliased() {
    TokioCommand::new("ffmpeg").spawn().unwrap();
}

// --- NEGATIVES -------------------------------------------------------------
// Reusing an already-built child, and a type that merely contains the word.
pub fn reuse(cmd: &mut Command) {
    cmd.spawn().unwrap();
}

pub fn registry_lookup(r: &CommandRegistry) -> Option<&Handler> {
    r.lookup("fleet_spawn_session")
}
