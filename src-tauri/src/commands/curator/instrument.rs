//! The instrument: the registry's own scripts, run as child processes and
//! parsed. **Read-only, no LLM, and it decides nothing.**
//!
//! The registry scores itself. Rather than re-implement that scoring here and
//! have two answers, this module runs the registry's own reads in its own
//! checkout and parses their JSON. The first three are one PASS, taken together
//! and cached together; the fourth is a separate entry point
//! ([`read_fleet_only`]) because it answers a different question for a
//! different consumer, and folding it in would make every projection pay for it
//! and every allowlist listing pay for the corpus:
//!
//! | read | what it answers | measured on this machine (2026-09-23) |
//! |---|---|---|
//! | `scripts/librarian-scan.mjs --json` | the corpus: 471 subjects, their clauses and points | **2.2 s**, 430 KB |
//! | `scripts/build-registry-map.mjs --check --json` | the consumers: 12 projects, 8,847 pairs | **8.7 s**, 21 KB, **exit 1** |
//! | `scripts/check-currency.mjs --json` | the clocks: expired / at-risk / unknown drift | **0.25 s**, 18 KB |
//! | `scripts/lib/projects.mjs` -> `loadFleet()` | which checkouts are on this disk | **0.3-0.5 s** |
//!
//! **The map check's exit 1 is a FINDING, not a failure.** It means the
//! generated maps are stale; the report it printed is complete and is what the
//! plan carries as `consumers.maps_stale`. Only a parse failure or a missing
//! script is an error here. The brief that commissioned this expected the scan
//! to be the slow read; it is not - the map check is **4x** slower, because it
//! walks twelve consumer checkouts rather than one corpus. The timeouts below
//! are sized from the measurement, not from the expectation.
//!
//! **The fleet is resolved through `scripts/lib/projects.mjs`**, never by
//! reading `projects.json` / `.machine.local.json` directly - that is the
//! registry's own rule, and its `loadFleet(root)` is a callable resolver
//! returning `{ machine, contributor, projects: { slug: { path, exists, … } },
//! problems }`. It is invoked as a module through `node --input-type=module`
//! so there is exactly one implementation of the machine-override and
//! portable-checkout rules, in the registry, where they belong.
//!
//! **The reads never run concurrently** - with each other or with a second
//! caller. One `tokio::sync::Mutex` serialises the whole instrument, because
//! three node processes walking the same twelve checkouts at once is contention
//! for no gain, and because the map check WRITES when it is not in `--check`
//! mode; serialising now is the cheap habit to have already formed.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use personas_core::types::CliArgs;
use serde::Deserialize;

use crate::engine::cli_process::{capture_output, CapturedOutput};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Timeouts - each a generous multiple of the measured time, because a cold
// node start, a virus scanner or a corpus twice this size all inflate it and
// none of them is a reason to fail. They are ceilings on a hang, not budgets.
// ---------------------------------------------------------------------------

/// Measured 2.2 s.
const SCAN_TIMEOUT: Duration = Duration::from_secs(60);
/// Measured 8.7 s - the SLOW one, four times the scan.
const MAP_TIMEOUT: Duration = Duration::from_secs(120);
/// Measured 0.25 s.
const CURRENCY_TIMEOUT: Duration = Duration::from_secs(30);
/// Measured 0.3-0.5 s.
const FLEET_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a cached reading stays good.
///
/// A TTL is not belt-and-braces here, it is required. The cache key can only
/// carry the REGISTRY's HEAD, and the pass does not depend on that alone: the
/// map check walks twelve OTHER repositories whose commits this sha cannot see,
/// and any read is stale the moment the working copy is edited without a
/// commit. Five minutes bounds both, and the pass costs ~11 s, so paying it
/// again is cheap.
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);

