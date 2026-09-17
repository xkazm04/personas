//! `browser_sites` — the Whitelist row and the shapes hanging off it.
//!
//! These are the Rust twin of `src/features/browser/types.ts` (spark
//! `browser-control`, WP0). Three decisions worth naming, because each one
//! reads as an oddity against the rest of `models/`:
//!
//! 1. **`snake_case`, not `camelCase`.** Every other model in this module
//!    renames to camelCase for the frontend. The browser contract was written
//!    in TypeScript first (`types.ts`, committed in WP0) with snake_case field
//!    names, and WP4 re-points that module at the generated bindings. Renaming
//!    here would silently break that hand-off, so the wire shape wins.
//! 2. **The primary key is the origin, not an id.** An origin is already the
//!    identity the gate decides on (`browser_bridge::origin_of`'s ascii
//!    serialization); a surrogate id would let two rows claim one origin and
//!    make "is this site allowed" ambiguous — which is the one question the
//!    table exists to answer.
//! 3. **`overrides` may only ever hold [`BrowserToolClass::Gated`].** The map
//!    is typed with the full enum because that is the vocabulary it belongs
//!    to, and the tighten-only rule is enforced at the repo door
//!    (`repos::browser::sites::set_override`) so every writer meets it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

use super::json_column::Json;

/// Tool class after manifest derivation + per-origin tightening.
/// Mirrors the TS `BrowserToolClass`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum BrowserToolClass {
    /// Never mutates; auto-fires.
    Read,
    /// Mutates but is reversible and internal; auto-fires.
    Auto,
    /// Goes to the operator's approval before it runs.
    Gated,
}

impl BrowserToolClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            BrowserToolClass::Read => "read",
            BrowserToolClass::Auto => "auto",
            BrowserToolClass::Gated => "gated",
        }
    }

    pub fn parse(raw: &str) -> Option<BrowserToolClass> {
        match raw {
            "read" => Some(BrowserToolClass::Read),
            "auto" => Some(BrowserToolClass::Auto),
            "gated" => Some(BrowserToolClass::Gated),
            _ => None,
        }
    }

    /// Does moving from `self` to `next` TIGHTEN (or hold) the class?
    /// `read < auto < gated`; anything that lowers the rank is a loosening
    /// and is refused (`RefusalCode::RefusedLoosening`).
    pub fn tightens_to(&self, next: BrowserToolClass) -> bool {
        next.rank() >= self.rank()
    }

    fn rank(&self) -> u8 {
        match self {
            BrowserToolClass::Read => 0,
            BrowserToolClass::Auto => 1,
            BrowserToolClass::Gated => 2,
        }
    }
}

/// Where the controllability scan stands for an origin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum BrowserScanStatus {
    /// Never scanned.
    #[default]
    None,
    Running,
    /// The scan answered; the operator has not confirmed it yet.
    Proposed,
    Confirmed,
    Failed,
}

impl BrowserScanStatus {
    /// The column token. Identical to the serde rename and to the
    /// `browser_sites.scan_status` CHECK — a drift here is a constraint
    /// failure at runtime, not a compile error.
    pub fn as_str(&self) -> &'static str {
        match self {
            BrowserScanStatus::None => "none",
            BrowserScanStatus::Running => "running",
            BrowserScanStatus::Proposed => "proposed",
            BrowserScanStatus::Confirmed => "confirmed",
            BrowserScanStatus::Failed => "failed",
        }
    }

    pub fn parse(raw: &str) -> Option<BrowserScanStatus> {
        match raw {
            "none" => Some(BrowserScanStatus::None),
            "running" => Some(BrowserScanStatus::Running),
            "proposed" => Some(BrowserScanStatus::Proposed),
            "confirmed" => Some(BrowserScanStatus::Confirmed),
            "failed" => Some(BrowserScanStatus::Failed),
            _ => None,
        }
    }
}

/// How the page exposes its own tools, if at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub enum BrowserScanTransport {
    #[serde(rename = "webmcp-native")]
    WebmcpNative,
    #[serde(rename = "webmcp-polyfill")]
    WebmcpPolyfill,
    #[default]
    #[serde(rename = "none")]
    None,
}

/// Declared side effects of a page tool, as the page's own manifest states
/// them. Untrusted input: the class derivation reads it, nothing else does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum BrowserSideEffects {
    #[default]
    None,
    Internal,
    External,
}

