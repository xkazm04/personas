//! **App master mandate** — the enforcement half of kp's App-master role
//! standard (kp `docs/features/app-master/README.md` §2.3, `docs/concepts/
//! app-master.md` §4.3), P4.
//!
//! An App master is the accountable owner of one application. kp composes an
//! `AppMasterSpec` and dispatches it over the hire bridge; the Personas half
//! stores the spec's **mandate** — how far the holder may go on its own — and
//! enforces it. Two independent gates, because they fail differently:
//!
//! 1. **The scope rung** ([`Mandate::scope_rung`]) — a ladder, not a flag:
//!    `0 read · 1 retry · 2 open branch/PR`. Rung 3 (deploy/merge) and 4
//!    (change gates) are *never* grantable in v1, so a spec carrying one is
//!    rejected at intake rather than stored and remembered-to-be-ignored.
//!    An autonomous [`crate::autonomy::Action`] above the granted rung is
//!    refused with a **typed** [`MandateRefusal`], not a silent skip.
//! 2. **The forbidden change classes** ([`ForbiddenClass`]) — the
//!    "repair by deletion" family. Each names a move that makes a *red*
//!    signal *green* without making the underlying thing true. A proposal
//!    touching one is **blocked**, logged, and counted. It is never silently
//!    rewritten into an allowed shape: a rewritten proposal is an agent
//!    learning which shapes evade the check.
//!
//! # Why the detector is deterministic
//!
//! [`scan_diff`] is a pure function over a unified diff. No model reads it,
//! nothing about it is probabilistic, and every hit carries the rule id and
//! the path (plus the line, for line rules) that produced it — so a refusal
//! can be argued with. That is the same discipline kp applies to
//! `backbone_score()`: the *record* is deterministic and attributable; only
//! the narration is a model's.
//!
//! The rules are deliberately **conservative about what they claim**. A path
//! rule says "this proposal touches a gate config", not "this proposal is
//! cheating" — the mandate's answer to a touched gate config is the same
//! either way (stop and ask the owner), so the detector never has to guess
//! intent. The one place intent *is* consulted is
//! [`ScanContext::upgrade_goal`]: a dependency manifest changed on purpose,
//! under a stated upgrade goal, is ordinary work; the same edit smuggled into
//! an unrelated change is `dependency_bump_to_satisfy_check`. The caller
//! states the goal; the detector never infers one.
//!
//! # Storage
//!
//! A project's mandate is an `app_settings` row keyed
//! `app_master_mandate:<project_id>` holding [`MandateRecord`] as JSON —
//! exactly the [`crate::autopilot`] `autopilot_mode:<project_id>` precedent,
//! so [`load_mandates`] is one prefix query per tick and a project with no row
//! carries no mandate (the overwhelmingly common case: nothing changes for a
//! project that was never hired into).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use personas_core::error::AppError;
use personas_db::DbPool;

// ---------------------------------------------------------------------------
// The scope ladder
// ---------------------------------------------------------------------------

/// Observe and report; no writes at all.
pub const RUNG_READ: u8 = 0;
/// Re-run existing work (a failed job, a flaky gate); no new change.
pub const RUNG_RETRY: u8 = 1;
/// Author a change and propose it; a human merges.
pub const RUNG_BRANCH: u8 = 2;
/// The highest rung v1 will grant to any holder. Rung 3 (deploy/merge) and 4
/// (change gates) are refused at intake — a holder who can edit the gates is
/// grading their own exam.
pub const MAX_GRANTABLE_RUNG: u8 = RUNG_BRANCH;

/// One-line label for a rung, for refusal messages and review packets.
pub fn rung_label(rung: u8) -> &'static str {
    match rung {
        RUNG_READ => "read",
        RUNG_RETRY => "retry",
        RUNG_BRANCH => "open branch/PR",
        3 => "deploy/merge (never granted in v1)",
        4 => "change gates (never granted)",
        _ => "unknown",
    }
}

// ---------------------------------------------------------------------------
// Forbidden change classes (closed vocabulary — mirrors kp's appmaster.py)
// ---------------------------------------------------------------------------

/// The closed vocabulary of forbidden change classes.
///
/// Serialized with kp's exact snake_case wire values. Unknown values are NOT
/// accepted (see [`ForbiddenClass::parse`]) — a class the enforcement layer
/// does not understand cannot be enforced, and storing it would produce a
/// mandate that *looks* stricter than it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForbiddenClass {
    /// Deleting, skipping or xfailing a test so a red suite reads green.
    TestDeletionOrSkip,
    /// `eslint-disable`, `# type: ignore`, `@ts-expect-error`, `# noqa`, …
    SuppressionDirective,
    /// Editing the gate / CI configuration the work is judged by.
    GateConfiguration,
    /// Moving a dependency version to make a check stop complaining.
    DependencyBumpToSatisfyCheck,
    /// Secrets, tokens, IAM, auth configuration, ownership files.
    CredentialsOrPermissions,
    /// Deploy targets, release channels, feature-flag rollout.
    DeliveryConfiguration,
}

/// Every class, in the order kp declares them.
pub const ALL_FORBIDDEN_CLASSES: [ForbiddenClass; 6] = [
    ForbiddenClass::TestDeletionOrSkip,
    ForbiddenClass::SuppressionDirective,
    ForbiddenClass::GateConfiguration,
    ForbiddenClass::DependencyBumpToSatisfyCheck,
    ForbiddenClass::CredentialsOrPermissions,
    ForbiddenClass::DeliveryConfiguration,
];

impl ForbiddenClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TestDeletionOrSkip => "test_deletion_or_skip",
            Self::SuppressionDirective => "suppression_directive",
            Self::GateConfiguration => "gate_configuration",
            Self::DependencyBumpToSatisfyCheck => "dependency_bump_to_satisfy_check",
            Self::CredentialsOrPermissions => "credentials_or_permissions",
            Self::DeliveryConfiguration => "delivery_configuration",
        }
    }

    /// Parse a wire value. `None` for anything outside the closed vocabulary.
    pub fn parse(s: &str) -> Option<Self> {
        ALL_FORBIDDEN_CLASSES
            .into_iter()
            .find(|c| c.as_str() == s.trim())
    }
}

// ---------------------------------------------------------------------------
// The mandate + its persisted record
// ---------------------------------------------------------------------------

