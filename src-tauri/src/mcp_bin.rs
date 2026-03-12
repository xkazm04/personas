//! Personas MCP Server -- exposes persona operations via Model Context Protocol.
//!
//! Runs as a standalone binary that communicates via JSON-RPC 2.0 over stdio.
//! This enables Claude Code, Cursor, and other MCP-compatible AI tools to
//! orchestrate the personas agent fleet programmatically.
//!
//! Usage:
//!   personas-mcp --db-path <path-to-personas.db>
//!   personas-mcp install --target claude-code

mod mcp_server;

use std::io::{self, BufRead, Write};
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Handle install subcommand
    if args.len() >= 3 && args[1] == "install" {
        let target = &args[2];
        match target.as_str() {
            "--target" if args.len() >= 4 => {
                mcp_server::install::install_mcp_config(&args[3]);
            }
            _ => {
                eprintln!("Usage: personas-mcp install --target <claude-code|cursor>");
                std::process::exit(1);
            }
        }
        return;
    }

    // Parse --db-path argument
    let db_path = args
        .iter()
        .position(|a| a == "--db-path")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            // Default: look in standard app data location
            let data_dir = dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("com.personas.desktop");
            data_dir.join("personas.db")
        });

    if !db_path.exists() {
        eprintln!("Database not found at: {}", db_path.display());
        eprintln!("Use --db-path <path> to specify the database location");
        std::process::exit(1);
    }

    // Open DB connection
    let pool = match mcp_server::db::open_pool(&db_path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to open database: {e}");
            std::process::exit(1);
        }
    };

    // JSON-RPC loop over stdin/stdout
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = mcp_server::handle_jsonrpc(trimmed, &pool);

        if let Some(resp) = response {
            let json = serde_json::to_string(&resp).unwrap_or_else(|_| {
                r#"{"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal serialization error"},"id":null}"#.to_string()
            });
            let _ = writeln!(stdout, "{json}");
            let _ = stdout.flush();
        }
    }
}