/// One tool the page declares (WebMCP native or polyfill).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct BrowserPageTool {
    pub name: String,
    pub description: String,
    pub reversible: bool,
    pub side_effects: BrowserSideEffects,
    /// The derived class. `Auto` iff `reversible && side_effects != external`
    /// (`browser_bridge::policy::derive_page_tool_class`), possibly tightened
    /// by the origin's overrides.
    pub class: BrowserToolClass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum BrowserScanFormKind {
    Login,
    Search,
    Payment,
    #[default]
    Other,
}

/// A form the scan found on the page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct BrowserScanForm {
    pub name: String,
    pub fields: u32,
    pub kind: BrowserScanFormKind,
}

/// The refs `browser_login` fills. Rust fills them from the vault; the model
/// never sees a value (browser-credential-boundary).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct BrowserLoginForm {
    pub user_ref: String,
    pub pass_ref: String,
    pub submit_ref: String,
}

/// Why a scan could not reach tier 2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum BrowserScanBlocker {
    Captcha,
    LoginWall,
    CspFrozenGlobals,
}

/// The JSON stored in `browser_sites.scan_report`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct BrowserSiteScan {
    pub transport: BrowserScanTransport,
    pub page_tools: Vec<BrowserPageTool>,
    pub operable_count: u32,
    pub landmarks: Vec<String>,
    pub forms: Vec<BrowserScanForm>,
    pub login_form: Option<BrowserLoginForm>,
    pub blockers: Vec<BrowserScanBlocker>,
    /// Controllability grade: 0 read-only, 1 generic hands, 2 the page's own
    /// WebMCP tools.
    pub tier: u8,
    pub notes: String,
}

/// One row of `browser_sites` — the origin gate's unit of decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct BrowserSite {
    /// `scheme://host[:port]`, the ascii serialization of the URL's origin.
    pub origin: String,
    pub label: String,
    /// Deny-by-default: a row created by a request is NOT enabled.
    pub enabled: bool,
    /// tool name -> class. Tighten-only: the repo refuses anything but
    /// [`BrowserToolClass::Gated`].
    pub overrides: Json<BTreeMap<String, BrowserToolClass>>,
    /// Per-turn call budget for this origin.
    pub budget: i32,
    pub credential_id: Option<String>,
    pub scan_status: BrowserScanStatus,
    /// 0 | 1 | 2 — `None` until a scan answers.
    pub scan_tier: Option<u8>,
    // `#[ts(as)]` is load-bearing. For `Option<Json<Struct>>` ts-rs 10.1 emits
    // the field type but NOT the import: `Option`'s dependency walk visits
    // `Json<T>`, which has no output path, and stops there. `Json<Vec<T>>` and
    // `Json<BTreeMap<..>>` import fine because the collection re-visits `T`.
    // Measured 2026-09-16 by exporting from personas-core's own test binary
    // with and without this attribute (`TS_RS_EXPORT_DIR=... cargo test -p
    // personas-core --lib export_bindings_browser`). Note that the app crate's
    // `npm run test:rust -- export_bindings` does NOT re-export these models;
    // use `test:rust:crates` for anything under core/src/models.
    #[ts(as = "Option<BrowserSiteScan>")]
    pub scan_report: Option<Json<BrowserSiteScan>>,
    /// Epoch ms. i64 because SQLite INTEGER is 64-bit; epoch-ms stays far
    /// under 2^53, so the JS `number` pin is lossless.
    // `number | null` spelled out: `#[ts(type)]` replaces the WHOLE field
    // type, so a bare `number` here would tell TypeScript a never-scanned
    // site has a timestamp.
    #[ts(type = "number | null")]
    pub scan_at: Option<i64>,
    #[ts(type = "number")]
    pub first_seen: i64,
    #[ts(type = "number")]
    pub last_seen: i64,
    /// `operator` | `athena` | `session:<id>` — the wire form of
    /// `browser_bridge::backend::Principal`.
    pub created_by: String,
}

// ---------------------------------------------------------------------------
// Origin patterns — one row that stands for a family of origins
// ---------------------------------------------------------------------------