/// The `mandate` block of an `AppMasterSpec`, as Personas enforces it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mandate {
    /// 0..=2. Validated at intake; [`MAX_GRANTABLE_RUNG`] is the ceiling.
    pub scope_rung: u8,
    #[serde(default)]
    pub forbidden_classes: Vec<ForbiddenClass>,
    /// Gate commands a proposal must pass before it is offered for review.
    #[serde(default)]
    pub approval_gates: Vec<String>,
    /// The human who reviews and answers escalations.
    #[serde(default)]
    pub owner: String,
}

impl Default for Mandate {
    fn default() -> Self {
        Self {
            scope_rung: RUNG_BRANCH,
            forbidden_classes: ALL_FORBIDDEN_CLASSES.to_vec(),
            approval_gates: Vec::new(),
            owner: String::new(),
        }
    }
}

impl Mandate {
    pub fn forbids(&self, class: ForbiddenClass) -> bool {
        self.forbidden_classes.contains(&class)
    }

    /// Refuse an action whose required rung is above the granted one.
    pub fn permits_rung(&self, required: u8, what: &str) -> Result<(), MandateRefusal> {
        if required <= self.scope_rung {
            return Ok(());
        }
        Err(MandateRefusal::AboveRung {
            action: what.to_string(),
            required,
            granted: self.scope_rung,
            owner: self.owner.clone(),
        })
    }
}

/// What Personas persists per project when an App master is hired. The mandate
/// is the enforceable part; the rest is what a probation review needs to exist
/// at all (creation-names-reaper: the retirement criteria are written at hire).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MandateRecord {
    /// The persona holding the role.
    pub persona_id: String,
    /// The `dev_projects.id` the role is bound to.
    pub project_id: String,
    pub mandate: Mandate,
    /// RFC-3339. Approval time + `tenure.probationDays`.
    pub probation_ends_at: String,
    /// `tenure.reviewCadenceDays`.
    #[serde(default)]
    pub review_cadence_days: i64,
    /// `tenure.retireCriteria`, verbatim.
    #[serde(default)]
    pub retire_criteria: Vec<String>,
    /// Set once the probation review has been decided, so the lifecycle tick
    /// raises exactly one review per hire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probation_decided_at: Option<String>,
    /// `activated` | `extended` | `retired` — the decision that was taken.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probation_decision: Option<String>,
    /// Set when a review packet has been raised and is awaiting the human, so
    /// the tick does not raise a second one every 300 s while it waits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probation_review_id: Option<String>,
}

/// Why an action was refused. Typed so a call site reports the reason rather
/// than logging "skipped" and leaving the owner to guess (A2 · escalation
/// fidelity: stop at the line and ask a *specific* question).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MandateRefusal {
    /// The action needs a higher rung than the mandate grants.
    AboveRung {
        action: String,
        required: u8,
        granted: u8,
        owner: String,
    },
    /// The proposal touches one or more forbidden change classes.
    ForbiddenClasses(Vec<Violation>),
}

impl std::fmt::Display for MandateRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AboveRung {
                action,
                required,
                granted,
                owner,
            } => {
                write!(
                    f,
                    "App master mandate refuses `{action}`: it needs rung {required} ({}), \
                     the mandate grants rung {granted} ({})",
                    rung_label(*required),
                    rung_label(*granted),
                )?;
                if !owner.is_empty() {
                    write!(f, ". Escalate to {owner}")?;
                }
                Ok(())
            }
            Self::ForbiddenClasses(v) => {
                write!(
                    f,
                    "App master mandate blocks this proposal: {} forbidden-class hit(s) — {}",
                    v.len(),
                    v.iter()
                        .map(Violation::one_line)
                        .collect::<Vec<_>>()
                        .join("; ")
                )
            }
        }
    }
}

impl From<MandateRefusal> for AppError {
    fn from(r: MandateRefusal) -> Self {
        AppError::Validation(r.to_string())
    }
}

// ---------------------------------------------------------------------------
// The deterministic forbidden-class detector
// ---------------------------------------------------------------------------

/// One forbidden-class hit: which class, which rule matched, where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Violation {
    pub class: ForbiddenClass,
    /// Stable rule id (e.g. `test-file-deletion`), so a refusal can be argued
    /// with and a rule can be retired by name.
    pub rule: &'static str,
    /// The repository-relative path the rule matched on.
    pub path: String,
    /// 1-based index of the matched **added** line within the file's hunks,
    /// for line rules. `None` for path rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    /// The matched text, trimmed and truncated. Empty for path rules.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub evidence: String,
}

impl Violation {
    pub fn one_line(&self) -> String {
        match self.line {
            Some(n) => format!(
                "{} [{}] {}:{}",
                self.class.as_str(),
                self.rule,
                self.path,
                n
            ),
            None => format!("{} [{}] {}", self.class.as_str(), self.rule, self.path),
        }
    }
}

/// What the caller knows that the diff does not say.
#[derive(Debug, Clone, Copy, Default)]
pub struct ScanContext {
    /// True when the change was dispatched *as* a dependency upgrade. Only
    /// then is a touched manifest ordinary work rather than
    /// `dependency_bump_to_satisfy_check`. The caller states this; the
    /// detector never infers it from the diff.
    pub upgrade_goal: bool,
}

const MAX_EVIDENCE_CHARS: usize = 160;

/// Does this path name a **test** file?
///
/// The `test_` prefix is matched at the start of the BASENAME only. As a bare
/// substring it also matches `latest_run.rs`, `greatest_hits.py` and anything
/// else containing "…test_…" — and a false positive here is not harmless: it
/// makes the generic skip markers (`.skip(`, `.only(`) fire on production code
/// and turns an ordinary line removal into a "deleted a test" violation.
fn is_test_path(lower: &str) -> bool {
    let base = basename(lower);
    base.starts_with("test_")
        || lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.contains("_test.")
        || lower.ends_with("_test")
        || lower.contains("/tests/")
        || lower.starts_with("tests/")
        || lower.contains("/__tests__/")
        || lower.contains("/spec/")
        || lower.starts_with("spec/")
}