// ---------------------------------------------------------------------------
// What the scripts say. Every struct here is a PARSE of somebody else's JSON,
// so unknown fields are ignored on purpose (serde's default): the registry adds
// fields to these reports routinely and none of them may break this door.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDemand {
    #[serde(default)]
    pub consults: u32,
    #[serde(default)]
    pub deviations: u32,
    #[serde(default)]
    pub deviations_summed: u32,
    #[serde(default)]
    pub gone: u32,
    #[serde(default)]
    pub gone_summed: u32,
    #[serde(default)]
    pub contributors: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSubject {
    /// `<domain>/<slug>`.
    pub id: String,
    pub domain: String,
    pub slug: String,
    /// Where the subject sits in its bundle's taxonomy.
    pub at: String,
    #[serde(default)]
    pub techniques: u32,
    #[serde(default)]
    pub applications: u32,
    #[serde(default)]
    pub stacks: Vec<String>,
    #[serde(default)]
    pub demand_known: bool,
    /// Absent when no consumer reports demand. UNKNOWN, never zero.
    #[serde(default)]
    pub demand: Option<ScanDemand>,
    #[serde(default)]
    pub last_swept: Option<String>,
    /// The registry's own field. Carried, never trusted - see the `e49`
    /// migration header for the measurement that says why.
    #[serde(default)]
    pub dry_streak: u32,
    #[serde(default)]
    pub points: u32,
    /// The scan's own sentences, one per clause that fired.
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDomain {
    #[serde(default)]
    pub techniques: u32,
    #[serde(default)]
    pub applications: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarianScan {
    pub generated_at: String,
    #[serde(default)]
    pub today: String,
    #[serde(default)]
    pub demand_known_for_any_bundle: bool,
    #[serde(default)]
    pub domains: Vec<ScanDomain>,
    #[serde(default)]
    pub subjects: Vec<ScanSubject>,
}

/// The map check's per-project row. Its field names are snake_case while the
/// envelope's are camelCase; both are spelled as the script writes them.
#[derive(Debug, Clone, Deserialize)]
pub struct MapProject {
    pub slug: String,
    #[serde(default)]
    pub contexts: u32,
    #[serde(default)]
    pub pairs: u32,
    #[serde(default)]
    pub weak: u32,
    #[serde(default)]
    pub evaluated: u32,
    #[serde(default)]
    pub deviations: u32,
    #[serde(default)]
    pub stale_verdicts: u32,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub orphaned: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct MapTotals {
    #[serde(default)]
    pub projects: u32,
    #[serde(default)]
    pub pairs: u32,
    #[serde(default)]
    pub evaluated: u32,
    #[serde(default)]
    pub weak: u32,
    #[serde(default)]
    pub stale_verdicts: u32,
    #[serde(default)]
    pub stale_projects: u32,
    #[serde(default)]
    pub orphaned: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MapCheck {
    #[serde(rename = "generatedAt", default)]
    pub generated_at: String,
    #[serde(default)]
    pub projects: Vec<MapProject>,
    #[serde(default)]
    pub totals: MapTotals,
    #[serde(default)]
    pub problems: Vec<String>,
    /// NOT from the JSON: the script's exit status, folded in here because a
    /// non-zero exit is the report's own headline finding.
    #[serde(skip)]
    pub maps_stale: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyTotals {
    #[serde(default)]
    pub expired: u32,
    #[serde(default)]
    pub at_risk: u32,
    /// Applications whose stack version could not be compared at all. Unknown
    /// drift, never zero drift.
    #[serde(default)]
    pub drift_unknown: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Currency {
    #[serde(default)]
    pub totals: CurrencyTotals,
    /// Only the COUNT is used, so the rows are parsed as opaque - the shape of
    /// a drift row is the registry's business and it changes.
    #[serde(default)]
    pub drift: Vec<serde::de::IgnoredAny>,
}

/// One checkout `loadFleet` found declared for this machine.
#[derive(Debug, Clone, Deserialize)]
pub struct FleetProject {
    pub slug: String,
    pub path: String,
    #[serde(default)]
    pub exists: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct FleetReport {
    #[serde(default)]
    projects: std::collections::BTreeMap<String, FleetProject>,
    #[serde(default)]
    problems: Vec<String>,
}

/// Everything one instrument pass read, parsed.
#[derive(Debug, Clone)]
pub struct InstrumentReading {
    pub scan: LibrarianScan,
    pub map: MapCheck,
    pub currency: Currency,
    /// Distinct subject slugs named in `librarian/applied.md`.
    ///
    /// `None` means the ledger could not be READ. A ledger that is simply
    /// absent gives `Some(empty)`: a fresh registry has applied nothing, which
    /// is a real answer, while an IO error is not.
    pub applied_subjects: Option<BTreeSet<String>>,
    /// The registry checkout's short HEAD. `None` when git could not answer,
    /// which also makes the reading uncacheable.
    pub head_sha: Option<String>,
}

// ---------------------------------------------------------------------------
// Running one script
//
// The spawn itself goes through `cli_process::capture_output`, the subprocess
// chokepoint, and the git read through `git_checkpoint::run_git`, the git argv
// owner. Neither is a style preference: a `Command::new` here would create a
// child that has agreed to none of the guarantees this app makes about its
// children, and the properties `capture_output` owns are exactly the ones this
// read needs - both pipes drained CONCURRENTLY with the wait (the scan writes
// 430 KB and an undrained pipe stalls a child at tens of kilobytes), an
// explicit kill and reap on timeout, `env_clear()` down to a named allowlist,
// `CREATE_NO_WINDOW`, and **the exit status returned as DATA rather than as an
// error** - which is what lets the map check's exit 1 be read as the finding it
// is. This module shapes argv and reads outcomes; it owns no spawn policy.
// ---------------------------------------------------------------------------

/// Run `node <args>` in the registry checkout, bounded by `timeout`.
///
/// `cwd` is the checkout because every one of these scripts resolves its own
/// paths from `process.cwd()`.
pub(super) async fn run_node(
    cwd: &Path,
    args: Vec<String>,
    timeout: Duration,
    what: &str,
) -> Result<CapturedOutput, AppError> {
    let cli_args = CliArgs {
        command: "node".to_string(),
        args,
        env_overrides: Vec::new(),
        env_removals: Vec::new(),
        cwd: Some(cwd.to_path_buf()),
    };
    capture_output(&cli_args, timeout).await.map_err(|e| {
        // One variant for all three of the chokepoint's failures - a spawn that
        // did not start, a wait that timed out, a pipe that could not be read -
        // and its own sentence carried whole.
        //
        // The alternative was to branch on `e.contains("timed out")`, and that
        // is the failure `privately-reclassified-failure` names: the class of a
        // failure would be re-derived from prose at this call site rather than
        // from a discriminator, giving this module a private vocabulary that
        // drifts the moment the chokepoint rewords a message. Nothing here acts
        // differently on the three anyway - each one means the instrument has no
        // answer - so the distinction would have been a claim with no consumer.
        // If a caller ever needs it, the honest fix is a typed outcome from
        // `capture_output`, not a substring test here.
        AppError::ProcessSpawn(format!(
            "curator instrument: {what} (limit {}s): {e}",
            timeout.as_secs()
        ))
    })
}

/// Parse a read's stdout, naming the read in the failure.
///
/// Deliberately NOT permissive: a report that does not parse is a report this
/// app does not understand, and projecting a plan from a default-filled
/// structure would put invented numbers in front of a person. The tail of
/// stderr rides along because it is usually the node stack that explains it.
pub(super) fn parse_json<T: serde::de::DeserializeOwned>(
    out: &CapturedOutput,
    what: &str,
) -> Result<T, AppError> {
    serde_json::from_str::<T>(out.stdout.trim()).map_err(|e| {
        let hint = out.stderr.trim();
        let hint = if hint.is_empty() {
            String::new()
        } else {
            // By CHARACTER, not by byte: a node stack can end mid-codepoint and
            // slicing a `str` there panics.
            let start = hint
                .char_indices()
                .rev()
                .nth(400)
                .map(|(i, _)| i)
                .unwrap_or(0);
            format!(" (stderr: {})", &hint[start..])
        };
        AppError::Internal(format!(
            "curator instrument: {what} produced unreadable JSON: {e}{hint}"
        ))
    })
}

// ---------------------------------------------------------------------------
// Git and the applied ledger
// ---------------------------------------------------------------------------

/// The registry checkout's short HEAD, or `None` when git cannot answer.
///
/// Through `git_checkpoint::run_git`, which that module's own doc comment calls
/// "the ONE place a git child is assembled" - so this read inherits the
/// hardening flags (`gc.auto=0`, `core.hooksPath=/dev/null`) that stop a
/// background read from tripping maintenance or a hook in a repository this app
/// does not own.
///
/// Degraded rather than fatal: a corpus read without a version is still a
/// correct read, it just cannot be cached.
async fn git_head_short(dir: &Path) -> Option<String> {
    crate::engine::git_checkpoint::run_git(dir, &["rev-parse", "--short", "HEAD"])
        .await
        .ok()
        .filter(|sha| !sha.is_empty())
}

/// Which subjects `librarian/applied.md` names.
///
/// The ledger is a markdown table, `| Date | Technique | Subject | Project |
/// Mode | Verdict | … |`, one row per Phase 7.5 A/B test. A subject with no row
/// has never been tried against a managed project and is, in the registry's own
/// words, "a wiki page".
///
/// The two absences are kept apart, which is the whole reason this returns an
/// `Option`: a ledger that is NOT THERE gives an empty set (a fresh registry
/// has applied nothing - a real answer), while a ledger that cannot be read
/// gives `None` (unknown, and `has_applied_row` stays NULL rather than
/// claiming "never applied").
fn applied_subjects(registry_root: &Path) -> Option<BTreeSet<String>> {
    let path = registry_root.join("librarian").join("applied.md");
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(BTreeSet::new()),
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(),
                "curator: applied ledger unreadable - reporting UNKNOWN, not 'never applied'");
            return None;
        }
    };
    let mut out = BTreeSet::new();
    for line in raw.lines() {
        let line = line.trim();
        if !line.starts_with('|') {
            continue;
        }
        let cells: Vec<&str> = line.split('|').collect();
        // ['', date, technique, subject, project, mode, verdict, …, ''] - a row
        // with fewer cells is the header separator or a truncated line.
        let Some(subject) = cells.get(3).map(|c| c.trim()) else {
            continue;
        };
        // Skip the header and the `| --- |` rule, which occupy the same shape.
        if subject.is_empty()
            || subject.eq_ignore_ascii_case("subject")
            || subject.chars().all(|c| c == '-' || c == ':')
        {
            continue;
        }
        out.insert(subject.to_string());
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/// One caller at a time, whatever the cache says.
///
/// Three node processes walking the same twelve checkouts concurrently is
/// contention for no gain, and the map script has a mode that WRITES; forming
/// the habit here costs one lock.
static INSTRUMENT_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

type CacheSlot = Option<(String, Instant, Arc<InstrumentReading>)>;
/// One slot: there is one registry, and the page re-reads it on navigation.
/// Overwritten on the next distinct key, so it names its reaper.
static INSTRUMENT_CACHE: OnceLock<Mutex<CacheSlot>> = OnceLock::new();

fn cache_key(registry_root: &Path, head: &str) -> String {
    format!("{}\u{0}{head}", registry_root.to_string_lossy())
}

/// Read the registry's instrument, from cache when the corpus has not moved.
///
/// The cache is keyed on the checkout path plus its HEAD and expires after
/// [`CACHE_TTL`]. **A reading with no HEAD is never cached** - nothing else
/// identifies the corpus version, so serving it again later would be serving an
/// unknown. The FAILURE is never cached either: a `Result` in a process-global
/// slot freezes the first attempt's error for the life of the process, and the
/// usual cause here (a half-written report, a node that was not installed yet)
/// clears by itself.
pub async fn read(registry_root: &Path) -> Result<Arc<InstrumentReading>, AppError> {
    let _serialised = INSTRUMENT_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;

    let head = git_head_short(registry_root).await;
    let key = head.as_ref().map(|h| cache_key(registry_root, h));

    if let Some(key) = key.as_deref() {
        let cache = INSTRUMENT_CACHE.get_or_init(|| Mutex::new(None));
        let guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((k, at, reading)) = guard.as_ref() {
            if k == key && at.elapsed() < CACHE_TTL {
                return Ok(Arc::clone(reading));
            }
        }
    }

    let reading = Arc::new(read_uncached(registry_root, head).await?);

    if let Some(key) = key {
        let cache = INSTRUMENT_CACHE.get_or_init(|| Mutex::new(None));
        let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        *guard = Some((key, Instant::now(), Arc::clone(&reading)));
    }
    Ok(reading)
}

/// Just the fleet - which checkouts the registry declares for this machine.
///
/// Split out from [`read`] because it is the ONLY read the allowlist needs, and
/// the difference is not small: measured 2026-09-23, the fleet resolver is
/// 0.3-0.5 s while the whole instrument is ~11 s, almost all of it the map
/// check walking twelve consumer checkouts. Listing projects had no business
/// paying for a corpus scan.
///
/// It takes the same lock, so it can wait behind a projection in flight. That
/// is the deliberate trade: "the reads never run concurrently" is a property
/// worth more than a list that never waits, and the wait is bounded by the map
/// check's own timeout.
pub async fn read_fleet_only(
    registry_root: &Path,
) -> Result<(Vec<FleetProject>, Vec<String>), AppError> {
    let _serialised = INSTRUMENT_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    read_fleet(registry_root).await
}

/// The three corpus-side reads, in sequence. Never concurrent with each other.
///
/// The fleet is NOT among them: it answers a different question (which
/// checkouts exist) for a different consumer (the allowlist), and folding it in
/// would have made every projection pay for it and every project listing pay
/// for the corpus.
async fn read_uncached(
    registry_root: &Path,
    head_sha: Option<String>,
) -> Result<InstrumentReading, AppError> {
    let scan_script = script(registry_root, "librarian-scan.mjs")?;
    let map_script = script(registry_root, "build-registry-map.mjs")?;
    let currency_script = script(registry_root, "check-currency.mjs")?;

    let scan_out = run_node(
        registry_root,
        vec![scan_script, "--json".into()],
        SCAN_TIMEOUT,
        "librarian-scan",
    )
    .await?;
    let scan: LibrarianScan = parse_json(&scan_out, "librarian-scan")?;

    let map_out = run_node(
        registry_root,
        vec![map_script, "--check".into(), "--json".into()],
        MAP_TIMEOUT,
        "build-registry-map",
    )
    .await?;
    // A non-zero exit here means the generated maps are STALE. The report is
    // complete and is what gets parsed; the status becomes a field.
    let mut map: MapCheck = parse_json(&map_out, "build-registry-map")?;
    map.maps_stale = !map_out.status.success();

    let currency_out = run_node(
        registry_root,
        vec![currency_script, "--json".into()],
        CURRENCY_TIMEOUT,
        "check-currency",
    )
    .await?;
    let currency: Currency = parse_json(&currency_out, "check-currency")?;

    Ok(InstrumentReading {
        scan,
        map,
        currency,
        applied_subjects: applied_subjects(registry_root),
        head_sha,
    })
}

/// Resolve the fleet through the registry's own module.
///
/// `--input-type=module` so the `import` resolves relative to the checkout,
/// which is also the cwd. Reading `projects.json` / `.machine.local.json`
/// directly is explicitly forbidden by the registry: the machine-override and
/// portable-checkout rules live in that module and must have one
/// implementation.
async fn read_fleet(registry_root: &Path) -> Result<(Vec<FleetProject>, Vec<String>), AppError> {
    let resolver = registry_root
        .join("scripts")
        .join("lib")
        .join("projects.mjs");
    if !resolver.is_file() {
        return Err(AppError::NotFound(format!(
            "curator instrument: the registry at {} has no scripts/lib/projects.mjs, so the \
             fleet cannot be resolved - and reading projects.json directly is forbidden by the \
             registry's own rule",
            registry_root.display()
        )));
    }
    let out = run_node(
        registry_root,
        vec![
            "--input-type=module".into(),
            "-e".into(),
            "import {loadFleet} from './scripts/lib/projects.mjs'; \
             process.stdout.write(JSON.stringify(loadFleet(process.cwd())));"
                .into(),
        ],
        FLEET_TIMEOUT,
        "loadFleet",
    )
    .await?;
    if !out.status.success() {
        return Err(AppError::Internal(format!(
            "curator instrument: loadFleet failed: {}",
            out.stderr.trim()
        )));
    }
    let report: FleetReport = parse_json(&out, "loadFleet")?;
    // `BTreeMap` already orders by slug, so the list is stable across machines.
    Ok((report.projects.into_values().collect(), report.problems))
}

/// Resolve one of the registry's scripts, refusing early if it is absent.
///
/// A missing script is an error (not a finding): it means this is not a
/// registry checkout, or one older than the instrument this app was built
/// against, and either way there is nothing to project.
pub(super) fn script(registry_root: &Path, name: &str) -> Result<String, AppError> {
    let path: PathBuf = registry_root.join("scripts").join(name);
    if !path.is_file() {
        return Err(AppError::NotFound(format!(
            "curator instrument: the registry at {} has no scripts/{name}",
            registry_root.display()
        )));
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A successful exit status, built without spawning anything. `ExitStatus`
    /// has no public constructor outside the platform extension traits, and
    /// both spell it the same way.
    fn exited_ok() -> std::process::ExitStatus {
        #[cfg(windows)]
        {
            use std::os::windows::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(0)
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(0)
        }
    }

    /// The ledger is a markdown table and the Subject is its third cell. The
    /// header and its `---` rule share that shape and must not become subjects.
    #[test]
    fn the_applied_ledger_parses_subjects_and_skips_its_own_header() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("librarian");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(
            lib.join("applied.md"),
            "# Applied ledger\n\nSome prose about modes.\n\n\
             | Date | Technique | Subject | Project | Mode | Verdict | Note |\n\
             | --- | --- | --- | --- | --- | --- | --- |\n\
             | 2026-09-06 | inline-predicate-rung-inference | conformance-checking | personas | experiment | better | x |\n\
             | 2026-09-04 | decay-and-forgetting | agent-memory | personas | experiment | better | y |\n\
             | 2026-09-04 | consolidation | agent-memory | personas | simulation | not-better | z |\n",
        )
        .unwrap();

        let found = applied_subjects(dir.path()).expect("a readable ledger");
        assert_eq!(found.len(), 2, "duplicates collapse: {found:?}");
        assert!(found.contains("conformance-checking"));
        assert!(found.contains("agent-memory"));
        assert!(!found.contains("Subject"), "the header is not a subject");
        assert!(!found.iter().any(|s| s.starts_with("---")));
    }

    /// A ledger that is NOT THERE is a real answer - a fresh registry has
    /// applied nothing. It must not be confused with one that could not be
    /// read, which is what makes `has_applied_row` nullable.
    #[test]
    fn an_absent_ledger_is_an_empty_set_not_an_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let found = applied_subjects(dir.path());
        assert_eq!(found, Some(BTreeSet::new()));
    }

    /// A directory where the file should be is an IO error, not a NotFound -
    /// the one case that must report UNKNOWN.
    #[test]
    fn an_unreadable_ledger_is_unknown() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("librarian").join("applied.md")).unwrap();
        assert_eq!(applied_subjects(dir.path()), None);
    }

    /// A checkout with no scripts is refused by NAME, so the failure says which
    /// read could not be set up rather than surfacing a node error later.
    #[test]
    fn a_checkout_without_the_scripts_is_refused_early() {
        let dir = tempfile::tempdir().unwrap();
        let err = script(dir.path(), "librarian-scan.mjs").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
        assert!(format!("{err:?}").contains("librarian-scan.mjs"));
    }

    /// Git is degraded, never fatal: a directory that is not a repository
    /// simply has no version, which is what makes a reading uncacheable rather
    /// than unusable.
    #[tokio::test]
    async fn a_non_repository_has_no_head_rather_than_failing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(git_head_short(dir.path()).await, None);
    }

    /// The scan's envelope is camelCase and the map check's rows are
    /// snake_case while its envelope is not. Both are parsed as the scripts
    /// write them, and an unknown field must never break the door.
    #[test]
    fn the_two_report_shapes_parse_as_the_scripts_write_them() {
        let scan: LibrarianScan = serde_json::from_str(
            r#"{"generatedAt":"2026-09-22T22:39:52.343Z","today":"2026-09-22",
                "demandKnownForAnyBundle":true,"aFieldAddedLater":1,
                "domains":[{"domain":"x","subjects":8,"techniques":25,"applications":12}],
                "subjects":[{"id":"d/s","domain":"d","slug":"s","at":"c/s","category":null,
                             "techniques":3,"applications":2,"stacks":["process"],
                             "demandKnown":false,"demand":null,"lastSwept":null,
                             "dryStreak":0,"points":9,"reasons":["never swept by the librarian"],
                             "bytes":12301}]}"#,
        )
        .unwrap();
        assert_eq!(scan.subjects.len(), 1);
        assert_eq!(scan.subjects[0].id, "d/s");
        assert_eq!(scan.subjects[0].demand, None);
        assert_eq!(scan.subjects[0].last_swept, None);
        assert_eq!(scan.domains[0].techniques, 25);
        assert!(scan.demand_known_for_any_bundle);

        let map: MapCheck = serde_json::from_str(
            r#"{"schema":"rkb-registry-map-report/1","generatedAt":"2026-09-23T08:45:22Z",
                "projects":[{"slug":"personas","contexts":215,"pairs":1765,"weak":14,
                             "evaluated":179,"deviations":122,"stale_verdicts":147,
                             "state":"STALE","dead":1,"orphaned":0}],
                "totals":{"projects":12,"pairs":8847,"evaluated":319,"weak":63,
                          "stale_verdicts":216,"stale_projects":12,"orphaned":10},
                "problems":[]}"#,
        )
        .unwrap();
        assert_eq!(map.projects[0].stale_verdicts, 147);
        assert_eq!(map.totals.pairs, 8847);
        // The exit status is not in the JSON, so it defaults to "not stale"
        // until the runner folds the real status in.
        assert!(!map.maps_stale);

        let currency: Currency = serde_json::from_str(
            r#"{"generatedAt":"x","totals":{"applications":1825,"expired":0,"atRisk":4,
                "noClock":301,"driftUnknown":505,"contributors":2},
                "expired":[],"atRisk":[{"id":"a"}],
                "drift":[{"id":"a","stack":"node"},{"id":"b","stack":"rust"}]}"#,
        )
        .unwrap();
        assert_eq!(currency.totals.drift_unknown, 505);
        assert_eq!(currency.totals.at_risk, 4);
        assert_eq!(currency.drift.len(), 2);
    }

    /// The resolver's report is a map keyed by slug, and `exists` is what the
    /// allowlist seed keys on.
    #[test]
    fn the_fleet_report_parses_and_orders_by_slug() {
        let report: FleetReport = serde_json::from_str(
            r#"{"machine":"Wolf","contributor":"wolf","problems":["kp: checkout not found"],
                "projects":{"personas":{"slug":"personas","path":"C:/k/personas","exists":true},
                            "ascent":{"slug":"ascent","path":"C:/k/ascent","exists":true},
                            "kp":{"slug":"kp","path":"C:/k/kp","exists":false}}}"#,
        )
        .unwrap();
        let slugs: Vec<&str> = report.projects.values().map(|p| p.slug.as_str()).collect();
        assert_eq!(slugs, vec!["ascent", "kp", "personas"]);
        assert!(!report.projects["kp"].exists);
        assert_eq!(report.problems.len(), 1);
    }

    /// A report this app cannot parse is an ERROR, never a default-filled
    /// structure: projecting a plan from invented numbers puts them in front of
    /// a person.
    #[test]
    fn an_unreadable_report_fails_by_name_and_carries_the_stderr() {
        let out = CapturedOutput {
            stdout: "not json at all".into(),
            stderr: "SyntaxError: boom".into(),
            status: exited_ok(),
        };
        let err = parse_json::<LibrarianScan>(&out, "librarian-scan").unwrap_err();
        let text = format!("{err:?}");
        assert!(text.contains("librarian-scan"), "{text}");
        assert!(text.contains("SyntaxError"), "{text}");
    }

    /// The cache key must separate two checkouts and two commits of one
    /// checkout, and must not collide across the boundary between them.
    #[test]
    fn the_cache_key_separates_checkouts_and_commits() {
        let a = cache_key(Path::new("C:/k/ai-registry"), "abc1234");
        let b = cache_key(Path::new("C:/k/ai-registry"), "def5678");
        let c = cache_key(Path::new("C:/k/other"), "abc1234");
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_eq!(a, cache_key(Path::new("C:/k/ai-registry"), "abc1234"));
    }

    /// The timeouts are ceilings on a hang, sized from the measurement. The
    /// map check is the slow read - four times the scan - and the brief that
    /// commissioned this expected the opposite, so the ordering is pinned.
    #[test]
    fn the_map_check_gets_the_longest_leash() {
        assert!(MAP_TIMEOUT > SCAN_TIMEOUT);
        assert!(SCAN_TIMEOUT > CURRENCY_TIMEOUT);
        assert!(
            SCAN_TIMEOUT >= Duration::from_secs(20),
            "20x the measured 2.2s"
        );
        assert!(
            MAP_TIMEOUT >= Duration::from_secs(90),
            "10x the measured 8.7s"
        );
    }
}