/// The pattern grammar `browser_sites.origin` accepts beside a concrete
/// origin (spark `browser-control` follow-up):
///
/// ```text
/// scheme://host[:port]
///   scheme  http | https           — literal; `*://` is refused
///   host    example.com            — a concrete host, or
///           *.example.com          — ONE leading wildcard label, which
///                                    matches the apex AND any depth of
///                                    subdomain
///   port    3000 | *               — absent means "the origin carries no
///                                    port token", which is what a URL's
///                                    ascii serialization produces on the
///                                    scheme's default port
/// ```
///
/// Refused, deliberately: a bare `*` host (that is not a whitelist, it is the
/// absence of one), a `*` inside a label (`ex*.com` — the label boundary is
/// what keeps `evil-example.com` unreachable from `*.example.com`), and any
/// path, query, fragment or userinfo (the gate decides on origins; a pattern
/// that looked like it constrained a path would be a lie).
#[derive(Debug, Clone, PartialEq, Eq)]
struct OriginPattern {
    scheme: String,
    /// The host with any leading `*.` removed — the suffix a concrete host
    /// must equal, or end with after a dot.
    host_suffix: String,
    wildcard_host: bool,
    port: PortPattern,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PortPattern {
    /// `:*` — any port, including none at all.
    Any,
    /// No port token. Matches only an origin that also carries none, which
    /// is how `url::Url::origin()` serializes the scheme's default port.
    Absent,
    Fixed(u16),
}

impl PortPattern {
    fn suffix(&self) -> String {
        match self {
            PortPattern::Any => ":*".to_string(),
            PortPattern::Absent => String::new(),
            PortPattern::Fixed(p) => format!(":{p}"),
        }
    }
}

/// Does `origin` carry a wildcard token at all?
///
/// Deliberately the crudest possible question — the presence of a `*`, not
/// the validity of the pattern around it. Validity is
/// [`normalize_site_origin`]'s job; this one exists so a door that must
/// refuse patterns outright (`browser_request_site`: an agent may ask for one
/// concrete origin, never for a family) cannot be walked past by a MALFORMED
/// pattern that a stricter predicate would have failed to recognise.
pub fn is_origin_pattern(origin: &str) -> bool {
    origin.contains('*')
}

/// Does `pattern` cover `concrete`?
///
/// Pure and total: an unparseable pattern, or a `concrete` that is itself a
/// pattern, answers `false`. Never `true` by accident — this is the function
/// that decides whether an agent reaches a web app.
pub fn origin_matches(pattern: &str, concrete: &str) -> bool {
    let (Ok(pat), Ok(target)) = (
        parse_origin_pattern(pattern),
        parse_origin_pattern(concrete),
    ) else {
        return false;
    };
    if target.wildcard_host || target.port == PortPattern::Any {
        // `concrete` must BE concrete. A pattern-vs-pattern comparison has no
        // meaning the gate could act on.
        return false;
    }
    if pat.scheme != target.scheme {
        return false;
    }
    let host_ok = if pat.wildcard_host {
        target.host_suffix == pat.host_suffix
            || target
                .host_suffix
                .ends_with(&format!(".{}", pat.host_suffix))
    } else {
        target.host_suffix == pat.host_suffix
    };
    if !host_ok {
        return false;
    }
    pat.port == PortPattern::Any || pat.port == target.port
}

/// How specific `pattern` is, as a sort key: **more specific compares
/// greater**. `(host suffix length, host is exact, port is explicit)`.
///
/// That ordering is what makes `https://api.example.com` beat
/// `https://*.example.com` for `api.example.com`, and `http://localhost:3000`
/// beat `http://localhost:*` for port 3000. An unparseable pattern sorts
/// last, which is the only safe place for it.
pub fn origin_pattern_specificity(pattern: &str) -> (usize, u8, u8) {
    match parse_origin_pattern(pattern) {
        Ok(p) => (
            p.host_suffix.len(),
            u8::from(!p.wildcard_host),
            u8::from(p.port != PortPattern::Any),
        ),
        Err(_) => (0, 0, 0),
    }
}

/// The single normalisation door for anything written to
/// `browser_sites.origin`.
///
/// A concrete origin keeps going through `url::Url::origin()` exactly as
/// `browser_bridge::origin_of` does, so a row and the gate's runtime origin
/// are the same string. A pattern is normalised by hand — lowercased scheme
/// and host, trailing slash stripped, a default port dropped (`https://x:443`
/// would otherwise be a row nothing the serializer produces can ever match).
pub fn normalize_site_origin(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("origin must not be empty".into()));
    }
    if is_origin_pattern(trimmed) {
        return parse_origin_pattern(trimmed)
            .map(|p| p.normalized())
            .map_err(AppError::Validation);
    }
    let parsed = url::Url::parse(trimmed)
        .map_err(|e| AppError::Validation(format!("invalid origin `{trimmed}`: {e}")))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::Validation(format!(
            "origin scheme must be http or https, got `{}`",
            parsed.scheme()
        )));
    }
    if !parsed.has_host() {
        return Err(AppError::Validation(format!(
            "origin `{trimmed}` names no host"
        )));
    }
    Ok(parsed.origin().ascii_serialization())
}

