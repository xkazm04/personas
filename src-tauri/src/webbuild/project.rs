//! Managed web-project directories under `~/.personas/projects/<slug>/`.
//!
//! Scaffolding a from-zero project (the non-technical-user path) drops a blank
//! Next.js + TS + Tailwind app — the one validated golden stack — via Bun, and
//! pins the Turbopack workspace root so a stray parent lockfile can't mis-infer
//! it (the gotcha caught while standing up the `mk` test bed).

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::AppError;

/// Scaffold (download + dependency install) can be slow on a cold cache.
const SCAFFOLD_TIMEOUT: Duration = Duration::from_secs(600);

/// Resolve `~/.personas/projects/`. Honors the `PERSONAS_HOME` override, the
/// same convention used by `companion::disk` and the STT engine dir.
pub fn projects_root() -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("projects"))
}

/// A filesystem-safe slug from a human project name: lowercase ASCII
/// alphanumerics, runs of anything else collapsed to a single `-`, trimmed.
/// Errors when nothing usable remains.
pub fn slugify(name: &str) -> Result<String, AppError> {
    let mut out = String::with_capacity(name.len());
    let mut prev_hyphen = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_hyphen = false;
        } else if !out.is_empty() && !prev_hyphen {
            out.push('-');
            prev_hyphen = true;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err(AppError::Validation(format!(
            "project name `{name}` has no filesystem-safe characters"
        )));
    }
    Ok(slug)
}

/// Absolute directory for a project slug. Guards against path traversal: the
/// slug must be a single path segment (no separators, no `..`).
pub fn project_dir(slug: &str) -> Result<PathBuf, AppError> {
    if slug.is_empty() || slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err(AppError::Validation(format!(
            "unsafe project slug `{slug}`"
        )));
    }
    Ok(projects_root()?.join(slug))
}

/// What the new-project form needs to know about a name before submit: the
/// folder it becomes, whether that folder is already taken (the exact condition
/// [`scaffold_next_app`] refuses on), and a free variant to offer instead.
/// Asked of the backend rather than mirrored in TypeScript, so the form can
/// never disagree with the scaffold.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNameCheck {
    /// The folder name, or `None` when the name has no usable characters.
    pub slug: Option<String>,
    pub taken: bool,
    /// The first free `<slug>-<n>` when `taken`.
    pub suggestion: Option<String>,
}

/// Check `name`: taken when its folder `exists` (the projects root on disk in
/// production, the scaffold's own refusal) or when an already registered
/// project's name makes the same folder name (an imported project elsewhere
/// on disk would not collide on disk, but two projects of one name would).
pub fn check_project_name(
    name: &str,
    exists: impl Fn(&str) -> bool,
    registered: &[String],
) -> ProjectNameCheck {
    let registered: std::collections::HashSet<String> =
        registered.iter().filter_map(|n| slugify(n).ok()).collect();
    let exists = |slug: &str| exists(slug) || registered.contains(slug);
    let Ok(slug) = slugify(name) else {
        return ProjectNameCheck {
            slug: None,
            taken: false,
            suggestion: None,
        };
    };
    let taken = exists(&slug);
    let suggestion = taken
        .then(|| (2..100).map(|n| format!("{slug}-{n}")).find(|c| !exists(c)))
        .flatten();
    ProjectNameCheck {
        slug: Some(slug),
        taken,
        suggestion,
    }
}

/// True if `dir` looks like a Next.js app Studio can build + preview: a
/// `next.config.*` is present, or `next` is a (dev)dependency in package.json.
/// Used to flag incompatible Dev Tools projects in the Studio import picker
/// before they fail to start a `next dev` server.
pub fn is_next_app(dir: &Path) -> bool {
    for cfg in [
        "next.config.js",
        "next.config.ts",
        "next.config.mjs",
        "next.config.cjs",
    ] {
        if dir.join(cfg).is_file() {
            return true;
        }
    }
    if let Ok(body) = std::fs::read_to_string(dir.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
            let has_next = |key: &str| {
                json.get(key)
                    .and_then(|d| d.as_object())
                    .is_some_and(|o| o.contains_key("next"))
            };
            return has_next("dependencies") || has_next("devDependencies");
        }
    }
    false
}

