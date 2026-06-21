//! Discover a generated project's Next.js app-router routes, for the Studio
//! preview's cross-page navigation bar. Scans `app/` for `page.*` files and maps
//! each containing folder to its URL path (route groups `(x)` are stripped;
//! private `_folders` are skipped; dynamic `[param]` segments are kept so the UI
//! can show — and optionally skip — them).

use crate::error::AppError;
use std::path::Path;

pub fn list_routes(project_dir: &Path) -> Result<Vec<String>, AppError> {
    let mut routes = Vec::new();
    // Support both app-router layouts (scaffold uses --no-src-dir => ./app).
    for base in ["app", "src/app"] {
        let app = project_dir.join(base);
        if app.is_dir() {
            walk(&app, &app, &mut routes);
        }
    }
    routes.sort();
    routes.dedup();
    Ok(routes)
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // Skip private folders (_components, _lib) — they aren't routable.
            if name.starts_with('_') || name == "node_modules" {
                continue;
            }
            walk(&path, root, out);
        } else if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
            if matches!(fname, "page.tsx" | "page.ts" | "page.jsx" | "page.js") {
                if let Some(route) = route_for(dir, root) {
                    out.push(route);
                }
            }
        }
    }
}

fn route_for(dir: &Path, root: &Path) -> Option<String> {
    let rel = dir.strip_prefix(root).ok()?;
    let mut segs: Vec<String> = Vec::new();
    for comp in rel.components() {
        let s = comp.as_os_str().to_str()?;
        // Route groups `(marketing)` don't affect the URL.
        if s.starts_with('(') && s.ends_with(')') {
            continue;
        }
        segs.push(s.to_string());
    }
    Some(if segs.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", segs.join("/"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn maps_app_router_pages_to_routes() {
        let tmp = std::env::temp_dir().join(format!("routes-test-{}", std::process::id()));
        let app = tmp.join("app");
        for sub in ["", "cart", "(marketing)/about", "shop/[slug]", "_components"] {
            let d = if sub.is_empty() { app.clone() } else { app.join(sub) };
            fs::create_dir_all(&d).unwrap();
            // _components is private — give it a page to prove it's skipped
            fs::write(d.join("page.tsx"), "export default function P(){return null}").unwrap();
        }
        let routes = list_routes(&tmp).unwrap();
        let _ = fs::remove_dir_all(&tmp);
        assert!(routes.contains(&"/".to_string()));
        assert!(routes.contains(&"/cart".to_string()));
        assert!(routes.contains(&"/about".to_string())); // group stripped
        assert!(routes.contains(&"/shop/[slug]".to_string()));
        assert!(!routes.iter().any(|r| r.contains("_components"))); // private skipped
    }
}
