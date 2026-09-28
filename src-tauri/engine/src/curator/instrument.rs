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

use personas_core::models::{CuratorSkill, CuratorSkillLane};
use personas_core::types::CliArgs;
use serde::Deserialize;

use crate::cli_process::{capture_output, CapturedOutput};
use personas_core::error::AppError;

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
    ///
    /// **`Option` because the registry now writes `null` here, and a `u32`
    /// made the WHOLE instrument unparseable.** Measured 2026-09-25 against a
    /// live `librarian-scan --json`: of 475 subjects, **449 carry `null`** and
    /// 26 carry `0` - where the 2026-09-23 reading behind `e49` found `0` on
    /// all 349 of them. serde fails the entire document on one bad field, so
    /// this one drifted field took the plan down with it: `curator_plan_refresh`
    /// answered `librarian-scan produced unreadable JSON: invalid type: null,
    /// expected u32` and NO projection could be made at all. That is why
    /// `curator_plan_run` had zero rows.
    #[serde(default)]
    pub dry_streak: Option<u32>,
    #[serde(default)]
    pub points: u32,
    /// The scan's own sentences, one per clause that fired.
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDomain {
    /// The bundle's own name. Empty only when the scan omitted it, which no
    /// version of the report has done - a nameless bundle is dropped from the
    /// demand roster rather than reported under a blank name.
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub techniques: u32,
    #[serde(default)]
    pub applications: u32,
    /// Whether ANY consumer reports demand for this BUNDLE. The scan writes it
    /// per bundle as well as per subject, and the two agree on every one of the
    /// ten bundles in the 2026-09-22 corpus - the bundle-level field is taken
    /// here because a bundle whose subjects all score zero still has an answer
    /// and would otherwise have to be derived from rows that do not exist.
    #[serde(default)]
    pub demand_known: bool,
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
    /// Applications carrying no refresh clock at all, so they CANNOT expire.
    /// Without it `expired` reads as "nothing has expired" when the truth may
    /// be that most were never given a window.
    #[serde(default)]
    pub no_clock: u32,
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
pub async fn run_node(
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
pub fn parse_json<T: serde::de::DeserializeOwned>(
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
pub async fn git_head_short(dir: &Path) -> Option<String> {
    crate::git_checkpoint::run_git(dir, &["rev-parse", "--short", "HEAD"])
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

/// One reading, and where it came from.
///
/// The provenance is carried rather than inferred because **nothing downstream
/// can measure it honestly**: the caller sees an eleven-second answer or a
/// two-second one, and a stopwatch around the call is a guess at the cache, not
/// a reading of it. It rides here so `curator_plan_refresh` can say which of
/// the two it gave.
pub struct Reading {
    pub value: Arc<InstrumentReading>,
    /// True when [`CACHE_TTL`] answered and no node process ran.
    pub from_cache: bool,
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
pub async fn read(registry_root: &Path) -> Result<Reading, AppError> {
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
                return Ok(Reading {
                    value: Arc::clone(reading),
                    from_cache: true,
                });
            }
        }
    }

    let reading = Arc::new(read_uncached(registry_root, head).await?);

    if let Some(key) = key {
        let cache = INSTRUMENT_CACHE.get_or_init(|| Mutex::new(None));
        let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        *guard = Some((key, Instant::now(), Arc::clone(&reading)));
    }
    Ok(Reading {
        value: reading,
        from_cache: false,
    })
}

/// Drop both cached readings, so the next read goes to disk.
///
/// Called by the reconcile sleep and by nothing else. The caches are keyed on
/// the registry HEAD and on the checkout path and both expire after
/// [`CACHE_TTL`], so nothing here is *stale* in the ordinary sense - what the
/// sleep pass needs is the guarantee that the projection it is about to write
/// was computed from a read taken AFTER her workers finished committing, and a
/// five-minute TTL cannot promise that. A cache that might answer from before
/// the work it is reconciling would make the whole pass a no-op that looked
/// like a pass.
///
/// Deliberately not exposed as a command: a person cannot want this, and a
/// surface that offered "drop the cache" would be offering a button whose only
/// effect is an eleven-second wait.
pub fn invalidate() {
    if let Some(cache) = INSTRUMENT_CACHE.get() {
        *cache.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
    if let Some(cache) = SKILLS_CACHE.get() {
        *cache.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
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
pub fn script(registry_root: &Path, name: &str) -> Result<String, AppError> {
    let path: PathBuf = registry_root.join("scripts").join(name);
    if !path.is_file() {
        return Err(AppError::NotFound(format!(
            "curator instrument: the registry at {} has no scripts/{name}",
            registry_root.display()
        )));
    }
    Ok(path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// The skills lane
//
// **There is no manifest.** Measured 2026-09-24 against the registry checkout:
// `catalog.json` enumerates the 36 SHARED skills and NONE of the eight native
// ones (`assay`, `deepen`, `forge`, `harvest`, `hygiene`, `intake`,
// `librarian`, `reconcile`), which exist only as prose `SKILL.md` directories
// under `.claude/skills/`. A reader that trusted the catalogue would report a
// registry whose own maintenance set does not exist, so this reads the lane.
//
// Everything below is a PARSE of prose somebody else writes, which is why every
// field it fills is optional and why the one boolean it computes has three
// states. The rule the whole feature is built around applies hardest here: a
// skill whose invocation is undocumented is UNKNOWN, not "takes an argument".
// ---------------------------------------------------------------------------

/// The registry's own maintenance set. Linked entries are skipped - see
/// [`read_skills_uncached`].
const NATIVE_LANE: [&str; 2] = [".claude", "skills"];
/// The lane the registry publishes to consuming repos.
const SHARED_LANE: [&str; 1] = ["skills"];

type SkillsSlot = Option<(String, Instant, Arc<Vec<CuratorSkill>>)>;
/// One slot, overwritten on the next distinct registry, so it names its reaper.
/// Keyed on the checkout path alone rather than on HEAD: the lane is a
/// directory of files, a `git rev-parse` would cost a child process for a read
/// that costs none, and [`CACHE_TTL`] already bounds a working copy edited
/// without a commit - which is the usual way a skill changes.
static SKILLS_CACHE: OnceLock<Mutex<SkillsSlot>> = OnceLock::new();

/// Every skill in both lanes, native first, each lane by name.
///
/// Cheap enough to be uncached (44 small files) and cached anyway for the
/// reason the instrument's other reads are: a panel re-reads on navigation, and
/// a read that costs nothing still costs a syscall storm on a cold disk.
pub fn read_skills(registry_root: &Path) -> Result<Arc<Vec<CuratorSkill>>, AppError> {
    let key = registry_root.to_string_lossy().into_owned();
    {
        let cache = SKILLS_CACHE.get_or_init(|| Mutex::new(None));
        let guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((k, at, skills)) = guard.as_ref() {
            if *k == key && at.elapsed() < CACHE_TTL {
                return Ok(Arc::clone(skills));
            }
        }
    }
    let skills = Arc::new(read_skills_uncached(registry_root)?);
    let cache = SKILLS_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some((key, Instant::now(), Arc::clone(&skills)));
    Ok(skills)
}

/// Walk both lanes. A lane that is not there yields nothing rather than an
/// error: a registry with no native lane is a registry with no native skills,
/// which is a real answer about a younger checkout.
///
/// **A linked entry in the native lane is skipped.** Measured 2026-09-24,
/// `explorer` and `perfect` are shared skills linked INTO `.claude/skills/`, so
/// reading them there would report each one twice and attribute a published
/// skill to the registry's private maintenance set. The test is the resolved
/// path rather than `is_symlink()` alone, because a Windows junction is a
/// reparse point that not every std version reports the same way.
fn read_skills_uncached(registry_root: &Path) -> Result<Vec<CuratorSkill>, AppError> {
    let mut out = Vec::new();
    for (lane, segments) in [
        (CuratorSkillLane::Native, &NATIVE_LANE[..]),
        (CuratorSkillLane::Shared, &SHARED_LANE[..]),
    ] {
        let mut dir = registry_root.to_path_buf();
        for seg in segments {
            dir.push(seg);
        }
        let real_dir = std::fs::canonicalize(&dir).ok();
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                tracing::warn!(error = %e, path = %dir.display(),
                    "curator: a skills lane could not be listed - reporting it as empty");
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if lane == CuratorSkillLane::Native && is_linked_in(&path, real_dir.as_deref()) {
                continue;
            }
            let Some(file) = skill_file(&path) else {
                continue;
            };
            let raw = match std::fs::read_to_string(&file) {
                Ok(raw) => raw,
                Err(e) => {
                    tracing::warn!(error = %e, path = %file.display(),
                        "curator: a SKILL.md could not be read - leaving it out of the lane");
                    continue;
                }
            };
            let dir_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let mut skill = parse_skill(lane, &dir_name, &relative_to(registry_root, &file), &raw);
            // Attached here rather than inside `parse_skill`, which is a pure
            // parse of one file's prose and stays testable without a disk.
            let lessons = read_lessons(registry_root, &path);
            skill.lessons_path = lessons.path;
            skill.lessons_bytes = lessons.bytes;
            skill.lessons_modified_at = lessons.modified_at;
            skill.lessons_latest_entry = lessons.latest_entry;
            skill.lessons_latest_at = lessons.latest_at;
            out.push(skill);
        }
    }
    // Native before shared, then by name: the order the operator reads them in
    // and the order the test asserts, rather than whatever the directory hands
    // back on this filesystem.
    out.sort_by(|a, b| (a.lane, &a.name).cmp(&(b.lane, &b.name)));
    Ok(out)
}

/// Whether a native-lane entry actually lives somewhere else.
fn is_linked_in(entry: &Path, real_lane: Option<&Path>) -> bool {
    if std::fs::symlink_metadata(entry).is_ok_and(|m| m.file_type().is_symlink()) {
        return true;
    }
    match (std::fs::canonicalize(entry).ok(), real_lane) {
        (Some(resolved), Some(lane)) => !resolved.starts_with(lane),
        _ => false,
    }
}

/// A file in `dir` called `name`, whatever the repository spelled it. Eleven of
/// one managed repo's thirty-six skills track `skill.md` lowercase, and a
/// case-sensitive match would read a lane as empty on Linux while finding it on
/// Windows. The two cheap spellings are stat'ed first so the common case costs
/// no directory listing.
fn file_named(dir: &Path, name: &str) -> Option<PathBuf> {
    let lower = name.to_ascii_lowercase();
    for candidate in [name, lower.as_str()] {
        let path = dir.join(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    let entries = std::fs::read_dir(dir).ok()?;
    entries.flatten().map(|e| e.path()).find(|p| {
        p.is_file()
            && p.file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&lower))
    })
}

/// `SKILL.md`, whatever the repository spelled it.
fn skill_file(dir: &Path) -> Option<PathBuf> {
    file_named(dir, "SKILL.md")
}

// ---------------------------------------------------------------------------
// What a skill has LEARNED
//
// Every skill in this registry keeps an append-only `LESSONS.md` beside its
// `SKILL.md`, written after a run in that skill's own voice. Measured
// 2026-09-25: 43 of the 44 skills the two lanes report keep one (`llm-bench`
// is the exception), 1.58 MB in total, the largest (`intake`) 917 KB.
//
// **Nothing here reads them for meaning.** They are long, unstructured and
// each written to a different shape below the entry heading; a parser over
// that prose would be this app inventing structure the registry never wrote.
// What IS honestly derivable is that a skill has accumulated lessons and when
// it last learned something - which is the signal an operator reading Blueprint
// wants: which engine is still moving, and which has gone quiet.
// ---------------------------------------------------------------------------

/// What a skill's `LESSONS.md` says about ITSELF. All-`None` when there is no
/// such file, which is how [`CuratorSkill`]'s five lessons fields read "this
/// skill has never written anything down".
#[derive(Default)]
struct LessonsReading {
    path: Option<String>,
    bytes: Option<u64>,
    modified_at: Option<String>,
    latest_entry: Option<String>,
    latest_at: Option<String>,
}

/// Read a skill directory's `LESSONS.md` for its existence, its weight, its
/// clock and its newest dated heading - and nothing else.
///
/// A file that exists but cannot be stat'ed or opened still yields its path:
/// "there is a lessons file here and this reader could not measure it" is a
/// truer answer than pretending there is none.
fn read_lessons(registry_root: &Path, skill_dir: &Path) -> LessonsReading {
    let Some(file) = file_named(skill_dir, "LESSONS.md") else {
        return LessonsReading::default();
    };
    let meta = std::fs::metadata(&file).ok();
    let newest = newest_lesson(&file);
    LessonsReading {
        path: Some(relative_to(registry_root, &file)),
        bytes: meta.as_ref().map(|m| m.len()),
        modified_at: meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()),
        latest_entry: newest.as_ref().map(|(heading, _)| heading.clone()),
        latest_at: newest.map(|(_, date)| date),
    }
}

/// The newest dated `##` entry in a lessons file, as `(heading, YYYY-MM-DD)`.
///
/// Read LINE BY LINE rather than into a `String`: only the heading lines are
/// ever looked at, and `intake`'s file is 917 KB.
///
/// **The newest entry is the MAXIMUM date, not the topmost heading.** These
/// files are appended by hand in each skill's own session and the order is not
/// a convention: measured 2026-09-25, `harvest` runs ASCENDING (2026-09-23 at
/// the top, 2026-09-24 at the bottom) and `contest` is in neither order, so a
/// reader that trusted the top of the file would report harvest's newest lesson
/// as a day older than it is. A tie keeps the first heading seen, which is the
/// top of the file.
///
/// A heading with no `YYYY-MM-DD` in it is not an entry: measured the same day,
/// `assay` still carries the template's
/// `## <version used> - <YYYY-MM-DD> - <source slug>` and has recorded nothing.
/// That is `None`, and it must never read as a date.
fn newest_lesson(file: &Path) -> Option<(String, String)> {
    use std::io::BufRead;

    let handle = std::fs::File::open(file)
        .map_err(|e| {
            tracing::warn!(error = %e, path = %file.display(),
                "curator: a LESSONS.md could not be opened - carrying its path without its newest entry");
        })
        .ok()?;
    let mut in_fence = false;
    let mut best: Option<(String, String)> = None;
    for line in std::io::BufReader::new(handle)
        .lines()
        .map_while(Result::ok)
    {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        // A `##` inside a fenced block is a shell comment, not an entry - the
        // same trap `invocation_lines` guards against two screens up.
        if in_fence || !trimmed.starts_with("## ") {
            continue;
        }
        let Some(date) = iso_date_in(trimmed) else {
            continue;
        };
        let date = date.to_string();
        // Not `is_none_or` - this workspace's clippy MSRV is 1.80 and that is
        // 1.82.
        let newer = match best.as_ref() {
            Some((_, seen)) => date > *seen,
            None => true,
        };
        if newer {
            best = Some((trimmed[3..].trim().to_string(), date));
        }
    }
    best
}

/// The first `YYYY-MM-DD` in a line, or `None`.
///
/// Deliberately not a regex and not a date library: the shape is ten ASCII
/// bytes, the month and day ranges are the only guess worth refusing, and a
/// parsed `NaiveDate` would only be turned straight back into the same string.
/// Lexicographic order on ISO dates is chronological order, which is what
/// [`newest_lesson`] compares on.
fn iso_date_in(line: &str) -> Option<&str> {
    let bytes = line.as_bytes();
    for start in 0..bytes.len().saturating_sub(9) {
        let w = &bytes[start..start + 10];
        let shaped = w[..4].iter().all(u8::is_ascii_digit)
            && w[4] == b'-'
            && w[5..7].iter().all(u8::is_ascii_digit)
            && w[7] == b'-'
            && w[8..].iter().all(u8::is_ascii_digit);
        if !shaped {
            continue;
        }
        let month = (w[5] - b'0') * 10 + (w[6] - b'0');
        let day = (w[8] - b'0') * 10 + (w[9] - b'0');
        if (1..=12).contains(&month) && (1..=31).contains(&day) {
            // Every one of the ten bytes is ASCII, so both ends are char
            // boundaries however the rest of the line is encoded.
            return Some(&line[start..start + 10]);
        }
    }
    None
}

/// The path as the registry states it, with forward slashes so the string reads
/// the same on both platforms.
fn relative_to(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .replace('\\', "/")
}

/// One `SKILL.md`, read for what it states and nothing more.
fn parse_skill(lane: CuratorSkillLane, dir_name: &str, path: &str, raw: &str) -> CuratorSkill {
    let front = frontmatter(raw);
    let name = front
        .iter()
        .find(|(k, _)| k == "name")
        .map(|(_, v)| v.clone())
        .filter(|v| !v.is_empty())
        // The directory is the name the operator types, so it is the fallback
        // rather than an error: a skill with no `name:` is still dispatchable.
        .unwrap_or_else(|| dir_name.to_string());
    let field = |key: &str| {
        front
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
    };
    let invocation = invocation_lines(raw, &name);
    let (invocation_documented, runs_bare, line_hint) = match invocation {
        Some(lines) if !lines.is_empty() => {
            let bare = lines.iter().any(|l| l == &format!("/{name}"));
            let hint = lines
                .iter()
                .find(|l| {
                    let rest = l[format!("/{name}").len()..].trim();
                    rest.contains('<') || rest.contains('[')
                })
                .cloned();
            (true, Some(bare), hint)
        }
        // A heading with no usable block, or no heading at all. Both mean the
        // file documents no invocation, and `runs_bare` stays NULL: measured
        // 2026-09-24, `deepen` and `forge` are in exactly this state, and
        // "unknown" must never be read as "no".
        _ => (false, None, None),
    };
    CuratorSkill {
        name,
        lane,
        path: path.to_string(),
        title: heading(raw),
        description: field("description"),
        version: field("version"),
        invocation_documented,
        runs_bare,
        // The frontmatter's own `argument-hint:` wins when the file declares
        // one - it is the file stating the argument directly rather than this
        // reader inferring it from a usage line.
        argument_hint: field("argument-hint").or(line_hint),
        // A SKILL.md says nothing about its neighbour. `read_skills_uncached`
        // fills these from the directory - see [`read_lessons`].
        lessons_path: None,
        lessons_bytes: None,
        lessons_modified_at: None,
        lessons_latest_entry: None,
        lessons_latest_at: None,
    }
}

/// The `---`-fenced YAML header, as flat `key: value` pairs.
///
/// Deliberately not a YAML parser: measured 2026-09-24 across all 44 files in
/// both lanes, every header is flat single-line scalars, and a real parser
/// would be a dependency and a failure mode for a shape that does not need
/// one. A nested or folded value is skipped rather than guessed at.
fn frontmatter(raw: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut lines = raw.lines();
    if lines.next().map(str::trim) != Some("---") {
        return out;
    }
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        // A continuation or a nested key belongs to the value above it, which
        // this reader does not carry.
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        out.push((key.trim().to_string(), unquote(value.trim())));
    }
    out
}

/// Strip one matching pair of surrounding quotes, and nothing else.
fn unquote(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        if (first == b'"' || first == b'\'') && bytes[bytes.len() - 1] == first {
            let inner = &value[1..value.len() - 1];
            return if first == b'"' {
                inner.replace("\\\"", "\"")
            } else {
                inner.to_string()
            };
        }
    }
    value.to_string()
}

/// The file's first `# ` heading, which is the title every skill in both lanes
/// opens with.
fn heading(raw: &str) -> Option<String> {
    raw.lines()
        .find(|l| l.starts_with("# "))
        .map(|l| l[2..].trim().to_string())
        .filter(|t| !t.is_empty())
}

/// The invocation lines a file documents, or `None` when it documents none.
///
/// `None` and `Some(empty)` are both "undocumented" to the caller, and they are
/// kept apart here only so the shape of the failure is readable: no heading at
/// all versus a heading whose block names no invocation.
fn invocation_lines(raw: &str, name: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.iter().position(|l| is_invocation_heading(l))?;
    let mut collected = Vec::new();
    let mut in_fence = false;
    let prefix = format!("/{name}");
    for line in lines.iter().skip(start + 1) {
        let trimmed = line.trim_start();
        let fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if !in_fence {
            if fence {
                in_fence = true;
                continue;
            }
            // Another heading before any block: the section documents prose,
            // not an invocation.
            if trimmed.starts_with('#') {
                return Some(Vec::new());
            }
            continue;
        }
        if fence {
            break;
        }
        let Some(stated) = invocation_line(trimmed, &prefix) else {
            continue;
        };
        collected.push(stated);
    }
    Some(collected)
}

fn is_invocation_heading(line: &str) -> bool {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return false;
    }
    trimmed[hashes..]
        .trim_start()
        .to_ascii_lowercase()
        .starts_with("invocation")
}

/// One line of an invocation block, as the file states it, with the trailing
/// `#` annotation dropped.
///
/// The annotation is the file's commentary ON the line rather than part of it,
/// and carrying it would put a sentence of prose in a field a surface renders
/// beside an input box.
fn invocation_line(trimmed: &str, prefix: &str) -> Option<String> {
    let rest = trimmed.strip_prefix(prefix)?;
    // `/harvest` must not match a line for `/harvest-backlog`.
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let without_comment = match rest.find(" #") {
        Some(at) => &rest[..at],
        None => rest,
    };
    Some(
        format!("{prefix}{}", without_comment.trim_end())
            .trim_end()
            .to_string(),
    )
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
                "domains":[{"domain":"x","subjects":8,"techniques":25,"applications":12,
                            "demandKnown":true}],
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
        assert_eq!(scan.subjects[0].dry_streak, Some(0));
        assert_eq!(scan.domains[0].techniques, 25);
        // The bundle names itself and answers the demand question for itself.
        // Both are what the quiet tail and `demandKnownDomains` are built from,
        // and neither can be derived from a subject that scores nothing.
        assert_eq!(scan.domains[0].domain, "x");
        assert!(scan.domains[0].demand_known);
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
        // `expired: 0` beside `noClock: 301` is the whole reason this field is
        // carried: 301 of these applications cannot expire, so the zero above
        // is not the reassurance it looks like.
        assert_eq!(currency.totals.expired, 0);
        assert_eq!(currency.totals.no_clock, 301);
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

    // -----------------------------------------------------------------------
    // The skills lane
    //
    // The fixtures below are the measured shapes, not invented ones: each is
    // the frontmatter and the `## Invocation` block of the real file as it
    // stood on 2026-09-24, trimmed to the lines the reader looks at. `deepen`
    // and `forge` carry no Invocation section because they carry none.
    // -----------------------------------------------------------------------

    fn write_skill(root: &Path, lane: &str, name: &str, body: &str) {
        let dir = root.join(lane).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    fn write_lessons(root: &Path, lane: &str, name: &str, body: &str) {
        let dir = root.join(lane).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("LESSONS.md"), body).unwrap();
    }

    /// The eight native skills as they really read, plus one shared skill.
    fn measured_registry() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let native = ".claude/skills";

        write_skill(root, native, "hygiene", concat!(
            "---\nname: hygiene\ndescription: \"Start-of-day fleet sweep before any development\"\n",
            "category: ai-native\nversion: 1.0.5\n---\n\n# Hygiene\n\n## Invocation\n\n```\n",
            "/hygiene                  # full run: scan -> mechanical -> dispatch -> verify -> report\n",
            "/hygiene scan             # plan only, touches nothing\n",
            "/hygiene kp,ascent        # full run limited to these project slugs\n",
            "```\n\n## Modes\n\nprose\n",
        ));
        write_skill(root, native, "librarian", concat!(
            "---\nname: librarian\ndescription: \"Maintain the registry as a whole\"\nversion: 1.6.2\n---\n\n",
            "# Librarian\n\n## Invocation\n\n```\n",
            "/librarian              # sweep + report, writes no content\n",
            "/librarian run [domain] # the full loop, dispatches workers\n",
            "```\n",
        ));
        write_skill(root, native, "harvest", concat!(
            "---\nname: harvest\ndescription: \"Drain the graded source queue\"\nversion: 0.5.2\n---\n\n",
            "# Harvest\n\n## Invocation\n\n```\n",
            "/harvest                     # plan only: map queue vs live gaps\n",
            "/harvest run [domain]        # one attended pass\n",
            "```\n",
        ));
        write_skill(
            root,
            native,
            "assay",
            concat!(
            "---\nname: assay\ndescription: \"Mine an external source\"\nversion: 2.2.1\n---\n\n",
            "# Assay\n\n## Invocation\n\n```\n",
            "/assay <url|path|->              # the full loop\n",
            "/assay status                    # read the source ledger\n",
            "```\n",
        ),
        );
        write_skill(root, native, "intake", concat!(
            "---\nname: intake\ndescription: \"Mine an external source for what it should change\"\nversion: 2.14.1\n---\n\n",
            "# Intake\n\n## Invocation\n\n```\n",
            "/intake <url|path|->          # the full loop: ingest, map, triage, land\n",
            "/intake board                 # read the run board\n",
            "```\n",
        ));
        write_skill(root, native, "reconcile", concat!(
            "---\nname: reconcile\ndescription: \"Run the external-reconcile lane as its director\"\nversion: 1.0.1\n---\n\n",
            "# Reconcile - direct the external-evidence lane\n\n## Invocation\n\n```\n",
            "/reconcile <bundle>              # profile the bundle, propose a wave\n",
            "/reconcile status                # read the vault\n",
            "```\n",
        ));
        // `deepen` documented NOTHING until 2026-09-26, which is why this
        // fixture carried it as the undocumented specimen. It now states an
        // address-shaped invocation and none of its lines is bare, so it
        // belongs with `intake` and `reconcile` - and the fixture moved
        // because the registry moved, never the other way round.
        write_skill(root, native, "deepen", concat!(
            "---\nname: deepen\ndescription: \"Review and widen an existing knowledge-bundle topic\"\nversion: 1.4.0\n---\n\n",
            "# Deepen\n\n## Invocation\n\n```\n",
            "/deepen <domain>                      # one interactive pass over the bundle\n",
            "/deepen <domain>/<subject>            # one named subject the caller already ranked\n",
            "/deepen <domain> --loop <N>           # up to N cycles against the saturation ledger\n",
            "/deepen status [<domain>]             # read the ledger, touch nothing\n",
            "```\n\n## The cycle\n\nprose about lanes and saturation\n",
        ));
        // The one that still documents NOTHING: a body, and no Invocation
        // section anywhere in it.
        write_skill(root, native, "forge", concat!(
            "---\nname: forge\ndescription: \"Extract a repository's domain knowledge\"\nversion: 1.4.0\n---\n\n",
            "# Forge - domain knowledge extraction\n\n## Failure modes observed (do not rediscover)\n\nprose\n",
        ));
        // The shared lane, including the one shape that states its argument in
        // the frontmatter rather than in a usage line.
        write_skill(
            root,
            "skills",
            "leonardo",
            concat!(
                "---\nname: leonardo\ndescription: \"Generate images\"\nversion: 1.0.0\n",
                "argument-hint: <description of visual asset to create>\n---\n\n# Leonardo\n",
            ),
        );

        // The lessons lane, in the three shapes the registry really holds on
        // 2026-09-25. Every other skill written above keeps NO LESSONS.md,
        // which is `llm-bench`'s state - the one skill of the forty-four that
        // has never written anything down.
        //
        // `intake` appends at the TOP, which is the shape everyone assumes.
        write_lessons(
            root,
            native,
            "intake",
            concat!(
                "# Lessons - intake\n\n",
                "## 1.1.0 - 2026-08-30 - operator-control-plane\n\n- a lesson\n\n",
                "### Redesign proposal - a subheading carries no date and is not an entry\n\n",
                "## 0.16.0 - 2026-08-28 - plan-review execution\n\n- an older lesson\n",
            ),
        );
        // `harvest` appends at the BOTTOM. A reader that took the topmost
        // heading would report its newest lesson as a day older than it is.
        write_lessons(
            root,
            native,
            "harvest",
            concat!(
                "# Lessons - harvest\n\n",
                "## 0.4.1 - 2026-09-23 - ai-registry\n\n- the first pass\n\n",
                "```\n## 2099-01-01 - a fenced line is a comment, not an entry\n```\n\n",
                "## 0.5.2 - 2026-09-24 - ai-registry (run hv-auto-0924)\n\n- the newest\n",
            ),
        );
        // `assay` still holds the template it was seeded with and has recorded
        // nothing. The file exists; no dated entry is in it.
        write_lessons(
            root,
            native,
            "assay",
            concat!(
                "# Lessons - assay\n\n",
                "## <version used> - <YYYY-MM-DD> - <source slug>\n\n- one bullet per lesson\n",
            ),
        );
        dir
    }

    fn by_name(skills: &[CuratorSkill], name: &str) -> CuratorSkill {
        skills
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no skill named {name} in {skills:?}"))
            .clone()
    }

    /// **`runs_bare` is NULL for an undocumented invocation and `Some(true)`
    /// for the three that document a bare one.** This is the rule the whole
    /// feature is built around: unknown and no are different facts, and a
    /// dispatcher that read `deepen` as "false" would refuse to run it for a
    /// reason nobody wrote down.
    #[test]
    fn runs_bare_is_unknown_when_the_file_documents_no_invocation() {
        let dir = measured_registry();
        let skills = read_skills_uncached(dir.path()).unwrap();

        for bare in ["hygiene", "librarian", "harvest"] {
            let s = by_name(&skills, bare);
            assert!(s.invocation_documented, "{bare} documents an invocation");
            assert_eq!(s.runs_bare, Some(true), "{bare} runs bare");
        }
        for needs_argument in ["assay", "intake", "reconcile", "deepen"] {
            let s = by_name(&skills, needs_argument);
            assert!(s.invocation_documented);
            assert_eq!(
                s.runs_bare,
                Some(false),
                "{needs_argument} documents an invocation and none of its lines is bare"
            );
        }
        for undocumented in ["forge"] {
            let s = by_name(&skills, undocumented);
            assert!(
                !s.invocation_documented,
                "{undocumented} documents no invocation"
            );
            assert_eq!(
                s.runs_bare, None,
                "{undocumented} is UNKNOWN, not false - a caller inventing an \
                 invocation for it is guessing"
            );
        }
    }

    /// The argument hint is the line the file states, with the file's own
    /// commentary on that line dropped - and the frontmatter's declaration
    /// wins over an inferred usage line.
    #[test]
    fn the_argument_hint_is_what_the_file_states() {
        let dir = measured_registry();
        let skills = read_skills_uncached(dir.path()).unwrap();
        assert_eq!(
            by_name(&skills, "assay").argument_hint.as_deref(),
            Some("/assay <url|path|->")
        );
        assert_eq!(
            by_name(&skills, "reconcile").argument_hint.as_deref(),
            Some("/reconcile <bundle>")
        );
        // A bare-runnable skill still names its optional argument.
        assert_eq!(
            by_name(&skills, "harvest").argument_hint.as_deref(),
            Some("/harvest run [domain]")
        );
        // `/hygiene scan` and `/hygiene kp,ascent` name no placeholder, so
        // there is nothing to hint at.
        assert_eq!(by_name(&skills, "hygiene").argument_hint, None);
        // The frontmatter's own declaration, used as written.
        assert_eq!(
            by_name(&skills, "leonardo").argument_hint.as_deref(),
            Some("<description of visual asset to create>")
        );
    }

    /// Both lanes are read, native first, and every field the header states
    /// reaches the row.
    #[test]
    fn both_lanes_are_read_and_the_header_reaches_the_row() {
        let dir = measured_registry();
        let skills = read_skills_uncached(dir.path()).unwrap();
        assert_eq!(skills.len(), 9);
        assert_eq!(skills[0].lane, CuratorSkillLane::Native);
        assert_eq!(skills.last().unwrap().lane, CuratorSkillLane::Shared);
        assert_eq!(skills.last().unwrap().name, "leonardo");

        let forge = by_name(&skills, "forge");
        assert_eq!(forge.version.as_deref(), Some("1.4.0"));
        assert_eq!(
            forge.description.as_deref(),
            Some("Extract a repository's domain knowledge")
        );
        assert_eq!(
            forge.title.as_deref(),
            Some("Forge - domain knowledge extraction")
        );
        assert_eq!(forge.path, ".claude/skills/forge/SKILL.md");
        assert_eq!(
            by_name(&skills, "leonardo").path,
            "skills/leonardo/SKILL.md"
        );
    }

    /// **A skill with no `LESSONS.md` carries `None` in all five fields, never
    /// a zero.** A `0` for `lessons_bytes` is a legal reading of a file that
    /// exists and has been emptied; "there is no such file" is a different
    /// fact, and collapsing them is the one thing this whole feature refuses to
    /// do. Measured 2026-09-25: `llm-bench` is the only skill of the
    /// forty-four in that state.
    #[test]
    fn a_skill_with_no_lessons_file_carries_none_and_not_a_zero() {
        let dir = measured_registry();
        let skills = read_skills_uncached(dir.path()).unwrap();

        for silent in ["deepen", "forge", "hygiene", "librarian", "leonardo"] {
            let s = by_name(&skills, silent);
            assert_eq!(s.lessons_path, None, "{silent} keeps no lessons file");
            assert_eq!(
                s.lessons_bytes, None,
                "{silent} has NO size - not a size of zero, which would claim a \
                 measurement of a file that is not there"
            );
            assert_eq!(s.lessons_modified_at, None, "{silent}");
            assert_eq!(s.lessons_latest_entry, None, "{silent}");
            assert_eq!(s.lessons_latest_at, None, "{silent}");
        }
    }

    /// A skill that keeps one carries its weight, its clock and the heading of
    /// its newest DATED entry - **which is the maximum date, not the top of the
    /// file.** `harvest` really does append at the bottom (measured
    /// 2026-09-25), so trusting the first heading would report its newest
    /// lesson as a day older than it is.
    #[test]
    fn a_skill_with_lessons_carries_its_newest_dated_heading() {
        let dir = measured_registry();
        let skills = read_skills_uncached(dir.path()).unwrap();

        let intake = by_name(&skills, "intake");
        assert_eq!(
            intake.lessons_path.as_deref(),
            Some(".claude/skills/intake/LESSONS.md")
        );
        assert!(intake.lessons_bytes.is_some_and(|b| b > 0));
        assert!(intake.lessons_modified_at.is_some());
        assert_eq!(
            intake.lessons_latest_entry.as_deref(),
            Some("1.1.0 - 2026-08-30 - operator-control-plane")
        );
        assert_eq!(intake.lessons_latest_at.as_deref(), Some("2026-08-30"));

        // The ascending file. Its newest entry is the LAST heading, and the
        // `## 2099-01-01` inside the fenced block is a comment, not an entry.
        let harvest = by_name(&skills, "harvest");
        assert_eq!(harvest.lessons_latest_at.as_deref(), Some("2026-09-24"));
        assert_eq!(
            harvest.lessons_latest_entry.as_deref(),
            Some("0.5.2 - 2026-09-24 - ai-registry (run hv-auto-0924)")
        );
    }

    /// **A lessons file with no dated heading has never recorded a run**, and
    /// that is `None` rather than the template's own `<YYYY-MM-DD>` placeholder
    /// read as a date. The file's existence, weight and clock are still carried
    /// - a seeded template IS a fact about the skill, and a different one from
    /// having no file at all.
    #[test]
    fn a_lessons_file_that_is_still_the_template_has_no_dated_entry() {
        let dir = measured_registry();
        let skills = read_skills_uncached(dir.path()).unwrap();

        let assay = by_name(&skills, "assay");
        assert_eq!(
            assay.lessons_path.as_deref(),
            Some(".claude/skills/assay/LESSONS.md")
        );
        assert!(assay.lessons_bytes.is_some_and(|b| b > 0));
        assert!(assay.lessons_modified_at.is_some());
        assert_eq!(
            assay.lessons_latest_entry, None,
            "the template's placeholder heading is not an entry"
        );
        assert_eq!(assay.lessons_latest_at, None);
    }

    /// The date reader takes the ten-byte ISO shape and refuses everything that
    /// only looks like it. A month of 13 or a day of 00 is not a date, and the
    /// template's `<YYYY-MM-DD>` is not one either.
    #[test]
    fn the_date_reader_refuses_what_only_looks_like_a_date() {
        assert_eq!(
            iso_date_in("## 1.1.0 - 2026-08-30 - slug"),
            Some("2026-08-30")
        );
        // The FIRST date in the line wins, and a version number is not one.
        assert_eq!(
            iso_date_in("## 2026-09-24 then 2026-09-25"),
            Some("2026-09-24")
        );
        assert_eq!(
            iso_date_in("## <version used> - <YYYY-MM-DD> - <slug>"),
            None
        );
        assert_eq!(
            iso_date_in("## 2026-13-01 - a month that does not exist"),
            None
        );
        assert_eq!(
            iso_date_in("## 2026-08-00 - a day that does not exist"),
            None
        );
        assert_eq!(iso_date_in("## 1.6.2 - no date at all"), None);
        // A multi-byte line still slices on a char boundary.
        assert_eq!(iso_date_in("## přehled - 2026-09-25"), Some("2026-09-25"));
    }

    /// A registry with no native lane is a registry with no native skills -
    /// a real answer about a younger checkout, not an error.
    #[test]
    fn a_missing_lane_is_empty_rather_than_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_skills_uncached(dir.path()).unwrap().is_empty());
    }

    /// A native entry that resolves outside the native lane is a shared skill
    /// linked in - measured 2026-09-24, `explorer` and `perfect` are exactly
    /// that - and reading it there would report it twice and attribute a
    /// published skill to the registry's private maintenance set.
    #[test]
    fn a_native_entry_resolving_outside_the_lane_is_linked_in() {
        let dir = tempfile::tempdir().unwrap();
        let lane = dir.path().join(".claude").join("skills");
        let shared = dir.path().join("skills");
        std::fs::create_dir_all(lane.join("assay")).unwrap();
        std::fs::create_dir_all(shared.join("explorer")).unwrap();
        let real_lane = std::fs::canonicalize(&lane).unwrap();
        assert!(!is_linked_in(&lane.join("assay"), Some(&real_lane)));
        assert!(is_linked_in(&shared.join("explorer"), Some(&real_lane)));
    }

    /// **A `null` `dryStreak` must parse.** serde fails the WHOLE document on
    /// one bad field, so while `ScanSubject::dry_streak` was a `u32` this one
    /// drifted field took the entire plan down: measured 2026-09-25, 449 of the
    /// registry's 475 subjects write `null` there, `curator_plan_refresh`
    /// answered `librarian-scan produced unreadable JSON: invalid type: null,
    /// expected u32`, and no projection could be made at all. A subject with a
    /// number keeps it; the two spellings are both "the registry cannot tell
    /// you", and `e49` already says the stored `0` means unknown.
    #[test]
    fn a_null_dry_streak_parses_rather_than_failing_the_whole_scan() {
        let scan: LibrarianScan = serde_json::from_str(
            r#"{"generatedAt":"2026-09-25T09:00:00.000Z","today":"2026-09-25",
                "demandKnownForAnyBundle":true,"domains":[],
                "subjects":[{"id":"d/a","domain":"d","slug":"a","at":"c/a","dryStreak":null},
                            {"id":"d/b","domain":"d","slug":"b","at":"c/b","dryStreak":3}]}"#,
        )
        .expect("a null dryStreak is the registry's own spelling of unknown");
        assert_eq!(scan.subjects[0].dry_streak, None);
        assert_eq!(scan.subjects[1].dry_streak, Some(3));
    }

    /// A `#` inside a fenced block is not a heading, and a name that is a
    /// prefix of another is not a match for it.
    #[test]
    fn the_invocation_reader_does_not_confuse_a_comment_or_a_prefix() {
        let raw = concat!(
            "---\nname: harvest\n---\n\n# Harvest\n\n## Invocation\n\n```\n",
            "# a shell comment that is not a heading\n",
            "/harvest-backlog run\n",
            "/harvest run [domain]\n",
            "```\n",
        );
        let lines = invocation_lines(raw, "harvest").unwrap();
        assert_eq!(lines, vec!["/harvest run [domain]".to_string()]);

        // A section that is prose rather than a block documents nothing.
        let prose = "# X\n\n## Invocation\n\nRun it however you like.\n\n## Next\n";
        assert_eq!(invocation_lines(prose, "x"), Some(Vec::new()));
        assert_eq!(invocation_lines("# X\n\nno section\n", "x"), None);
    }
}