impl OriginPattern {
    fn normalized(&self) -> String {
        let star = if self.wildcard_host { "*." } else { "" };
        format!(
            "{}://{star}{}{}",
            self.scheme,
            self.host_suffix,
            self.port.suffix()
        )
    }
}

/// Parse either a pattern or a concrete origin into the same shape.
///
/// Concrete origins land here too so [`origin_matches`] compares like with
/// like; a concrete one simply carries `wildcard_host = false` and a port
/// that is never [`PortPattern::Any`].
fn parse_origin_pattern(raw: &str) -> Result<OriginPattern, String> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() {
        return Err("origin must not be empty".into());
    }
    if raw.chars().any(char::is_whitespace) {
        return Err(format!("origin `{raw}` contains whitespace"));
    }
    for bad in ['?', '#', '@'] {
        if raw.contains(bad) {
            return Err(format!(
                "origin `{raw}` must be `scheme://host[:port]` with no path, query or userinfo"
            ));
        }
    }
    let Some((scheme, rest)) = raw.split_once("://") else {
        return Err(format!(
            "origin `{raw}` must start with http:// or https://"
        ));
    };
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(format!(
            "origin scheme must be http or https, got `{scheme}` (`*://` is not accepted)"
        ));
    }
    if rest.contains('/') {
        return Err(format!(
            "origin `{raw}` must be `scheme://host[:port]` with no path"
        ));
    }
    let (host, port_token) = split_host_port(rest)?;
    let host = host.to_ascii_lowercase();
    let wildcard_host = host.starts_with("*.");
    let host_suffix = if wildcard_host { &host[2..] } else { &host[..] };
    if host_suffix.is_empty() {
        return Err(format!(
            "origin `{raw}` has no host; a bare `*` is not a whitelist entry"
        ));
    }
    if host_suffix.contains('*') {
        return Err(format!(
            "origin `{raw}`: a wildcard may only be ONE whole leading label \
             (`*.example.com`), never part of one"
        ));
    }
    if !host_suffix.starts_with('[') {
        for label in host_suffix.split('.') {
            if label.is_empty() {
                return Err(format!("origin `{raw}` has an empty host label"));
            }
            if !label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err(format!(
                    "origin `{raw}` has an invalid host label `{label}`"
                ));
            }
        }
    }
    let port = match port_token {
        None => PortPattern::Absent,
        Some("*") => PortPattern::Any,
        Some(tok) => {
            let n: u16 = tok
                .parse()
                .map_err(|_| format!("origin `{raw}` has an invalid port `{tok}`"))?;
            // `url::Url::origin()` omits the scheme's default port, so a
            // pattern that kept it would be a row nothing can ever match.
            if (scheme == "http" && n == 80) || (scheme == "https" && n == 443) {
                PortPattern::Absent
            } else {
                PortPattern::Fixed(n)
            }
        }
    };
    Ok(OriginPattern {
        scheme,
        host_suffix: host_suffix.to_string(),
        wildcard_host,
        port,
    })
}

/// Split `host[:port]`, keeping a bracketed IPv6 literal intact.
fn split_host_port(rest: &str) -> Result<(&str, Option<&str>), String> {
    if rest.starts_with('[') {
        let close = rest
            .find(']')
            .ok_or_else(|| format!("origin `{rest}` has an unterminated IPv6 literal"))?;
        let host = &rest[..=close];
        let tail = &rest[close + 1..];
        return match tail {
            "" => Ok((host, None)),
            t => t
                .strip_prefix(':')
                .map(|p| (host, Some(p)))
                .ok_or_else(|| format!("origin `{rest}` has trailing junk after the host")),
        };
    }
    match rest.split_once(':') {
        None => Ok((rest, None)),
        Some((h, p)) if !p.contains(':') => Ok((h, Some(p))),
        Some(_) => Err(format!("origin `{rest}` has more than one port separator")),
    }
}

