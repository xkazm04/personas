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
}