/// Scaffold a blank Next.js + TS + Tailwind app into `<projects_root>/<slug>/`
/// using Bun, then pin the Turbopack workspace root. Returns the created dir.
/// Errors if the directory already exists.
pub async fn scaffold_next_app(slug: &str) -> Result<PathBuf, AppError> {
    let dir = project_dir(slug)?;
    if dir.exists() {
        return Err(AppError::Validation(format!(
            "project directory already exists: {}",
            dir.display()
        )));
    }
    let root = projects_root()?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| AppError::Internal(format!("create projects root: {e}")))?;

    let dir_str = dir.to_string_lossy().to_string();
    let out = super::bun::run(
        &[
            "x",
            "create-next-app@latest",
            dir_str.as_str(),
            "--ts",
            "--tailwind",
            "--eslint",
            "--app",
            "--no-src-dir",
            "--import-alias",
            "@/*",
            "--use-bun",
            "--turbopack",
            "--yes",
        ],
        &root,
        SCAFFOLD_TIMEOUT,
    )
    .await?;
    if !out.success {
        return Err(AppError::Internal(format!(
            "create-next-app failed: {}…",
            crate::utils::text::truncate_on_char_boundary(&out.stderr, 400)
        )));
    }
    tracing::debug!(
        slug,
        output_bytes = out.stdout.len(),
        "scaffolded Next.js app"
    );
    pin_turbopack_root(&dir).await?;
    Ok(dir)
}

/// Write a `next.config.ts` that pins `turbopack.root` to the project dir, so
/// Next doesn't infer the workspace root from a stray parent lockfile.
async fn pin_turbopack_root(dir: &Path) -> Result<(), AppError> {
    let cfg = dir.join("next.config.ts");
    let contents = "import type { NextConfig } from \"next\";\n\nconst nextConfig: NextConfig = {\n  // Pin the workspace root so a stray parent lockfile can't mis-infer it.\n  turbopack: { root: __dirname },\n};\n\nexport default nextConfig;\n";
    tokio::fs::write(&cfg, contents)
        .await
        .map_err(|e| AppError::Internal(format!("write next.config.ts: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn name_check_matches_the_scaffold_and_suggests_a_free_folder() {
        let taken = ["portfolio", "portfolio-2"];
        let exists = |slug: &str| taken.contains(&slug);
        let c = super::check_project_name("Portfolio", exists, &[]);
        assert_eq!(c.slug.as_deref(), Some("portfolio"));
        assert!(c.taken);
        assert_eq!(c.suggestion.as_deref(), Some("portfolio-3"));
        let free = super::check_project_name("Hearth & Grain", exists, &[]);
        assert_eq!(
            (free.slug.as_deref(), free.taken, free.suggestion),
            (Some("hearth-grain"), false, None)
        );
        let unsafe_name = super::check_project_name("***", exists, &[]);
        assert_eq!(unsafe_name.slug, None);
        // An imported project elsewhere on disk: no folder clash, still a name clash.
        let named =
            super::check_project_name("Auto Invoicer", |_| false, &["auto-invoicer".to_string()]);
        assert!(named.taken);
        assert_eq!(named.suggestion.as_deref(), Some("auto-invoicer-2"));
    }

    use super::*;

    #[test]
    fn slugify_basics() {
        assert_eq!(slugify("My Portfolio").unwrap(), "my-portfolio");
        assert_eq!(slugify("  Cool   App!! ").unwrap(), "cool-app");
        assert_eq!(slugify("a/b\\c").unwrap(), "a-b-c");
        assert_eq!(slugify("mk").unwrap(), "mk");
        assert!(slugify("   ").is_err());
        assert!(slugify("!!!").is_err());
    }

    #[test]
    fn project_dir_rejects_traversal() {
        assert!(project_dir("../escape").is_err());
        assert!(project_dir("a/b").is_err());
        assert!(project_dir("a\\b").is_err());
        assert!(project_dir("..").is_err());
        assert!(project_dir("").is_err());
    }
}