/// Gate / CI / lint configuration — the instrument the work is judged by.
fn is_gate_config_path(lower: &str) -> bool {
    let base = basename(lower);
    lower.contains(".github/workflows/")
        || lower.contains(".circleci/")
        || matches!(
            base,
            ".gitlab-ci.yml"
                | "azure-pipelines.yml"
                | "lefthook.yml"
                | "lefthook.yaml"
                | ".pre-commit-config.yaml"
                | "pytest.ini"
                | "tox.ini"
                | "setup.cfg"
                | "jest.config.js"
                | "jest.config.ts"
                | "jest.config.mjs"
                | "jest.config.cjs"
                | "vitest.config.ts"
                | "vitest.config.js"
                | "vitest.config.mts"
                | "playwright.config.ts"
                | "playwright.config.js"
                | ".eslintrc"
                | ".eslintrc.js"
                | ".eslintrc.json"
                | ".eslintrc.cjs"
                | ".eslintrc.yml"
                | "eslint.config.js"
                | "eslint.config.mjs"
                | "eslint.config.ts"
                | "clippy.toml"
                | "rustfmt.toml"
                | ".rustfmt.toml"
                | "ruff.toml"
                | ".ruff.toml"
                | "mypy.ini"
                | "codecov.yml"
                | ".codecov.yml"
        )
        || base.starts_with("tsconfig") && (base.ends_with(".json") || base.ends_with(".jsonc"))
}

/// Dependency manifests and lockfiles.
fn is_dependency_manifest_path(lower: &str) -> bool {
    let base = basename(lower);
    matches!(
        base,
        "package.json"
            | "package-lock.json"
            | "pnpm-lock.yaml"
            | "yarn.lock"
            | "npm-shrinkwrap.json"
            | "cargo.toml"
            | "cargo.lock"
            | "pyproject.toml"
            | "poetry.lock"
            | "pipfile"
            | "pipfile.lock"
            | "go.mod"
            | "go.sum"
            | "gemfile"
            | "gemfile.lock"
            | "composer.json"
            | "composer.lock"
            | "pubspec.yaml"
            | "pubspec.lock"
    ) || base.starts_with("requirements") && base.ends_with(".txt")
}

/// Credentials, secrets, and the files that decide who may do what.
fn is_credential_path(lower: &str) -> bool {
    let base = basename(lower);
    base == ".env"
        || base.starts_with(".env.")
        || base.ends_with(".pem")
        || base.ends_with(".key")
        || base.ends_with(".p12")
        || base.ends_with(".pfx")
        || base.ends_with(".jks")
        || base.ends_with(".keystore")
        || matches!(
            base,
            "id_rsa"
                | "id_ed25519"
                | "authorized_keys"
                | ".netrc"
                | ".npmrc"
                | ".pypirc"
                | "codeowners"
                | "service-account.json"
        )
        || lower.contains("/secrets/")
        || lower.starts_with("secrets/")
        || lower.contains("/credentials/")
        || base.contains("credentials")
        || base.contains("iam-policy")
        || base.contains("iam_policy")
}

/// Where and how the app is delivered.
fn is_delivery_config_path(lower: &str) -> bool {
    let base = basename(lower);
    base == "dockerfile"
        || base.starts_with("dockerfile.")
        || base.starts_with("docker-compose")
        || base.ends_with(".tf")
        || base.ends_with(".tfvars")
        || matches!(
            base,
            "vercel.json"
                | "netlify.toml"
                | "fly.toml"
                | "railway.json"
                | "render.yaml"
                | "app.yaml"
                | "procfile"
                | "serverless.yml"
                | "serverless.yaml"
        )
        || lower.contains("/helm/")
        || lower.contains("/k8s/")
        || lower.contains("/kubernetes/")
        || lower.contains("/deploy/")
        || base.contains("feature-flags")
        || base.contains("feature_flags")
}

fn basename(lower_path: &str) -> &str {
    lower_path.rsplit('/').next().unwrap_or(lower_path)
}

/// Added-line rules for [`ForbiddenClass::SuppressionDirective`].
const SUPPRESSION_NEEDLES: &[(&str, &str)] = &[
    ("eslint-disable", "eslint-disable"),
    ("# noqa", "noqa"),
    ("#noqa", "noqa"),
    ("# type: ignore", "py-type-ignore"),
    ("#type:ignore", "py-type-ignore"),
    ("@ts-ignore", "ts-ignore"),
    ("@ts-expect-error", "ts-expect-error"),
    ("@ts-nocheck", "ts-nocheck"),
    ("#[allow(", "rust-allow-attr"),
    ("#![allow(", "rust-allow-attr"),
    ("#[expect(", "rust-expect-attr"),
    ("//nolint", "go-nolint"),
    ("// nolint", "go-nolint"),
    ("#pragma warning disable", "msvc-pragma-disable"),
    ("// prettier-ignore", "prettier-ignore"),
    ("// biome-ignore", "biome-ignore"),
    ("# pylint: disable", "pylint-disable"),
    ("# ruff: noqa", "ruff-noqa"),
];

/// Added-line rules for [`ForbiddenClass::TestDeletionOrSkip`]:
/// `(needle, rule id, only_in_test_paths)`.
///
/// Two properties are load-bearing here, and both were found by a test rather
/// than by reading:
///
/// 1. **Order.** The first needle that matches names the rule, and several are
///    substrings of others (`.skip(` sits inside `@pytest.mark.skip(`; `t.skip(`
///    sits inside `it.skip(`). Specific dialects come first, so a hit is
///    attributed to the rule a reader can act on. A Python skip reported as
///    `js-skip` is a correct block with a misleading receipt — and a receipt
///    nobody trusts is how a deterministic gate loses its authority.
/// 2. **Scope.** A marker that is unambiguous anywhere (`@pytest.mark.skip`,
///    `#[ignore]`, `xdescribe(`) is matched in every file. A marker that is
///    only a skip *in a test* (`.skip(`, `.only(`, `@ignore`) is matched only
///    under a test path — otherwise an ordinary `queue.skip(n)` in production
///    code reads as cheating, and a detector that cries wolf gets routed
///    around.
const SKIP_NEEDLES: &[(&str, &str, bool)] = &[
    ("@pytest.mark.skip", "pytest-skip", false),
    ("@pytest.mark.xfail", "pytest-xfail", false),
    ("pytest.skip(", "pytest-skip-call", false),
    ("@unittest.skip", "unittest-skip", false),
    ("t.skip(", "go-t-skip", false),
    ("#[ignore]", "rust-ignore", false),
    ("#[ignore =", "rust-ignore", false),
    ("xdescribe(", "js-xdescribe", false),
    ("xtest(", "js-xtest", false),
    ("xit(", "js-xit", false),
    (".skip(", "js-skip", true),
    (".only(", "js-only", true),
    ("@disabled", "junit-disabled", true),
    ("@ignore", "junit-ignore", true),
];