/// Create-or-update body for `browser_sites_upsert`.
///
/// `None` means "leave what the row has" on an update and "take the default"
/// on a create — the same three-state shape `NotePatch` needed, minus the
/// double-option, because no field here is nullable-and-settable except
/// `credential_id`, which has its own command (`bind_credential`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct UpsertBrowserSiteInput {
    pub origin: String,
    pub label: Option<String>,
    pub enabled: Option<bool>,
    pub budget: Option<i32>,
    /// Who is adding it. Defaults to `operator` when absent.
    pub created_by: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_STATUS: [BrowserScanStatus; 5] = [
        BrowserScanStatus::None,
        BrowserScanStatus::Running,
        BrowserScanStatus::Proposed,
        BrowserScanStatus::Confirmed,
        BrowserScanStatus::Failed,
    ];

    /// The wire token IS the column token IS the serde rename. A drift here
    /// is a CHECK-constraint failure at runtime, not a compile error.
    #[test]
    fn scan_status_tokens_round_trip_and_match_serde() {
        for s in ALL_STATUS {
            assert_eq!(BrowserScanStatus::parse(s.as_str()), Some(s));
            assert_eq!(
                serde_json::to_string(&s).unwrap(),
                format!("\"{}\"", s.as_str())
            );
        }
        assert_eq!(BrowserScanStatus::parse("Confirmed"), None);
        assert_eq!(BrowserScanStatus::parse(""), None);
    }

    #[test]
    fn tool_class_tokens_round_trip() {
        for c in [
            BrowserToolClass::Read,
            BrowserToolClass::Auto,
            BrowserToolClass::Gated,
        ] {
            assert_eq!(BrowserToolClass::parse(c.as_str()), Some(c));
            assert_eq!(
                serde_json::to_string(&c).unwrap(),
                format!("\"{}\"", c.as_str())
            );
        }
    }

    /// The whole 3x3 tighten table, cell by cell.
    #[test]
    fn tightening_is_one_way() {
        use BrowserToolClass::*;
        for (from, to, expected) in [
            (Read, Read, true),
            (Read, Auto, true),
            (Read, Gated, true),
            (Auto, Read, false),
            (Auto, Auto, true),
            (Auto, Gated, true),
            (Gated, Read, false),
            (Gated, Auto, false),
            (Gated, Gated, true),
        ] {
            assert_eq!(from.tightens_to(to), expected, "{from:?} -> {to:?}");
        }
    }

    #[test]
    fn scan_report_serialises_with_the_ts_field_names() {
        let scan = BrowserSiteScan {
            transport: BrowserScanTransport::WebmcpPolyfill,
            page_tools: vec![BrowserPageTool {
                name: "add_invoice".into(),
                description: "".into(),
                reversible: true,
                side_effects: BrowserSideEffects::Internal,
                class: BrowserToolClass::Auto,
            }],
            operable_count: 4,
            landmarks: vec!["main".into()],
            forms: vec![],
            login_form: None,
            blockers: vec![BrowserScanBlocker::LoginWall],
            tier: 2,
            notes: String::new(),
        };
        let json = serde_json::to_value(&scan).unwrap();
        assert_eq!(json["transport"], "webmcp-polyfill");
        assert_eq!(json["page_tools"][0]["side_effects"], "internal");
        assert_eq!(json["operable_count"], 4);
        assert_eq!(json["blockers"][0], "login_wall");
        assert_eq!(json["login_form"], serde_json::Value::Null);
    }

    // -----------------------------------------------------------------------
    // Origin patterns
    // -----------------------------------------------------------------------

    #[test]
    fn a_wildcard_label_matches_the_apex_and_any_depth_of_subdomain() {
        let p = "https://*.example.com";
        assert!(origin_matches(p, "https://example.com"), "apex");
        assert!(origin_matches(p, "https://a.example.com"), "one label");
        assert!(origin_matches(p, "https://a.b.example.com"), "deep");
    }

    /// The two near-misses the label boundary exists for. A suffix test
    /// without the dot would accept the first; a `contains` test would accept
    /// the second, and each one is a different site owned by someone else.
    #[test]
    fn a_wildcard_label_stops_at_the_label_boundary() {
        let p = "https://*.example.com";
        assert!(!origin_matches(p, "https://evil-example.com"));
        assert!(!origin_matches(p, "https://example.com.evil"));
        assert!(!origin_matches(p, "https://notexample.com"));
    }

    #[test]
    fn a_wildcard_port_matches_any_port_and_a_fixed_one_does_not() {
        assert!(origin_matches(
            "http://localhost:*",
            "http://localhost:3000"
        ));
        assert!(origin_matches(
            "http://localhost:*",
            "http://localhost:5173"
        ));
        assert!(
            origin_matches("http://localhost:*", "http://localhost"),
            "`:*` covers the default port, which serializes with no token"
        );
        assert!(origin_matches(
            "http://localhost:3000",
            "http://localhost:3000"
        ));
        assert!(!origin_matches(
            "http://localhost:3000",
            "http://localhost:5173"
        ));
        assert!(!origin_matches("http://localhost", "http://localhost:3000"));
    }

    #[test]
    fn the_scheme_is_literal_and_never_wildcarded() {
        assert!(!origin_matches(
            "https://*.example.com",
            "http://example.com"
        ));
        assert!(!origin_matches("http://localhost:*", "https://localhost"));
        assert!(normalize_site_origin("*://example.com").is_err());
    }

    #[test]
    fn a_pattern_never_matches_another_pattern() {
        assert!(!origin_matches(
            "https://*.example.com",
            "https://*.example.com"
        ));
        assert!(!origin_matches("http://localhost:*", "http://localhost:*"));
    }

    #[test]
    fn is_origin_pattern_answers_on_the_token_not_on_validity() {
        assert!(is_origin_pattern("https://*.example.com"));
        assert!(is_origin_pattern("http://localhost:*"));
        assert!(
            is_origin_pattern("https://ex*.com"),
            "a MALFORMED pattern is still a pattern — the door that refuses \
             patterns must not be walked past by one that does not parse"
        );
        assert!(!is_origin_pattern("https://example.com"));
    }

    #[test]
    fn the_refused_shapes_are_refused() {
        for bad in [
            "https://*",                      // a bare wildcard host
            "https://ex*.com",                // `*` inside a label
            "https://*.example.com/admin",    // a path
            "https://*.example.com?q=1",      // a query
            "https://user@*.example.com",     // userinfo
            "*://example.com",                // a wildcard scheme
            "ftp://*.example.com",            // a scheme that is not http(s)
            "*.example.com",                  // no scheme
            "https://*.example.com:notaport", // a port that is not a number
        ] {
            assert!(
                normalize_site_origin(bad).is_err(),
                "`{bad}` must be refused"
            );
        }
    }

    #[test]
    fn normalisation_lowercases_strips_the_slash_and_drops_a_default_port() {
        assert_eq!(
            normalize_site_origin("HTTPS://*.Example.COM/").unwrap(),
            "https://*.example.com"
        );
        assert_eq!(
            normalize_site_origin("https://*.example.com:443").unwrap(),
            "https://*.example.com",
            "a default port would be a row nothing can ever match"
        );
        assert_eq!(
            normalize_site_origin("http://*.example.com:80").unwrap(),
            "http://*.example.com"
        );
        assert_eq!(
            normalize_site_origin("http://LOCALHOST:*").unwrap(),
            "http://localhost:*"
        );
        // A concrete origin keeps going through `url::Url::origin()`.
        assert_eq!(
            normalize_site_origin("http://localhost:3000/some/path").unwrap(),
            "http://localhost:3000"
        );
        assert_eq!(
            normalize_site_origin("https://Example.com").unwrap(),
            "https://example.com"
        );
    }

    /// The resolver's tie-break, as a sort key. More specific compares greater.
    #[test]
    fn specificity_ranks_exact_over_wildcard_and_a_port_over_a_star() {
        let api = origin_pattern_specificity("https://api.example.com");
        let wild = origin_pattern_specificity("https://*.example.com");
        assert!(api > wild, "an exact host beats a wildcard label");

        let deep = origin_pattern_specificity("https://*.eu.example.com");
        assert!(deep > wild, "the longer host suffix wins");

        let fixed = origin_pattern_specificity("http://localhost:3000");
        let any = origin_pattern_specificity("http://localhost:*");
        assert!(fixed > any, "an explicit port beats `:*`");

        assert_eq!(
            origin_pattern_specificity("https://ex*.com"),
            (0, 0, 0),
            "an unparseable pattern sorts last"
        );
    }
}