/// Substring match with an identifier boundary in front of the needle.
///
/// `t.skip(` must not fire on `it.skip(` — Go's `t.Skip` and Jest's `it.skip`
/// are different rules on different files, and the ladder above depends on
/// telling them apart. When the needle starts with an identifier character the
/// preceding character must not continue an identifier; needles that start with
/// punctuation (`.skip(`, `#[ignore]`, `@…`) need no boundary because the
/// punctuation IS one.
fn needle_hit(hay: &str, needle: &str) -> bool {
    let boundary_required = needle
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
    if !boundary_required {
        return hay.contains(needle);
    }
    let bytes = hay.as_bytes();
    let mut from = 0usize;
    while let Some(rel) = hay[from..].find(needle) {
        let at = from + rel;
        let prev_ok = at == 0 || {
            let p = bytes[at - 1];
            !(p.is_ascii_alphanumeric() || p == b'_' || p == b'.' || p == b'$')
        };
        if prev_ok {
            return true;
        }
        from = at + 1;
    }
    false
}

/// Scan a unified diff for forbidden-class hits.
///
/// Pure and total: an unparseable or empty diff yields no violations (a
/// detector that *claimed* a violation it could not evidence would be worse
/// than one that finds nothing — the caller's fallback is a human review
/// either way). `forbidden` is the mandate's list; classes not in it are not
/// scanned for, so a narrower mandate genuinely means fewer blocks.
///
/// Only **added** lines (`+`) are scanned for line rules: a suppression
/// directive that was already there is not this proposal's doing. Test
/// *deletions* are the exception — those are `-` lines, which is the point.
pub fn scan_diff(diff: &str, forbidden: &[ForbiddenClass], ctx: ScanContext) -> Vec<Violation> {
    let mut out: Vec<Violation> = Vec::new();
    let mut path = String::new();
    let mut path_seen: std::collections::HashSet<(ForbiddenClass, &'static str, String)> =
        std::collections::HashSet::new();
    let mut added_line_no = 0usize;
    let mut file_is_deleted = false;
    let mut test_removal_reported = false;

    let wants = |c: ForbiddenClass| forbidden.contains(&c);

    for raw in diff.lines() {
        // --- file header -----------------------------------------------------
        if let Some(rest) = raw.strip_prefix("+++ ") {
            let p = normalize_diff_path(rest);
            if !p.is_empty() {
                path = p;
                added_line_no = 0;
                test_removal_reported = false;
                scan_path_rules(&path, forbidden, ctx, &mut out, &mut path_seen);
            }
            continue;
        }
        if let Some(rest) = raw.strip_prefix("--- ") {
            // `+++ /dev/null` marks a deletion; the real name is on `---`.
            let p = normalize_diff_path(rest);
            if !p.is_empty() && path.is_empty() {
                path = p;
                scan_path_rules(&path, forbidden, ctx, &mut out, &mut path_seen);
            }
            continue;
        }
        if raw.starts_with("diff --git ") {
            path.clear();
            file_is_deleted = false;
            test_removal_reported = false;
            added_line_no = 0;
            continue;
        }
        if raw.starts_with("deleted file mode") {
            file_is_deleted = true;
            continue;
        }
        if raw.starts_with("@@") {
            continue;
        }

        // --- content lines ---------------------------------------------------
        if let Some(added) = raw.strip_prefix('+') {
            if added.starts_with("++") {
                continue; // a `+++` header we already handled
            }
            added_line_no += 1;
            let lower = added.to_ascii_lowercase();
            if wants(ForbiddenClass::SuppressionDirective) {
                if let Some((_, rule)) = SUPPRESSION_NEEDLES
                    .iter()
                    .find(|(needle, _)| needle_hit(&lower, needle))
                {
                    push_line_violation(
                        &mut out,
                        ForbiddenClass::SuppressionDirective,
                        rule,
                        &path,
                        added_line_no,
                        added,
                    );
                }
            }
            if wants(ForbiddenClass::TestDeletionOrSkip) {
                let in_test = is_test_path(&path.to_ascii_lowercase());
                if let Some((_, rule, _)) = SKIP_NEEDLES.iter().find(|(needle, _, test_only)| {
                    (!*test_only || in_test) && needle_hit(&lower, needle)
                }) {
                    push_line_violation(
                        &mut out,
                        ForbiddenClass::TestDeletionOrSkip,
                        rule,
                        &path,
                        added_line_no,
                        added,
                    );
                }
            }
            continue;
        }

        if let Some(removed) = raw.strip_prefix('-') {
            if removed.starts_with("--") {
                continue; // a `---` header we already handled
            }
            if wants(ForbiddenClass::TestDeletionOrSkip)
                && !test_removal_reported
                && !path.is_empty()
                && is_test_path(&path.to_ascii_lowercase())
                && !removed.trim().is_empty()
            {
                test_removal_reported = true;
                out.push(Violation {
                    class: ForbiddenClass::TestDeletionOrSkip,
                    rule: if file_is_deleted {
                        "test-file-deletion"
                    } else {
                        "test-line-removal"
                    },
                    path: path.clone(),
                    line: None,
                    evidence: truncate(removed.trim()),
                });
            }
        }
    }

    out
}

/// Path rules, applied once per file per (class, rule).
fn scan_path_rules(
    path: &str,
    forbidden: &[ForbiddenClass],
    ctx: ScanContext,
    out: &mut Vec<Violation>,
    seen: &mut std::collections::HashSet<(ForbiddenClass, &'static str, String)>,
) {
    let lower = path.to_ascii_lowercase();
    let mut hit = |class: ForbiddenClass, rule: &'static str, out: &mut Vec<Violation>| {
        if !forbidden.contains(&class) {
            return;
        }
        if !seen.insert((class, rule, path.to_string())) {
            return;
        }
        out.push(Violation {
            class,
            rule,
            path: path.to_string(),
            line: None,
            evidence: String::new(),
        });
    };

    if is_gate_config_path(&lower) {
        hit(ForbiddenClass::GateConfiguration, "gate-config-path", out);
    }
    if is_credential_path(&lower) {
        hit(
            ForbiddenClass::CredentialsOrPermissions,
            "credential-path",
            out,
        );
    }
    if is_delivery_config_path(&lower) {
        hit(
            ForbiddenClass::DeliveryConfiguration,
            "delivery-config-path",
            out,
        );
    }
    // A manifest touched under a STATED upgrade goal is ordinary work; the
    // same edit without one is the bump-to-satisfy-a-check move.
    if !ctx.upgrade_goal && is_dependency_manifest_path(&lower) {
        hit(
            ForbiddenClass::DependencyBumpToSatisfyCheck,
            "dependency-manifest-without-upgrade-goal",
            out,
        );
    }
}

fn push_line_violation(
    out: &mut Vec<Violation>,
    class: ForbiddenClass,
    rule: &'static str,
    path: &str,
    line: usize,
    text: &str,
) {
    out.push(Violation {
        class,
        rule,
        path: path.to_string(),
        line: Some(line),
        evidence: truncate(text.trim()),
    });
}

fn truncate(s: &str) -> String {
    if s.chars().count() <= MAX_EVIDENCE_CHARS {
        return s.to_string();
    }
    s.chars().take(MAX_EVIDENCE_CHARS).collect::<String>() + "…"
}

/// `b/src/foo.rs` → `src/foo.rs`; `/dev/null` → empty; strips a trailing
/// tab-separated timestamp (`git diff` writes one for some formats).
fn normalize_diff_path(raw: &str) -> String {
    let s = raw.split('\t').next().unwrap_or(raw).trim();
    if s.is_empty() || s == "/dev/null" {
        return String::new();
    }
    let s = s
        .strip_prefix("a/")
        .or_else(|| s.strip_prefix("b/"))
        .unwrap_or(s);
    s.trim_start_matches("./").replace('\\', "/")
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/// `app_settings` key prefix; the full key is
/// `app_master_mandate:<project_id>`. Allow-listed in
/// `personas_db::settings_keys::ALLOWED_PREFIXES`.
pub const APP_MASTER_MANDATE_PREFIX: &str = "app_master_mandate:";

pub fn mandate_setting_key(project_id: &str) -> String {
    format!("{APP_MASTER_MANDATE_PREFIX}{project_id}")
}

/// Read one project's mandate record. `Ok(None)` for a project that carries no
/// App master — the common case, and never an error.
///
/// A row that does not parse is treated as **absent** and logged: a corrupt
/// record must not be read as a *permissive* mandate. (The rung gate fails
/// open only in the sense that a project with no App master keeps its previous
/// behaviour exactly; enforcement is additive.)
pub fn get_mandate(pool: &DbPool, project_id: &str) -> Option<MandateRecord> {
    let raw = personas_db::repos::core::settings::get(pool, &mandate_setting_key(project_id))
        .ok()
        .flatten()?;
    match serde_json::from_str::<MandateRecord>(&raw) {
        Ok(r) => Some(r),
        Err(e) => {
            tracing::warn!(
                project_id,
                error = %e,
                "app_master: mandate row does not parse; treating the project as unmandated"
            );
            None
        }
    }
}

/// Load every project's mandate in one prefix query (project_id → record).
/// Mirrors [`crate::autopilot::load_modes`] so a tick pays one query.
pub fn load_mandates(pool: &DbPool) -> HashMap<String, MandateRecord> {
    let mut map = HashMap::new();
    if let Ok(rows) =
        personas_db::repos::core::settings::get_by_prefix(pool, APP_MASTER_MANDATE_PREFIX)
    {
        for (key, val) in rows {
            let Some(pid) = key.strip_prefix(APP_MASTER_MANDATE_PREFIX) else {
                continue;
            };
            match serde_json::from_str::<MandateRecord>(&val) {
                Ok(r) => {
                    map.insert(pid.to_string(), r);
                }
                Err(e) => tracing::warn!(
                    project_id = pid,
                    error = %e,
                    "app_master: mandate row does not parse; skipped"
                ),
            }
        }
    }
    map
}

/// Write (or overwrite) a project's mandate record.
pub fn set_mandate(pool: &DbPool, record: &MandateRecord) -> Result<(), AppError> {
    let json = serde_json::to_string(record)
        .map_err(|e| AppError::Internal(format!("app_master: mandate serialize: {e}")))?;
    personas_db::repos::core::settings::set(pool, &mandate_setting_key(&record.project_id), &json)
}

// ---------------------------------------------------------------------------
// Violation ledger
// ---------------------------------------------------------------------------

/// The `persona_events.event_type` a blocked proposal is recorded under. The
/// backbone's `forbiddenClassViolations` counter is a COUNT over these rows —
/// the number is a reading, not a tally somebody maintained by hand.
pub const VIOLATION_EVENT_TYPE: &str = "app_master.forbidden_class_violation";

/// Record blocked violations on the event ledger. `source_id` is the
/// **project id**, which is what the rollup counts by (the mandate is bound to
/// a project; the persona is bound to the mandate).
///
/// Best-effort: a ledger write that fails must not turn a *block* into an
/// *allow*, so the caller has already refused by the time this runs.
pub fn record_violations(pool: &DbPool, record: &MandateRecord, violations: &[Violation]) {
    if violations.is_empty() {
        return;
    }
    for v in violations {
        let payload = serde_json::json!({
            "class": v.class.as_str(),
            "rule": v.rule,
            "path": v.path,
            "line": v.line,
            "evidence": v.evidence,
            "personaId": record.persona_id,
            "projectId": record.project_id,
        })
        .to_string();
        if let Err(e) = personas_db::repos::communication::events::publish(
            pool,
            personas_db::models::CreatePersonaEventInput {
                event_type: VIOLATION_EVENT_TYPE.to_string(),
                source_type: "app_master".to_string(),
                project_id: Some(record.project_id.clone()),
                source_id: Some(record.project_id.clone()),
                target_persona_id: None,
                payload: Some(payload),
                use_case_id: None,
            },
        ) {
            tracing::warn!(
                project_id = %record.project_id,
                rule = v.rule,
                error = %e,
                "app_master: could not record a forbidden-class violation on the event ledger"
            );
        }
    }
}

/// Count recorded violations for a project since `since` (RFC-3339).
pub fn count_violations_since(pool: &DbPool, project_id: &str, since: &str) -> Option<i64> {
    personas_db::repos::communication::events::count_by_type_and_source_since(
        pool,
        VIOLATION_EVENT_TYPE,
        project_id,
        since,
    )
    .ok()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn all() -> Vec<ForbiddenClass> {
        ALL_FORBIDDEN_CLASSES.to_vec()
    }

    fn scan(diff: &str) -> Vec<Violation> {
        scan_diff(diff, &all(), ScanContext::default())
    }

    fn classes(v: &[Violation]) -> Vec<&'static str> {
        let mut c: Vec<&'static str> = v.iter().map(|x| x.class.as_str()).collect();
        c.sort_unstable();
        c.dedup();
        c
    }

    // -- the vocabulary is closed --------------------------------------------

    #[test]
    fn forbidden_class_wire_values_round_trip_and_reject_unknowns() {
        for c in ALL_FORBIDDEN_CLASSES {
            assert_eq!(ForbiddenClass::parse(c.as_str()), Some(c));
            // serde uses the same wire value as `as_str` — kp's coercer and the
            // enforcement layer must agree on the spelling or a mandate silently
            // narrows on round-trip.
            assert_eq!(
                serde_json::to_value(c).unwrap(),
                serde_json::Value::String(c.as_str().to_string())
            );
        }
        assert_eq!(ForbiddenClass::parse("merge_to_main"), None);
        assert_eq!(ForbiddenClass::parse(""), None);
        assert!(serde_json::from_str::<ForbiddenClass>("\"not_a_class\"").is_err());
    }

    // -- the rung ladder ------------------------------------------------------

    #[test]
    fn rung_gate_refuses_above_the_granted_rung_with_the_reason() {
        let m = Mandate {
            scope_rung: RUNG_RETRY,
            owner: "ana@example.com".into(),
            ..Default::default()
        };
        assert!(m.permits_rung(RUNG_READ, "kpi evaluation").is_ok());
        assert!(m.permits_rung(RUNG_RETRY, "assignment retry").is_ok());
        let err = m.permits_rung(RUNG_BRANCH, "dispatch fixes").unwrap_err();
        match &err {
            MandateRefusal::AboveRung {
                action,
                required,
                granted,
                owner,
            } => {
                assert_eq!(action, "dispatch fixes");
                assert_eq!(*required, 2);
                assert_eq!(*granted, 1);
                assert_eq!(owner, "ana@example.com");
            }
            other => panic!("wrong refusal: {other:?}"),
        }
        // The message names the action, both rungs and the owner to ask.
        let msg = err.to_string();
        assert!(msg.contains("dispatch fixes"), "{msg}");
        assert!(msg.contains("rung 2"), "{msg}");
        assert!(msg.contains("rung 1"), "{msg}");
        assert!(msg.contains("ana@example.com"), "{msg}");
    }

    #[test]
    fn a_read_only_mandate_permits_nothing_that_writes() {
        let m = Mandate {
            scope_rung: RUNG_READ,
            ..Default::default()
        };
        assert!(m.permits_rung(RUNG_READ, "scan").is_ok());
        assert!(m.permits_rung(RUNG_RETRY, "retry").is_err());
        assert!(m.permits_rung(RUNG_BRANCH, "branch").is_err());
    }

    // -- the detector: test deletion / skip -----------------------------------

    #[test]
    fn deleting_a_test_file_is_a_violation() {
        let diff = "\
diff --git a/src/foo.test.ts b/src/foo.test.ts
deleted file mode 100644
--- a/src/foo.test.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-describe('foo', () => {
-  it('works', () => expect(foo()).toBe(1));
-});
";
        let v = scan(diff);
        assert_eq!(classes(&v), vec!["test_deletion_or_skip"]);
        assert_eq!(v[0].rule, "test-file-deletion");
        assert_eq!(v[0].path, "src/foo.test.ts");
    }

    #[test]
    fn removing_assertions_from_a_surviving_test_file_is_a_violation() {
        let diff = "\
diff --git a/tests/test_scoring.py b/tests/test_scoring.py
--- a/tests/test_scoring.py
+++ b/tests/test_scoring.py
@@ -10,7 +10,6 @@ def test_score():
     assert score(a) == 3
-    assert score(b) == 4
";
        let v = scan(diff);
        assert_eq!(classes(&v), vec!["test_deletion_or_skip"]);
        assert_eq!(v[0].rule, "test-line-removal");
        assert_eq!(v[0].evidence, "assert score(b) == 4");
    }

    #[test]
    fn adding_a_skip_marker_is_a_violation_in_every_dialect() {
        let diff = "\
diff --git a/tests/test_a.py b/tests/test_a.py
--- a/tests/test_a.py
+++ b/tests/test_a.py
@@
+@pytest.mark.skip(reason=\"flaky\")
diff --git a/src/b.spec.ts b/src/b.spec.ts
--- a/src/b.spec.ts
+++ b/src/b.spec.ts
@@
+  it.skip('does the thing', () => {});
+  xit('and this one', () => {});
diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@
+    #[ignore]
";
        let v = scan(diff);
        let rules: Vec<&str> = v
            .iter()
            .filter(|x| x.class == ForbiddenClass::TestDeletionOrSkip)
            .map(|x| x.rule)
            .collect();
        assert!(rules.contains(&"pytest-skip"), "{rules:?}");
        assert!(rules.contains(&"js-skip"), "{rules:?}");
        assert!(rules.contains(&"js-xit"), "{rules:?}");
        assert!(rules.contains(&"rust-ignore"), "{rules:?}");
        assert!(rules.contains(&"js-skip"), "{rules:?}"); // the `it.skip(` line
                                                          // Ordering regression: `.skip(` is a substring of `@pytest.mark.skip(`.
                                                          // The specific dialect must win, or the receipt names a rule that does
                                                          // not apply to the file it fired on — so check the ATTRIBUTION, not
                                                          // just the presence, per file.
        let py_rules: Vec<&str> = v
            .iter()
            .filter(|x| x.path == "tests/test_a.py")
            .map(|x| x.rule)
            .collect();
        assert_eq!(py_rules, vec!["pytest-skip"], "{v:#?}");
    }

    #[test]
    fn go_and_python_skips_are_not_attributed_to_the_js_rule() {
        let diff = "\
diff --git a/pkg/thing_test.go b/pkg/thing_test.go
--- a/pkg/thing_test.go
+++ b/pkg/thing_test.go
@@
+\tt.Skip(\"flaky on CI\")
diff --git a/tests/test_b.py b/tests/test_b.py
--- a/tests/test_b.py
+++ b/tests/test_b.py
@@
+    pytest.skip(\"not today\")
";
        let rules: Vec<&str> = scan(diff)
            .iter()
            .filter(|v| v.class == ForbiddenClass::TestDeletionOrSkip)
            .map(|v| v.rule)
            .collect();
        assert!(rules.contains(&"go-t-skip"), "{rules:?}");
        assert!(rules.contains(&"pytest-skip-call"), "{rules:?}");
        assert!(!rules.contains(&"js-skip"), "{rules:?}");
    }

    #[test]
    fn the_go_skip_rule_does_not_fire_on_jest_it_skip() {
        // `t.skip(` is a substring of `it.skip(`. Without the identifier
        // boundary the Go rule swallows every Jest skip and the receipt points
        // at the wrong language.
        assert!(needle_hit("\tt.skip(\"why\")", "t.skip("));
        assert!(!needle_hit("  it.skip('x', () => {})", "t.skip("));
        // Punctuation-led needles need no boundary.
        assert!(needle_hit("  it.skip('x')", ".skip("));
    }

    #[test]
    fn generic_skip_markers_only_fire_inside_test_paths() {
        // `queue.skip(3)` in production code is not a skipped test. A detector
        // that blocks it would be routed around within a week.
        let prod = "\
diff --git a/src/queue.ts b/src/queue.ts
--- a/src/queue.ts
+++ b/src/queue.ts
@@
+  cursor = queue.skip(3);
";
        assert!(scan(prod).is_empty(), "{:#?}", scan(prod));

        // The same call shape inside a spec file IS a skipped test.
        let spec = "\
diff --git a/src/queue.spec.ts b/src/queue.spec.ts
--- a/src/queue.spec.ts
+++ b/src/queue.spec.ts
@@
+  it.skip('drains', () => {});
";
        let v = scan(spec);
        assert_eq!(v.len(), 1, "{v:#?}");
        assert_eq!(v[0].rule, "js-skip");

        // An UNAMBIGUOUS marker fires anywhere — a Rust `#[ignore]` lives in
        // `src/`, not under `tests/`, and is still a skipped test.
        let rust = "\
diff --git a/src-tauri/src/scoring.rs b/src-tauri/src/scoring.rs
--- a/src-tauri/src/scoring.rs
+++ b/src-tauri/src/scoring.rs
@@
+    #[ignore]
";
        let v = scan(rust);
        assert_eq!(v.len(), 1, "{v:#?}");
        assert_eq!(v[0].rule, "rust-ignore");
    }

    #[test]
    fn a_path_that_merely_contains_test_underscore_is_not_a_test_path() {
        // `latest_run.rs` contains "test_". Read as a test path it would make
        // every line removal in it a "deleted a test" violation.
        assert!(!is_test_path("src/latest_run.rs"));
        assert!(!is_test_path("pipeline/greatest_hits.py"));
        assert!(!is_test_path("src/contest_view.tsx"));
        // Real test paths still match, in every convention the repo uses.
        assert!(is_test_path("tests/test_scoring.py"));
        assert!(is_test_path("pipeline/jobfit/test_repo_scan.py"));
        assert!(is_test_path("src/foo.test.ts"));
        assert!(is_test_path("src/foo.spec.tsx"));
        assert!(is_test_path("pkg/thing_test.go"));
        assert!(is_test_path("src/__tests__/foo.tsx"));

        // End to end: a removal in `latest_run.rs` is not a violation.
        let diff = "diff --git a/src/latest_run.rs b/src/latest_run.rs
--- a/src/latest_run.rs
+++ b/src/latest_run.rs
@@
-    let old = 1;
+    let next = queue.skip(2);
";
        assert!(scan(diff).is_empty(), "{:#?}", scan(diff));
    }

    #[test]
    fn removing_a_line_from_a_non_test_file_is_not_a_violation() {
        let diff = "\
diff --git a/src/scoring.ts b/src/scoring.ts
--- a/src/scoring.ts
+++ b/src/scoring.ts
@@
-const old = 1;
+const next = 2;
";
        assert!(scan(diff).is_empty());
    }

    // -- the detector: suppression directives ---------------------------------

    #[test]
    fn added_suppression_directives_are_violations_and_pre_existing_ones_are_not() {
        let diff = "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@
 // eslint-disable-next-line no-console
+// @ts-expect-error the types are wrong
+const x: number = load(); // eslint-disable-line
";
        let v = scan(diff);
        assert_eq!(classes(&v), vec!["suppression_directive"]);
        // The CONTEXT line (leading space) carrying eslint-disable is not counted:
        // a directive that was already there is not this proposal's doing.
        assert_eq!(v.len(), 2, "{v:#?}");
        assert_eq!(v[0].rule, "ts-expect-error");
        assert_eq!(v[0].line, Some(1));
        assert_eq!(v[1].rule, "eslint-disable");
        assert_eq!(v[1].line, Some(2));
    }

    #[test]
    fn python_and_rust_suppressions_are_caught() {
        let diff = "\
diff --git a/pipeline/run.py b/pipeline/run.py
--- a/pipeline/run.py
+++ b/pipeline/run.py
@@
+value = compute()  # type: ignore
+other = risky()  # noqa: E501
diff --git a/src-tauri/src/x.rs b/src-tauri/src/x.rs
--- a/src-tauri/src/x.rs
+++ b/src-tauri/src/x.rs
@@
+#[allow(dead_code)]
";
        let rules: Vec<&str> = scan(diff).iter().map(|x| x.rule).collect();
        assert!(rules.contains(&"py-type-ignore"), "{rules:?}");
        assert!(rules.contains(&"noqa"), "{rules:?}");
        assert!(rules.contains(&"rust-allow-attr"), "{rules:?}");
    }

    // -- the detector: path classes -------------------------------------------

    #[test]
    fn touching_gate_configuration_is_a_violation() {
        for path in [
            ".github/workflows/ci.yml",
            "lefthook.yml",
            "tsconfig.json",
            "pytest.ini",
            "vitest.config.ts",
            "eslint.config.js",
        ] {
            let diff = format!(
                "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@\n+  foo: 1\n"
            );
            let v = scan(&diff);
            assert!(
                v.iter()
                    .any(|x| x.class == ForbiddenClass::GateConfiguration),
                "{path} was not classified as a gate config: {v:#?}"
            );
        }
    }

    #[test]
    fn a_dependency_manifest_is_a_violation_only_without_a_stated_upgrade_goal() {
        let diff = "\
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@
+    \"left-pad\": \"^1.3.0\",
";
        let blocked = scan(diff);
        assert_eq!(
            blocked
                .iter()
                .filter(|x| x.class == ForbiddenClass::DependencyBumpToSatisfyCheck)
                .count(),
            1,
            "{blocked:#?}"
        );
        assert_eq!(blocked[0].rule, "dependency-manifest-without-upgrade-goal");

        let allowed = scan_diff(diff, &all(), ScanContext { upgrade_goal: true });
        assert!(allowed.is_empty(), "{allowed:#?}");
    }

    #[test]
    fn credential_and_delivery_paths_are_violations() {
        let diff = "\
diff --git a/.env.production b/.env.production
--- a/.env.production
+++ b/.env.production
@@
+API_KEY=abc
diff --git a/deploy/k8s/app.yaml b/deploy/k8s/app.yaml
--- a/deploy/k8s/app.yaml
+++ b/deploy/k8s/app.yaml
@@
+  replicas: 5
";
        let v = scan(diff);
        assert!(v
            .iter()
            .any(|x| x.class == ForbiddenClass::CredentialsOrPermissions));
        assert!(v
            .iter()
            .any(|x| x.class == ForbiddenClass::DeliveryConfiguration));
    }

    // -- honesty properties ----------------------------------------------------

    #[test]
    fn a_narrower_mandate_scans_for_fewer_classes() {
        let diff = "\
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@
+      run: npm test -- --passWithNoTests  # eslint-disable-line
";
        // Full vocabulary: both the path class and the line class fire.
        assert_eq!(
            classes(&scan(diff)),
            vec!["gate_configuration", "suppression_directive"]
        );
        // A mandate that forbids only suppression directives blocks only that.
        let narrow = scan_diff(
            diff,
            &[ForbiddenClass::SuppressionDirective],
            ScanContext::default(),
        );
        assert_eq!(classes(&narrow), vec!["suppression_directive"]);
        // An empty forbidden list blocks nothing — the mandate is the authority.
        assert!(scan_diff(diff, &[], ScanContext::default()).is_empty());
    }

    #[test]
    fn an_ordinary_change_is_not_a_violation() {
        let diff = "\
diff --git a/src/features/pipeline/board.tsx b/src/features/pipeline/board.tsx
--- a/src/features/pipeline/board.tsx
+++ b/src/features/pipeline/board.tsx
@@ -12,6 +12,9 @@ export function Board() {
   const rows = useRows();
+  const sorted = useMemo(() => rows.slice().sort(byStage), [rows]);
+  if (!sorted.length) return <Empty />;
   return <Grid rows={sorted} />;
diff --git a/src/features/pipeline/board.test.tsx b/src/features/pipeline/board.test.tsx
--- a/src/features/pipeline/board.test.tsx
+++ b/src/features/pipeline/board.test.tsx
@@
+  it('renders the empty state', () => { expect(1).toBe(1); });
";
        // Adding a test is not a violation; only deleting or skipping one is.
        assert!(scan(diff).is_empty(), "{:#?}", scan(diff));
    }

    #[test]
    fn empty_and_garbage_diffs_yield_nothing() {
        assert!(scan("").is_empty());
        assert!(scan("not a diff at all\njust prose\n").is_empty());
        assert!(scan("@@ -1 +1 @@\n").is_empty());
    }

    #[test]
    fn each_violation_carries_the_rule_and_the_path_that_produced_it() {
        let diff = "\
diff --git a/tests/test_a.py b/tests/test_a.py
--- a/tests/test_a.py
+++ b/tests/test_a.py
@@
+@pytest.mark.skip
";
        let v = scan(diff);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].path, "tests/test_a.py");
        assert_eq!(v[0].rule, "pytest-skip");
        assert_eq!(v[0].line, Some(1));
        assert!(v[0].evidence.contains("pytest.mark.skip"));
        assert!(v[0].one_line().contains("tests/test_a.py:1"));
    }

    #[test]
    fn evidence_is_truncated_not_unbounded() {
        let long = "x".repeat(5000);
        let diff = format!(
            "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@\n+// @ts-ignore {long}\n"
        );
        let v = scan(&diff);
        assert_eq!(v.len(), 1);
        assert!(v[0].evidence.chars().count() <= MAX_EVIDENCE_CHARS + 1);
    }

    // -- the refusal is a block, never a rewrite -------------------------------

    #[test]
    fn refusal_display_enumerates_every_hit() {
        let v = scan(
            "\
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@
+  # @ts-ignore
",
        );
        let msg = MandateRefusal::ForbiddenClasses(v.clone()).to_string();
        assert!(msg.contains("blocks this proposal"), "{msg}");
        for hit in &v {
            assert!(msg.contains(hit.rule), "{msg} missing {}", hit.rule);
        }
    }

    // -- the persisted record --------------------------------------------------

    #[test]
    fn mandate_record_round_trips_through_json_with_kp_spellings() {
        let rec = MandateRecord {
            persona_id: "p1".into(),
            project_id: "proj1".into(),
            mandate: Mandate {
                scope_rung: 2,
                forbidden_classes: vec![
                    ForbiddenClass::TestDeletionOrSkip,
                    ForbiddenClass::GateConfiguration,
                ],
                approval_gates: vec!["npm run test:unit".into()],
                owner: "ana@example.com".into(),
            },
            probation_ends_at: "2026-09-22T10:00:00Z".into(),
            review_cadence_days: 30,
            retire_criteria: vec!["no merged proposal in two windows".into()],
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: None,
        };
        let json = serde_json::to_string(&rec).unwrap();
        assert!(json.contains("\"scopeRung\":2"), "{json}");
        assert!(json.contains("\"test_deletion_or_skip\""), "{json}");
        assert!(json.contains("\"probationEndsAt\""), "{json}");
        assert_eq!(serde_json::from_str::<MandateRecord>(&json).unwrap(), rec);
    }

    #[test]
    fn mandate_setting_key_matches_the_allow_listed_prefix() {
        let key = mandate_setting_key("proj_abc");
        assert_eq!(key, "app_master_mandate:proj_abc");
        assert!(
            personas_db::settings_keys::validate_key(&key).is_ok(),
            "the mandate prefix must be allow-listed or every write is rejected"
        );
        assert!(personas_db::settings_keys::validate_value(&key, "{\"a\":1}").is_ok());
        assert!(
            personas_db::settings_keys::validate_value(&key, "{ truncated").is_err(),
            "a truncated record must be rejected at write time, not read as an empty mandate"
        );
    }
}
